import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";
process.env.DATABASE_URL = process.env.WORKER_DATABASE_URL;
const { claimSourceJob, processSourceJob, commitSourceObject, LostLease } =
  await import("../packages/application/source-worker.js");
const { pool } = await import("../packages/database/index.js");
const { opaqueIdentity, openSecret } =
  await import("../packages/auth/secrets.js");
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const base = process.env.BLACKBOX_API_URL!,
  fixture = "http://" + process.env.FIXTURE_HOST,
  runtime = process.env.TEST_RUNTIME_DIR!;
const key = (purpose: string) =>
    "bb_" + purpose + "_" + randomBytes(32).toString("base64url"),
  hash = (v: string) => createHash("sha256").update(v).digest("hex");
const checks: string[] = [];
async function scenario(input: unknown) {
  const r = await fetch(fixture + "/source-scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assert.equal(r.status, 200);
}
function order(n: number, days = 0, extra = false) {
  const at = new Date(Date.now() - 3600000 - days * 86400000).toISOString(),
    money = (amount: string) => ({
      shopMoney: { amount, currencyCode: "EUR" },
    });
  const line = (m: number) => ({
    id: "gid://shopify/LineItem/" + m,
    quantity: 2,
    currentQuantity: 2,
    variant: { inventoryItem: { id: "gid://shopify/InventoryItem/" + m } },
    originalTotalSet: money("10.00"),
    discountAllocations: [{ allocatedAmountSet: money("1.00") }],
    taxLines: [{ priceSet: money("1.71") }],
  });
  return {
    id: "gid://shopify/Order/" + n,
    createdAt: at,
    updatedAt: at,
    test: true,
    currencyCode: "EUR",
    closed: false,
    cancelledAt: null,
    taxesIncluded: false,
    totalPriceSet: money("10.71"),
    lineItems: {
      nodes: [line(n)],
      pageInfo: { hasNextPage: extra, endCursor: extra ? "line-next" : null },
    },
    extraLines: extra ? [line(n + 1000)] : [],
    transactionsCount: { count: 2, precision: "EXACT" },
    transactions: [
      {
        id: "gid://shopify/OrderTransaction/" + n,
        kind: "CAPTURE",
        status: "SUCCESS",
        processedAt: at,
        test: true,
        amountSet: money("10.71"),
        parentTransaction: null,
      },
      {
        id: "gid://shopify/OrderTransaction/" + (n + 10000),
        kind: "REFUND",
        status: "SUCCESS",
        processedAt: at,
        test: true,
        amountSet: money("2.03"),
        parentTransaction: { id: "gid://shopify/OrderTransaction/" + n },
      },
    ],
  };
}
async function tenant() {
  const id = randomUUID(),
    owner = key("owner"),
    agent = key("agent"),
    principal = randomUUID();
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Source operations synthetic')",
    [id],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [id]);
  for (const [purpose, value] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Synthetic source test')",
      [id, randomUUID(), principal, purpose, hash(value)],
    );
  const login = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key: owner }),
  });
  assert.equal(login.status, 200);
  const csrf = (await login.json()).csrf,
    cookie = login.headers.getSetCookie()[0].split(";")[0];
  return {
    id,
    owner,
    agent,
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie,
      "x-blackbox-csrf": csrf,
    },
  };
}
async function api(t: any, path: string, body?: unknown, status = 200) {
  const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: t.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    result = await r.json();
  assert.equal(r.status, status, JSON.stringify(result));
  return result;
}
async function apply(tenant: string) {
  const r = await fetch(process.env.ENGINE_URL + "/v1/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-blackbox-internal": await readFile(
        process.env.INTERNAL_KEY_FILE!,
        "utf8",
      ),
    },
    body: JSON.stringify({ tenant_id: tenant }),
  });
  assert.equal(r.status, 200, await r.text());
}
async function drain(t: any, max = 40) {
  for (let i = 0; i < max; i++) {
    const job = await claimSourceJob(t.id);
    if (!job) {
      await apply(t.id);
      return;
    }
    await processSourceJob(job);
    await apply(t.id);
    await new Promise((r) => setTimeout(r, 260));
  }
  throw Error("source_drain_budget");
}
try {
  const a = await tenant(),
    b = await tenant(),
    nodes = [order(9001, 0, true), order(9002, 10), order(9003, 80)];
  await scenario({ orders: nodes });
  const credentials = {
    shop: process.env.FIXTURE_HOST,
    auth: "access_token",
    access_token: "synthetic-fixture-token",
    fixture: true,
  };
  const connected = await api(a, "/v1/sources/shopify", {
      name: "Synthetic Shopify",
      credentials,
    }),
    connection = connected.connection_id;
  const dbSecret = (
    await admin.query(
      "SELECT sealed FROM bb.source_secrets WHERE tenant_id=$1 AND connection_id=$2",
      [a.id, connection],
    )
  ).rows[0].sealed;
  assert.ok(!JSON.stringify(dbSecret).includes(credentials.access_token));
  await assert.rejects(() => openSecret(b.id, connection, dbSecret));
  await assert.rejects(() => openSecret(a.id, randomUUID(), dbSecret));
  checks.push("credential_ciphertext_bound_to_workspace_and_connection");
  const body = {
    selection: { preset: "last_30_days", timezone: "Europe/Berlin" },
    capabilities: ["orders", "payments", "refunds"],
    acknowledge_restrictions: true,
  };
  const preview = await api(a, `/v1/sources/${connection}/preview`, body);
  assert.equal(preview.parameters.include_open_items, true);
  const started = await api(a, `/v1/sources/${connection}/import`, body);
  assert.equal(started.revision, 1);
  assert.equal(started.jobs.length, 9);
  const suggestion = (await api(a, "/v1/sources/readiness")).workspace
    .suggested_history_from;
  assert.equal(
    Date.parse(started.parameters.initial_cutoff) -
      Date.parse(started.parameters.requested_from),
    30 * 86400000,
  );
  await api(b, `/v1/sources/${connection}/import`, body, 404);
  const denied = await fetch(base + "/v1/sources/readiness", {
    headers: { authorization: "Bearer " + a.agent },
  });
  assert.equal(denied.status, 403);
  const csrfDenied = await fetch(base + `/v1/sources/${connection}/import`, {
    method: "POST",
    headers: { ...a.headers, "x-blackbox-csrf": "wrong" },
    body: JSON.stringify(body),
  });
  assert.equal(csrfDenied.status, 403);
  checks.push(
    "fixed_30_day_plan_scope_preview_owner_csrf_tenant_and_agent_denials",
  );
  const initial = (
    await admin.query(
      "SELECT * FROM bb.source_jobs WHERE tenant_id=$1 AND capability='orders' AND kind='initial'",
      [a.id],
    )
  ).rows[0];
  await api(a, `/v1/imports/${initial.job_id}/control`, { action: "pause" });
  const live = (
    await admin.query(
      "SELECT state FROM bb.source_jobs WHERE tenant_id=$1 AND capability='orders' AND kind='incremental'",
      [a.id],
    )
  ).rows[0];
  assert.equal(live.state, "queued");
  await api(a, `/v1/imports/${initial.job_id}/control`, { action: "resume" });
  checks.push("history_pause_does_not_pause_new_activity");
  const lease = await claimSourceJob(a.id);
  assert.ok(lease);
  const concurrent = await claimSourceJob(a.id);
  if (concurrent) {
    assert.notEqual(concurrent.capability, lease.capability);
    await processSourceJob(concurrent);
  }
  await admin.query(
    "UPDATE bb.source_jobs SET leased_until=now()-interval '1 second' WHERE tenant_id=$1 AND job_id=$2",
    [a.id, lease.job_id],
  );
  await assert.rejects(
    () =>
      commitSourceObject(lease, {
        object_id: randomUUID(),
        dataset: lease.capability,
        observations: [],
        raw: { synthetic: true },
      }),
    LostLease,
  );
  const resumed = await claimSourceJob(a.id);
  assert.ok(resumed);
  if (resumed.job_id === lease.job_id)
    assert.ok(Number(resumed.fence) > Number(lease.fence));
  await processSourceJob(resumed);
  await apply(a.id);
  checks.push("expired_lease_cannot_commit_and_capability_has_one_running_job");
  await scenario({ orders: nodes, rate_limit: 1 });
  await new Promise((r) => setTimeout(r, 300));
  const throttled = await claimSourceJob(a.id);
  assert.ok(throttled);
  await processSourceJob(throttled);
  const retry = (
    await admin.query(
      "SELECT * FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
      [a.id, throttled.job_id],
    )
  ).rows[0];
  assert.equal(retry.error_code, "provider_rate_limited");
  assert.ok(new Date(retry.next_at).getTime() - Date.now() > 4000);
  assert.deepEqual(retry.checkpoint, throttled.checkpoint);
  await new Promise((r) => setTimeout(r, 6000));
  await drain(a);
  let ready = await api(a, "/v1/sources/readiness"),
    runs = ready.runs.filter((x: any) => x.kind === "initial");
  assert.equal(runs.length, 3);
  for (const run of runs) {
    assert.equal(run.state, "complete_with_gaps");
    assert.equal(run.discovered, 3);
    assert.equal(run.committed_objects, 3);
    assert.equal(run.processed_objects, 3);
    assert.equal(run.quarantined, 0);
  }
  const journal = (
    await admin.query(
      "SELECT * FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage'",
      [a.id],
    )
  ).rows;
  assert.equal(journal.length, 9);
  assert.ok(
    journal.every(
      (x) => new Date(x.recorded_at).getTime() > Date.parse(x.occurred_at),
    ),
  );
  const orderRecord = journal.find(
    (x) =>
      x.payload.record.dataset === "orders" &&
      x.payload.record.lines.length === 2,
  );
  assert.ok(orderRecord);
  assert.equal(orderRecord.payload.record.lines[0].line_gross_minor, 1071);
  const payment = journal.find(
    (x) =>
      x.payload.record.dataset === "payments" &&
      x.entity_id === orderRecord.entity_id,
  );
  const refund = journal.find(
    (x) =>
      x.payload.record.dataset === "refunds" &&
      x.entity_id === orderRecord.entity_id,
  );
  assert.equal(
    refund.payload.record.original_transaction_id,
    payment.record_id,
  );
  checks.push(
    "nested_line_pages_open_older_context_three_logical_cohorts_pg_rust_processing_and_rate_limit_resume",
  );
  const answer = await fetch(base + "/v1/tools/query_business", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + a.agent,
    },
    body: JSON.stringify({
      intent: "orders.payment_state",
      entity_id: orderRecord.entity_id,
      as_of: started.parameters.initial_cutoff,
    }),
  });
  assert.equal(answer.status, 200);
  const result = await answer.json();
  assert.notEqual(result.status, "insufficient_data");
  assert.ok(result.evidence.length > 0);
  assert.equal(result.result.rows[0].collected_minor, 1071);
  const checksBefore = ready.capabilities.map((h: any) => h.last_success_at),
    newBefore = ready.capabilities.map((h: any) => h.last_new_at);
  await admin.query(
    "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND kind='incremental' AND state='queued'",
    [a.id],
  );
  await drain(a);
  ready = await api(a, "/v1/sources/readiness");
  assert.deepEqual(
    ready.capabilities.map((h: any) => h.last_new_at),
    newBefore,
  );
  assert.ok(
    ready.capabilities.every(
      (h: any, i: number) =>
        Date.parse(h.last_success_at) > Date.parse(checksBefore[i]),
    ),
  );
  assert.equal(
    Number(
      (
        await admin.query(
          "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage'",
          [a.id],
        )
      ).rows[0].count,
    ),
    9,
  );
  checks.push(
    "empty_poll_updates_success_without_new_data_or_duplicate_business_effects",
  );
  await scenario({ orders: nodes, account_id: "gid://shopify/Shop/7999" });
  await api(
    a,
    "/v1/sources/shopify",
    { name: "Wrong shop", credentials, connection_id: connection },
    409,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT sealed FROM bb.source_secrets WHERE tenant_id=$1 AND connection_id=$2",
        [a.id, connection],
      )
    ).rows[0].sealed.ciphertext,
    dbSecret.ciphertext,
  );
  await scenario({ orders: nodes });
  await api(a, "/v1/sources/shopify", {
    name: "Same shop",
    credentials,
    connection_id: connection,
  });
  checks.push(
    "different_account_reconnect_rejected_without_replacing_credentials",
  );
  const expansion = await api(a, `/v1/sources/${connection}/import`, {
    ...body,
    selection: { preset: "last_12_months", timezone: "Europe/Berlin" },
  });
  assert.equal(expansion.revision, 2);
  await drain(a);
  assert.equal(
    (await api(a, "/v1/sources/readiness")).workspace.suggested_history_from,
    suggestion,
  );
  assert.equal(
    Number(
      (
        await admin.query(
          "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage'",
          [a.id],
        )
      ).rows[0].count,
    ),
    9,
  );
  checks.push(
    "append_only_plan_expansion_preserves_workspace_suggestion_and_deduplicates_overlap",
  );
  const strictConnected = await api(b, "/v1/sources/shopify", {
    name: "Strict new data",
    credentials,
  });
  const strict = await api(
    b,
    `/v1/sources/${strictConnected.connection_id}/import`,
    {
      ...body,
      selection: {
        preset: "from_now",
        timezone: "UTC",
        include_open_items: false,
        include_related_records: false,
        include_opening_state: false,
      },
    },
  );
  await drain(b);
  assert.equal(
    Number(
      (
        await admin.query(
          "SELECT count(*) FROM bb.journal WHERE tenant_id=$1",
          [b.id],
        )
      ).rows[0].count,
    ),
    0,
  );
  const requests = (await (await fetch(fixture + "/source-requests")).json())
    .requests;
  assert.ok(
    !requests
      .slice(-6)
      .some((x: any) => x.variables.query?.includes("status:open")),
  );
  checks.push("strict_from_now_does_not_fetch_old_context_or_opening_state");
  await admin.query(
    "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND capability='orders' AND kind='reconciliation' AND state='queued'",
    [a.id],
  );
  const interrupted = await claimSourceJob(a.id);
  assert.ok(interrupted);
  await processSourceJob(interrupted);
  const checkpoint = (
    await admin.query(
      "SELECT checkpoint FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
      [a.id, interrupted.job_id],
    )
  ).rows[0].checkpoint;
  assert.ok(checkpoint.after);
  await api(a, `/v1/connections/${connection}/state`, { state: "paused" });
  await api(b, `/v1/connections/${strictConnected.connection_id}/state`, {
    state: "paused",
  });
  // Persist only in ignored owner-readable test state. Evidence output below contains no credentials.
  await writeFile(
    runtime + "/source-operations-state.json",
    JSON.stringify({
      a,
      b,
      connection,
      strict_connection: strictConnected.connection_id,
      entity: orderRecord.entity_id,
      result,
      source_count: 9,
      source_orders: nodes,
      interrupted_job: interrupted.job_id,
      interrupted_checkpoint: checkpoint,
    }),
    { mode: 0o600 },
  );
  const evidence = {
    suite: "source-operations-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"]).toString().trim(),
    at: new Date().toISOString(),
    checks,
    synthetic: true,
    live_shopify: "blocked_no_authorized_account",
    result: "passed",
  };
  await writeFile(
    runtime + "/source-operations-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} finally {
  await pool.end();
  await admin.end();
}

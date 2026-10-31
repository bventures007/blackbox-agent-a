import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
process.env.DATABASE_URL = process.env.WORKER_DATABASE_URL;
const { pool } = await import("../packages/database/index.js"),
  { ingest } = await import("../packages/application/ingest.js"),
  { claimSourceJob, processSourceJob } =
    await import("../packages/application/source-worker.js"),
  { normalizeSourceOrder } =
    await import("../packages/connectors/shopify-source.js"),
  { opaqueIdentity } = await import("../packages/auth/secrets.js"),
  { canonical } = await import("../packages/auth/producer.js");
const runtime = process.env.TEST_RUNTIME_DIR!,
  base = process.env.BLACKBOX_API_URL!,
  fixture = "http://" + process.env.FIXTURE_HOST,
  previous = JSON.parse(
    await readFile(runtime + "/source-operations-state.json", "utf8"),
  ),
  raw = structuredClone(previous.source_orders[0]),
  tenant = randomUUID(),
  owner = "bb_owner_" + randomBytes(32).toString("base64url"),
  agent = "bb_agent_" + randomBytes(32).toString("base64url"),
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
raw.lineItems.pageInfo = { hasNextPage: false, endCursor: null };
delete raw.extraLines;
let headers: Record<string, string>,
  connection: string,
  client: Client | undefined;
async function api(path: string, body?: unknown, h = headers) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: h,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
async function provider(value: any) {
  const r = await fetch(fixture + "/source-scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orders: [value] }),
  });
  assert.equal(r.status, 200);
}
async function drain() {
  for (let i = 0; i < 40; i++) {
    const job = await claimSourceJob(tenant);
    if (!job) return;
    await processSourceJob(job);
    const applied = await fetch(process.env.ENGINE_URL + "/v1/apply", {
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
    assert.equal(applied.status, 200);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw Error("source_conflict_job_budget");
}
try {
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Source conflict synthetic')",
    [tenant],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, key] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Source conflict test')",
      [
        tenant,
        randomUUID(),
        randomUUID(),
        purpose,
        createHash("sha256").update(key).digest("hex"),
      ],
    );
  const login = await fetch(base + "/v1/login", {
      method: "POST",
      headers: { origin: base, "content-type": "application/json" },
      body: JSON.stringify({ key: owner }),
    }),
    csrf = (await login.json()).csrf;
  headers = {
    origin: base,
    "content-type": "application/json",
    cookie: login.headers.getSetCookie()[0].split(";")[0],
    "x-blackbox-csrf": csrf,
  };
  await provider(raw);
  const source = await api("/v1/sources/shopify", {
    name: "Conflict fixture",
    credentials: {
      shop: process.env.FIXTURE_HOST,
      auth: "access_token",
      access_token: "synthetic-fixture-token",
      fixture: true,
    },
  });
  connection = source.connection_id;
  const plan = await api(`/v1/sources/${connection}/import`, {
    selection: {
      preset: "last_30_days",
      timezone: "UTC",
      include_open_items: false,
      include_related_records: true,
      include_opening_state: false,
    },
    capabilities: ["orders", "payments", "refunds"],
    acknowledge_restrictions: true,
  });
  // Genuine persisted compatibility case: old content-addressed source ID, same record identity.
  const normalized = await normalizeSourceOrder(
      raw,
      connection,
      source.account_anchor,
      "orders",
      plan.parameters,
      "recent",
    ),
    legacy = normalized[0].observations[0];
  legacy.id = await opaqueIdentity(
    connection,
    `${legacy.economic_id}:${legacy.occurred_at}:${canonical(legacy.record)}`,
  );
  await ingest(tenant, connection, [legacy], raw);
  await drain();
  const oldRows = (
    await admin.query(
      "SELECT entry_id,payload_hash,payload FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage'",
      [tenant],
    )
  ).rows;
  assert.equal(oldRows.length, 3);
  assert.equal(
    oldRows.find((x) => x.payload.record.dataset === "orders").payload.id,
    legacy.id,
  );
  const head = (
      await admin.query("SELECT committed FROM bb.heads WHERE tenant_id=$1", [
        tenant,
      ])
    ).rows[0].committed,
    entity = legacy.entity_id;
  const readHeaders = {
    "content-type": "application/json",
    authorization: "Bearer " + agent,
  };
  const before = await api(
    "/v1/tools/query_business",
    {
      intent: "orders.payment_state",
      entity_id: entity,
      as_of: plan.parameters.initial_cutoff,
      recorded_cutoff: Number(head),
    },
    readHeaders,
  );
  assert.equal(before.result.rows[0].collected_minor, 1071);
  const healthBefore = await api("/v1/sources/readiness");
  const changed = structuredClone(raw);
  changed.totalPriceSet.shopMoney.amount = "20.00";
  changed.transactions[0].amountSet.shopMoney.amount = "20.00";
  await provider(changed);
  await admin.query(
    "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND kind='reconciliation' AND state='queued'",
    [tenant],
  );
  await drain();
  const afterRows = (
    await admin.query(
      "SELECT entry_id,payload_hash,payload FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage' ORDER BY entry_id",
      [tenant],
    )
  ).rows;
  assert.deepEqual(
    afterRows,
    oldRows.sort((a, b) => a.entry_id.localeCompare(b.entry_id)),
  );
  const reviews = (
    await admin.query(
      "SELECT r.evidence_id,e.sha256 FROM bb.review_cases r JOIN bb.evidence e USING(tenant_id,evidence_id) WHERE r.tenant_id=$1 AND r.kind='provider_content_conflict'",
      [tenant],
    )
  ).rows;
  assert.ok(reviews.length >= 2);
  const readiness = await api("/v1/sources/readiness");
  assert.ok(
    readiness.runs
      .filter((r: any) => r.kind === "reconciliation")
      .some((r: any) => r.quarantined === 1),
  );
  for (const capability of ["orders", "payments"]) {
    const oldHealth = healthBefore.capabilities.find(
      (x: any) => x.capability === capability,
    );
    const current = readiness.capabilities.find(
      (x: any) => x.capability === capability,
    );
    assert.equal(current.effective_state, "needs_review");
    assert.equal(current.last_success_at, oldHealth.last_success_at);
    assert.equal(
      current.last_reconciliation_at,
      oldHealth.last_reconciliation_at,
    );
    assert.ok(current.coverage.unresolved_review_objects > 0);
  }
  // A later empty incremental scan may succeed for its own interval; it cannot repair old conflicts.
  await fetch(fixture + "/source-scenario", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ orders: [] }),
  });
  await admin.query(
    "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND kind='incremental' AND state='queued'",
    [tenant],
  );
  await drain();
  const afterEmpty = await api("/v1/sources/readiness");
  for (const capability of ["orders", "payments"]) {
    const current = afterEmpty.capabilities.find(
      (x: any) => x.capability === capability,
    );
    assert.equal(current.effective_state, "needs_review");
    assert.equal(current.error_code, "source_records_quarantined");
    assert.equal(current.coverage.quarantined_objects, 0);
    assert.ok(current.coverage.unresolved_review_objects > 0);
  }
  const request = {
    intent: "orders.payment_state",
    entity_id: entity,
    as_of: new Date().toISOString(),
  };
  const conflict = await api("/v1/tools/query_business", request, readHeaders);
  assert.equal(conflict.status, "conflict");
  assert.ok(conflict.conflicts.includes("provider_content_conflict"));
  assert.equal(conflict.result.rows[0].collected_minor, 1071);
  const historical = await api(
    "/v1/tools/query_business",
    {
      intent: "orders.payment_state",
      entity_id: entity,
      as_of: plan.parameters.initial_cutoff,
      recorded_cutoff: Number(head),
    },
    readHeaders,
  );
  assert.deepEqual(historical.result, before.result);
  assert.deepEqual(historical.evidence, before.evidence);
  const keyFile = runtime + "/source-conflict-agent-key";
  await writeFile(keyFile, agent, { mode: 0o600 });
  client = new Client({ name: "source-conflict-verifier", version: "1.0.0" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "packages/mcp/main.ts"],
      env: {
        ...(process.env as Record<string, string>),
        BLACKBOX_AGENT_KEY_FILE: keyFile,
        BLACKBOX_API_URL: base,
      },
      stderr: "pipe",
    }),
  );
  const answer = await client.callTool({
    name: "query_business",
    arguments: request,
  });
  assert.ok(!answer.isError);
  assert.equal(
    JSON.parse((answer.content as any[])[0].text).status,
    "conflict",
  );
  const evidence = await client.callTool({
    name: "get_evidence",
    arguments: { evidence_id: reviews[0].evidence_id },
  });
  assert.ok(!evidence.isError);
  const report = {
    suite: "source-provider-conflict-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"]).toString().trim(),
    at: new Date().toISOString(),
    checks: [
      "old_content_addressed_source_identity_replayed_without_duplicate_business_record",
      "changed_order_and_payment_same_provider_revision_quarantined",
      "both_claims_have_scoped_encrypted_evidence",
      "quarantine_does_not_advance_successful_check_or_reconciliation",
      "later_empty_success_preserves_unresolved_health_gap",
      "old_payloads_and_fixed_cutoff_answers_unchanged",
      "current_API_and_actual_SDK_MCP_answers_expose_conflict",
    ],
    synthetic: true,
    result: "passed",
  };
  await writeFile(
    runtime + "/source-conflict-evidence.json",
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report));
} finally {
  if (connection!)
    await api(`/v1/connections/${connection}/state`, { state: "paused" });
  await client?.close();
  await pool.end();
  await admin.end();
}

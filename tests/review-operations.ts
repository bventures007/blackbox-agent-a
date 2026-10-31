import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import pg from "pg";
import { newKey, verifier } from "../packages/auth/index.js";
import { pool, scoped } from "../packages/database/index.js";
import { sendObservations } from "../packages/connectors/replay.js";
import { ingest } from "../packages/application/ingest.js";
import { opaqueIdentity } from "../packages/auth/secrets.js";
import { fixture } from "./questions/fixtures.js";
const base = process.env.BLACKBOX_API_URL!,
  internal = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8"),
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
async function provision() {
  const tenant = randomUUID(),
    connection = randomUUID(),
    owner = newKey("owner"),
    producer = newKey("producer"),
    principal = randomUUID();
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Review operations synthetic')",
    [tenant],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, key] of [
    ["owner", owner],
    ["producer", producer],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Review operations test')",
      [
        tenant,
        randomUUID(),
        purpose === "producer" ? principal : randomUUID(),
        purpose,
        verifier(key),
      ],
    );
  await admin.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'generic',$3,$4)",
    [tenant, connection, randomUUID(), { producer_principal_id: principal }],
  );
  const r = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key: owner }),
  });
  assert.equal(r.status, 200);
  const csrf = (await r.json()).csrf;
  return {
    tenant,
    connection,
    producer,
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie: r.headers.getSetCookie()[0].split(";")[0],
      "x-blackbox-csrf": csrf,
    },
  };
}
async function call(s: any, path: string, body?: unknown, status = 200) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: s.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v = await r.json();
  assert.equal(r.status, status, JSON.stringify(v));
  return v;
}
async function apply(tenant: string) {
  const r = await fetch(process.env.ENGINE_URL + "/v1/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-blackbox-internal": internal,
    },
    body: JSON.stringify({ tenant_id: tenant }),
  });
  assert.equal(r.status, 200);
}
async function resolve(s: any, id: string) {
  await apply(s.tenant);
  for (let n = 0; n < 30; n++) {
    const v = await call(s, "/v1/reviews/" + id + "/check", {});
    if (v.state === "resolved") return v;
  }
  throw Error("review_resolution_budget");
}
async function decision(s: any, id: string, action: string, extra: any = {}) {
  const d = await call(s, "/v1/reviews/" + id);
  return {
    command_id: randomUUID(),
    revision: d.revision,
    action,
    reason_code:
      action === "retry"
        ? "retry_mapping"
        : action === "confirm_link"
          ? "link_confirmed"
          : "link_rejected",
    note: "Synthetic retained evidence verifies this exact review operation.",
    evidence_ids: [d.evidence_id],
    acknowledged: true,
    ...(d.current ? { expected_entry_id: d.current.entry_id } : {}),
    ...extra,
  };
}
try {
  const s = await provision(),
    sample = fixture(14),
    allocation = sample.records.find(
      (r) => r.record.dataset === "payment_allocations",
    )!;
  (allocation.record as any).confidence = "ambiguous";
  await sendObservations(base, s.connection, s.producer, sample.records);
  await apply(s.tenant);
  const query = { intent: "invoices.payment_variance", ...sample.parameters },
    before = await call(s, "/v1/tools/query_business", query);
  assert.equal(before.result.rows[0].allocated_capture_minor, 0);
  const id = (await call(s, "/v1/reviews")).cases[0].case_id;
  assert.equal((await call(s, "/v1/reviews/" + id)).kind, "unresolved_link");
  await call(
    s,
    "/v1/reviews/" + id + "/decisions",
    await decision(s, id, "confirm_link"),
  );
  await resolve(s, id);
  const after = await call(s, "/v1/tools/query_business", query);
  assert.equal(after.result.rows[0].allocated_capture_minor, 5000);
  assert.equal(after.result.rows[0].remaining_minor, 4520);
  // A separate ambiguous proposed link is rejected, without manufacturing a payment or allocation.
  const rejected = await provision(),
    f = fixture(14),
    a = f.records.find((r) => r.record.dataset === "payment_allocations")!;
  (a.record as any).confidence = "ambiguous";
  await sendObservations(
    base,
    rejected.connection,
    rejected.producer,
    f.records,
  );
  await apply(rejected.tenant);
  const rid = (await call(rejected, "/v1/reviews")).cases[0].case_id;
  await call(
    rejected,
    "/v1/reviews/" + rid + "/decisions",
    await decision(rejected, rid, "reject_link"),
  );
  await resolve(rejected, rid);
  assert.equal(
    (
      await call(rejected, "/v1/tools/query_business", {
        intent: "invoices.payment_variance",
        ...f.parameters,
      })
    ).result.rows[0].allocated_capture_minor,
    0,
  );
  const foreign = await provision(),
    foreignF = fixture(14),
    fa = foreignF.records.find(
      (r) => r.record.dataset === "payment_allocations",
    )!;
  (fa.record as any).confidence = "ambiguous";
  (fa.record as any).transaction_id = (allocation.record as any).transaction_id;
  await sendObservations(
    base,
    foreign.connection,
    foreign.producer,
    foreignF.records,
  );
  await apply(foreign.tenant);
  const foreignId = (await call(foreign, "/v1/reviews")).cases[0].case_id;
  await call(
    foreign,
    "/v1/reviews/" + foreignId + "/decisions",
    await decision(foreign, foreignId, "confirm_link"),
    409,
  );
  const race = await provision(),
    raceFixture = fixture(12),
    racePayment = raceFixture.records.find(
      (r) => r.record.dataset === "payments" && r.record.status === "captured",
    )!;
  await sendObservations(
    base,
    race.connection,
    race.producer,
    raceFixture.records,
  );
  await apply(race.tenant);
  const raceClaim = structuredClone(racePayment);
  (raceClaim.record as any).amount_minor = 6000;
  await sendObservations(base, race.connection, race.producer, [raceClaim]);
  const raceId = (await call(race, "/v1/reviews")).cases[0].case_id;
  const raceBody = await decision(race, raceId, "correct", {
    reason_code: "human_observation",
    record: raceClaim.record,
  });
  const proposals = [
    raceBody,
    {
      ...raceBody,
      command_id: randomUUID(),
      record: { ...raceClaim.record, amount_minor: 7000 },
    },
  ];
  const raced = await Promise.all(
    proposals.map(async (b) => {
      const r = await fetch(base + "/v1/reviews/" + raceId + "/decisions", {
        method: "POST",
        headers: race.headers,
        body: JSON.stringify(b),
      });
      return {
        status: r.status,
        value: await r.json(),
        amount: (b.record as any).amount_minor,
      };
    }),
  );
  assert.deepEqual(raced.map((r) => r.status).sort(), [200, 409]);
  await resolve(race, raceId);
  assert.equal(
    (
      await call(race, "/v1/tools/query_business", {
        intent: "orders.payment_state",
        ...raceFixture.parameters,
      })
    ).result.rows[0].collected_minor,
    raced.find((r) => r.status === 200)!.amount,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*) FROM bb.review_decisions WHERE tenant_id=$1",
        [race.tenant],
      )
    ).rows[0].count,
    "1",
  );
  // Real protected retained source inputs; injected prior parser failure establishes the retry precondition.
  const retry = await provision(),
    source = await call(retry, "/v1/sources/shopify", {
      name: "Retained input retry fixture",
      credentials: {
        shop: process.env.FIXTURE_HOST,
        auth: "access_token",
        access_token: "synthetic-fixture-token",
        fixture: true,
      },
    });
  const plan = await call(retry, `/v1/sources/${source.connection_id}/import`, {
    selection: {
      preset: "last_30_days",
      timezone: "UTC",
      include_open_items: false,
      include_related_records: true,
      include_opening_state: false,
    },
    capabilities: ["orders"],
    acknowledge_restrictions: true,
  });
  const run = (
    await admin.query(
      "SELECT run_id FROM bb.source_jobs WHERE tenant_id=$1 AND connection_id=$2 AND kind='initial'",
      [retry.tenant, source.connection_id],
    )
  ).rows[0].run_id;
  const prior = JSON.parse(
      await readFile(
        process.env.TEST_RUNTIME_DIR + "/source-operations-state.json",
        "utf8",
      ),
    ),
    raw = structuredClone(prior.source_orders[0]);
  raw.lineItems.pageInfo = { hasNextPage: false, endCursor: null };
  delete raw.extraLines;
  async function quarantine(value: any, kind: string) {
    const r = await ingest(retry.tenant, source.connection_id, [], value),
      id = randomUUID(),
      object = await opaqueIdentity(source.connection_id, "orders:" + value.id);
    await admin.query(
      "INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,kind,evidence_id,run_id,object_id)VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        retry.tenant,
        id,
        source.connection_id,
        kind,
        r.evidence_id,
        run,
        object,
      ],
    );
    return id;
  }
  const valid = await quarantine(raw, "injected_previous_parser_failure");
  const saved = await call(
    retry,
    "/v1/reviews/" + valid + "/decisions",
    await decision(retry, valid, "retry"),
  );
  assert.equal(saved.state, "recalculating");
  await resolve(retry, valid);
  assert.equal(
    (
      await admin.query(
        "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'='orders'",
        [retry.tenant],
      )
    ).rows[0].count,
    "1",
  );
  const originalOrder = (
    await admin.query(
      "SELECT payload FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'='orders'",
      [retry.tenant],
    )
  ).rows[0].payload;
  assert.equal(originalOrder.record.gross_minor, 1071);
  const poison = structuredClone(raw);
  poison.id = "gid://shopify/Order/retry-poison";
  poison.totalPriceSet.shopMoney.currencyCode = "USD";
  const poisonId = await quarantine(poison, "provider_currency_conflict");
  for (let n = 0; n < 3; n++) {
    const r = await call(
      retry,
      "/v1/reviews/" + poisonId + "/decisions",
      await decision(retry, poisonId, "retry"),
    );
    assert.equal(r.state, "unresolved");
  }
  await call(
    retry,
    "/v1/reviews/" + poisonId + "/decisions",
    await decision(retry, poisonId, "retry"),
    409,
  );
  assert.equal((await call(retry, "/v1/reviews/" + poisonId)).retry_count, 3);
  const expired = randomUUID(),
    expiredCase = randomUUID();
  await admin.query(
    "INSERT INTO bb.evidence(tenant_id,evidence_id,sha256,expires_at)VALUES($1,$2,$3,now()-interval '1 second')",
    [retry.tenant, expired, "0".repeat(64)],
  );
  await admin.query(
    "INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,kind,evidence_id,run_id,object_id)VALUES($1,$2,$3,'expired_retry_input',$4,$5,$6)",
    [
      retry.tenant,
      expiredCase,
      source.connection_id,
      expired,
      run,
      randomUUID(),
    ],
  );
  const expiredReply = await call(
    retry,
    "/v1/reviews/" + expiredCase + "/decisions",
    await decision(retry, expiredCase, "retry"),
    409,
  );
  assert.equal(expiredReply.error, "review_evidence_unavailable");
  await call(retry, `/v1/connections/${source.connection_id}/state`, {
    state: "paused",
  });
  await assert.rejects(
    scoped(s.tenant, (c) =>
      c.query("UPDATE bb.review_decisions SET reason_code='changed'"),
    ),
    (e: any) => e.code === "42501",
  );
  assert.equal(
    (
      await scoped(foreign.tenant, (c) =>
        c.query("SELECT * FROM bb.review_decisions WHERE tenant_id=$1", [
          s.tenant,
        ]),
      )
    ).rowCount,
    0,
  );
  await admin.query(
    "UPDATE bb.credentials SET revoked_at=now() WHERE tenant_id=$1 AND purpose='session'",
    [foreign.tenant],
  );
  await call(
    foreign,
    "/v1/reviews/" + foreignId + "/decisions",
    { command_id: randomUUID() },
    401,
  );
  console.log(
    JSON.stringify({
      suite: "owner-review-operations-v1",
      result: "passed",
      checks: [
        "confirmed_link_reallocates_existing_capture_without_new_cash",
        "competing_distinct_decisions_at_same_revision_apply_once",
        "rejected_link_excluded_from_allocation",
        "cross_workspace_link_target_rejected",
        "protected_original_source_retry_persisted_and_resolved_after_Rust_checks",
        "poison_input_three_attempt_bound_and_no_false_completion",
        "expired_original_input_cannot_reprocess",
        "actual_API_role_decision_immutability_and_tenant_RLS",
        "revoked_owner_session_cannot_decide",
      ],
      limitations: [
        "Prior parser failure injected as an accepted encrypted quarantine; not a live provider incident",
      ],
    }),
  );
} finally {
  await admin.end();
  await pool.end();
}

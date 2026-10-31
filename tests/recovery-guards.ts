import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { localApiRequest } from "../packages/transport/local-api.js";
process.env.DATABASE_URL = process.env.WORKER_DATABASE_URL!;
const { newKey, verifier } = await import("../packages/auth/index.js");
const { claimSourceJob, assertLease } =
  await import("../packages/application/source-worker.js");
const { scoped, pool } = await import("../packages/database/index.js");
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const { a, b } = JSON.parse(
  await readFile(`${process.env.TEST_RUNTIME_DIR}/slice-case.json`, "utf8"),
);
const base = process.env.BLACKBOX_API_URL!;
const connection = randomUUID(),
  plan = randomUUID(),
  run = randomUUID(),
  job = randomUUID(),
  agent = newKey("agent");
async function call(key: string, tool: string, body: unknown) {
  const r = await localApiRequest(base, `/v1/tools/${tool}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  return (await r.json()) as any;
}
try {
  assert.equal(
    (await pool.query("SELECT current_user AS role")).rows[0].role,
    "bb_worker",
  );
  const names = await admin.query(
    "SELECT tenant_id,name FROM bb.workspaces WHERE tenant_id=ANY($1::uuid[])",
    [[a.tenant, b.tenant]],
  );
  assert.equal(names.rowCount, 2);
  assert.ok(
    names.rows.every((r) => ["Synthetic A", "Synthetic B"].includes(r.name)),
  );
  await admin.query(
    "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,'agent',$4,'Synthetic recovery guard probe')",
    [a.tenant, randomUUID(), randomUUID(), verifier(agent)],
  );
  const before = await call(b.agent, "get_business_state", {
    entity_id: b.entities[0],
  });
  const evidence = before.result.evidence[0];
  const other = await call(agent, "get_business_state", {
    entity_id: a.entities[0],
  });
  assert.equal(
    (await call(b.agent, "get_evidence", { evidence_id: evidence })).status,
    "available",
  );
  await admin.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor)VALUES($1,$2,'shopify',$3)",
    [b.tenant, connection, randomUUID()],
  );
  await admin.query(
    "INSERT INTO bb.import_plans(tenant_id,plan_id,connection_id,revision,selected_by,parameters,capabilities,provider_revision)VALUES($1,$2,$3,1,$4,'{}',ARRAY['orders'],'synthetic-guard')",
    [b.tenant, plan, connection, randomUUID()],
  );
  await admin.query(
    "INSERT INTO bb.import_runs(tenant_id,run_id,connection_id,plan_id)VALUES($1,$2,$3,$4)",
    [b.tenant, run, connection, plan],
  );
  await admin.query(
    "INSERT INTO bb.source_secrets(tenant_id,connection_id,key_version,sealed,validated_at)VALUES($1,$2,'data-v1','{}',now())",
    [b.tenant, connection],
  );
  await admin.query(
    "INSERT INTO bb.source_jobs(tenant_id,job_id,connection_id,plan_id,capability,kind,run_id)VALUES($1,$2,$3,$4,'orders','initial',$5)",
    [b.tenant, job, connection, plan, run],
  );
  const leased = await claimSourceJob(b.tenant);
  assert.equal(leased?.job_id, job);
  await admin.query("INSERT INTO bb.recovery_guards(tenant_id)VALUES($1)", [
    b.tenant,
  ]);
  await assert.rejects(scoped(b.tenant, (c) => assertLease(c, leased!)));
  await admin.query(
    "UPDATE bb.source_jobs SET state='queued',lease_owner=NULL,leased_until=NULL WHERE tenant_id=$1 AND job_id=$2",
    [b.tenant, job],
  );
  assert.equal(await claimSourceJob(b.tenant), null);
  assert.equal(
    (
      await pool.query(
        "SELECT * FROM bb.pending_source_tenants() WHERE tenant_id=$1",
        [b.tenant],
      )
    ).rowCount,
    0,
  );
  assert.equal(
    (await call(b.agent, "get_evidence", { evidence_id: evidence })).status,
    "unavailable",
  );
  assert.equal(
    (
      await call(agent, "get_evidence", {
        evidence_id: other.result.evidence[0],
      })
    ).status,
    "available",
  );
  assert.deepEqual(
    (await call(b.agent, "get_business_state", { entity_id: b.entities[0] }))
      .result,
    before.result,
  );
  await scoped(a.tenant, async (c) =>
    assert.equal(
      (await c.query("SELECT * FROM bb.recovery_guards")).rowCount,
      0,
    ),
  );
  await assert.rejects(
    scoped(b.tenant, (c) =>
      c.query("UPDATE bb.recovery_guards SET evidence_blocked=false"),
    ),
  );
  await admin.query(
    "UPDATE bb.recovery_guards SET evidence_blocked=false WHERE tenant_id=$1",
    [b.tenant],
  );
  assert.equal(
    (await call(b.agent, "get_evidence", { evidence_id: evidence })).status,
    "available",
  );
  assert.equal(await claimSourceJob(b.tenant), null);
  console.log(
    JSON.stringify({
      suite: "persisted_recovery_guards",
      status: "passed",
      checks: [
        "restored_raw_evidence_blocked",
        "numeric_state_preserved",
        "provider_job_claim_and_existing_lease_fenced",
        "pending_scheduler_excludes_guarded_tenant",
        "cross_tenant_guard_isolation",
        "runtime_cannot_unblock_guard",
        "policy_unblock_does_not_resume_sources",
      ],
      limitations: ["Guard subset only; no full database restore approval"],
    }),
  );
} finally {
  await admin.query(
    "UPDATE bb.source_jobs SET state='cancelled',lease_owner=NULL,leased_until=NULL WHERE tenant_id=$1 AND job_id=$2",
    [b.tenant, job],
  );
  await admin.query(
    "UPDATE bb.connections SET state='paused' WHERE tenant_id=$1 AND connection_id=$2",
    [b.tenant, connection],
  );
  await admin.query("DELETE FROM bb.recovery_guards WHERE tenant_id=$1", [
    b.tenant,
  ]);
  await admin.query(
    "UPDATE bb.credentials SET revoked_at=now() WHERE verifier=$1",
    [verifier(agent)],
  );
  await admin.end();
  await pool.end();
}

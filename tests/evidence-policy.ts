/** Actual PostgreSQL/API/Rust/MCP policy boundaries using isolated synthetic tenants. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { newKey, verifier } from "../packages/auth/index.js";
import { ingest } from "../packages/application/ingest.js";
import { pool as applicationPool } from "../packages/database/index.js";
import { fixture } from "./questions/fixtures.js";
import { runtimeFingerprint } from "../packages/runtime/compatibility.js";
const base = process.env.BLACKBOX_API_URL!,
  runtime = process.env.TEST_RUNTIME_DIR!,
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const check = (message: string) => console.log(message);
async function call(
  path: string,
  body: unknown,
  headers: Record<string, string>,
  status = 200,
) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  return value;
}
async function provision() {
  const tenant = randomUUID(),
    connection = randomUUID(),
    owner = newKey("owner"),
    agent = newKey("agent");
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Evidence policy synthetic')",
    [tenant],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, key] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Policy test')",
      [tenant, randomUUID(), randomUUID(), purpose, verifier(key)],
    );
  await admin.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'generic',$3,$4)",
    [tenant, connection, randomUUID(), { name: "Synthetic retention source" }],
  );
  const r = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key: owner }),
  });
  assert.equal(r.status, 200);
  return {
    tenant,
    connection,
    owner,
    agent,
    headers: {
      origin: base,
      "x-blackbox-csrf": (await r.json()).csrf,
      cookie: r.headers.getSetCookie()[0].split(";")[0],
    },
  };
}
async function mcp(s: any, tool: string, args: any) {
  const c = new Client({ name: "evidence-policy-proof", version: "1" });
  await c.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "packages/mcp/main.ts"],
      env: {
        ...(process.env as Record<string, string>),
        BLACKBOX_AGENT_KEY: s.agent,
        BLACKBOX_API_URL: base,
      },
      stderr: "pipe",
    }),
  );
  try {
    const r = await c.callTool({ name: tool, arguments: args });
    assert.ok(!r.isError);
    return JSON.parse((r.content as any[])[0].text);
  } finally {
    await c.close();
  }
}
const evidence = (s: any, id: string) =>
  call(
    "/v1/tools/get_evidence",
    { evidence_id: id },
    { authorization: "Bearer " + s.agent },
  );
const policy = (
  s: any,
  days: number,
  kind: string | null = "typed_submission",
  connection: string | null = s.connection,
) =>
  call(
    "/v1/evidence-policy",
    {
      connection_id: connection,
      evidence_class: kind,
      days,
      reason: days > 90 ? "business_requirement" : "minimize_content",
      acknowledged: true,
    },
    s.headers,
  );
try {
  const phase = process.argv[2] ?? "seed";
  if (phase === "seed") {
    const s = await provision(),
      other = await provision(),
      sample = fixture(12),
      canary = "synthetic-retention-person@example.test";
    const initial = await ingest(s.tenant, s.connection, sample.records, {
      canary,
      secret: "synthetic-retention-secret",
    });
    const meta = (
      await admin.query(
        "SELECT * FROM bb.evidence_retention WHERE tenant_id=$1 AND evidence_id=$2",
        [s.tenant, initial.evidence_id],
      )
    ).rows[0];
    assert.equal(meta.evidence_class, "typed_submission");
    assert.ok(
      Math.abs((+meta.expires_at - +meta.created_at) / 86400000 - 90) < 0.00001,
    );
    assert.ok(+meta.created_at > Date.now() - 60000);
    assert.equal(
      (await evidence(s, initial.evidence_id)).content.canary,
      canary,
    );
    assert.deepEqual(await evidence(other, initial.evidence_id), {
      status: "unavailable",
    });
    const canonical = (
      await admin.query(
        "SELECT payload::text FROM bb.journal WHERE tenant_id=$1",
        [s.tenant],
      )
    ).rows
      .map((r) => r.payload)
      .join("");
    assert.ok(
      !canonical.includes(canary) &&
        !canonical.includes("synthetic-retention-secret"),
    );
    check(
      "historical_typed_ingest_uses_local_receipt_90_days_and_protected_canaries_with_cross_tenant_denial",
    );
    await fetch(process.env.ENGINE_URL + "/v1/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbox-contract": runtimeFingerprint,
        "x-blackbox-internal": await readFile(
          process.env.INTERNAL_KEY_FILE!,
          "utf8",
        ),
      },
      body: JSON.stringify({ tenant_id: s.tenant }),
    });
    const request = { intent: "orders.payment_state", ...sample.parameters };
    const answer = await call("/v1/tools/query_business", request, {
      authorization: "Bearer " + s.agent,
    });
    assert.equal(answer.result.rows[0].collected_minor, 5000);
    const fixed = { ...request, recorded_cutoff: answer.recorded_cutoff };
    await call(
      "/v1/evidence-policy",
      undefined,
      { authorization: "Bearer " + s.agent },
      403,
    );
    const input = {
      connection_id: s.connection,
      evidence_class: "typed_submission",
      days: 180,
      reason: "default_policy",
      acknowledged: true,
    };
    await call("/v1/evidence-policy", input, s.headers, 400);
    await call(
      "/v1/evidence-policy",
      { ...input, days: 30 },
      { ...s.headers, "x-blackbox-csrf": "invalid" },
      403,
    );
    await call(
      "/v1/evidence-policy",
      { ...input, days: 30 },
      other.headers,
      404,
    );
    await policy(s, 180);
    const longer = await ingest(s.tenant, s.connection, [], {
      canary: "future only",
    });
    let rows = (
      await admin.query(
        "SELECT evidence_id,extract(epoch from expires_at-created_at)/86400 days FROM bb.evidence_retention WHERE tenant_id=$1 AND evidence_id=ANY($2::uuid[])",
        [s.tenant, [initial.evidence_id, longer.evidence_id]],
      )
    ).rows;
    assert.ok(
      Number(rows.find((r) => r.evidence_id === initial.evidence_id).days) < 91,
    );
    assert.ok(
      Number(rows.find((r) => r.evidence_id === longer.evidence_id).days) > 179,
    );
    await policy(s, 1);
    await policy(s, 365);
    rows = (
      await admin.query(
        "SELECT extract(epoch from effective_expires_at-created_at)/86400 days FROM bb.evidence_retention WHERE tenant_id=$1",
        [s.tenant],
      )
    ).rows;
    assert.ok(rows.every((r) => Number(r.days) <= 1));
    check(
      "owner_CSRF_tenant_and_longer_policy_boundaries_and_permanent_shortening_pass",
    );
    await admin.query(
      "INSERT INTO bb.evidence_provider_limits(tenant_id,limit_id,connection_id,evidence_class,days)VALUES($1,$2,$3,'typed_submission',2)",
      [s.tenant, randomUUID(), s.connection],
    );
    const capped = await ingest(s.tenant, s.connection, [], {
      provider: "strict",
    });
    const ceiling = (
      await admin.query(
        "SELECT extract(epoch from expires_at-created_at)/86400 days FROM bb.evidence WHERE tenant_id=$1 AND evidence_id=$2",
        [s.tenant, capped.evidence_id],
      )
    ).rows[0];
    assert.ok(Number(ceiling.days) <= 2.00001);
    const aged = randomUUID();
    await admin.query(
      "INSERT INTO bb.evidence(tenant_id,evidence_id,sha256,created_at,expires_at)VALUES($1,$2,$3,now()-interval '3 days',now()+interval '87 days')",
      [s.tenant, aged, "a".repeat(64)],
    );
    await admin.query(
      "INSERT INTO bb.evidence_context(tenant_id,evidence_id,connection_id,evidence_class)VALUES($1,$2,$3,'typed_submission')",
      [s.tenant, aged, s.connection],
    );
    assert.deepEqual(await evidence(s, aged), { status: "unavailable" });
    assert.deepEqual(await mcp(s, "get_evidence", { evidence_id: aged }), {
      status: "unavailable",
    });
    await call(
      `/v1/evidence/${initial.evidence_id}/restrict`,
      { acknowledged: true },
      other.headers,
      404,
    );
    await call(
      `/v1/evidence/${initial.evidence_id}/restrict`,
      { acknowledged: true },
      { authorization: "Bearer " + s.agent },
      403,
    );
    await call(
      `/v1/evidence/${initial.evidence_id}/restrict`,
      { acknowledged: true },
      s.headers,
    );
    assert.deepEqual(await evidence(s, initial.evidence_id), {
      status: "unavailable",
    });
    assert.deepEqual(
      await mcp(s, "get_evidence", { evidence_id: initial.evidence_id }),
      { status: "unavailable" },
    );
    assert.deepEqual(
      (await mcp(s, "query_business", fixed)).result,
      answer.result,
    );
    check(
      "stricter_provider_ceiling_expiry_and_restriction_deny_API_and_actual_MCP_while_fixed_business_answer_survives",
    );
    const roles = [
      process.env.DATABASE_URL,
      process.env.WORKER_DATABASE_URL,
      process.env.ENGINE_DATABASE_URL,
    ];
    for (const url of roles) {
      const p = new pg.Pool({ connectionString: url });
      const c = await p.connect();
      try {
        for (const table of [
          "evidence_context",
          "evidence_policies",
          "evidence_provider_limits",
          "evidence_restrictions",
          "evidence_disposals",
        ]) {
          await c.query("BEGIN");
          await c.query("SELECT set_config('bb.tenant_id',$1,true)", [
            s.tenant,
          ]);
          assert.equal(
            Number(
              (
                await c.query(
                  `SELECT count(*) FROM bb.${table} WHERE tenant_id=$1`,
                  [other.tenant],
                )
              ).rows[0].count,
            ),
            0,
          );
          await assert.rejects(c.query(`DELETE FROM bb.${table}`));
          await c.query("ROLLBACK");
        }
      } finally {
        c.release();
        await p.end();
      }
    }
    await writeFile(
      join(runtime, "evidence-policy-proof.json"),
      JSON.stringify({ s, other, initial, aged, capped, fixed, answer }),
      { mode: 0o600 },
    );
    check(
      "real_API_worker_engine_roles_cannot_delete_policy_ledger_or_cross_tenant_boundaries",
    );
  } else {
    const p = JSON.parse(
      await readFile(join(runtime, "evidence-policy-proof.json"), "utf8"),
    );
    assert.deepEqual(await evidence(p.s, p.initial.evidence_id), {
      status: "unavailable",
    });
    assert.deepEqual(await mcp(p.s, "get_evidence", { evidence_id: p.aged }), {
      status: "unavailable",
    });
    assert.deepEqual(
      (await mcp(p.s, "query_business", p.fixed)).result,
      p.answer.result,
    );
    check(
      "restart_preserves_expiry_restriction_and_fixed_cutoff_Rust_MCP_answer",
    );
  }
} finally {
  await admin.end();
  await applicationPool.end();
}

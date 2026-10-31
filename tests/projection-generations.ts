// Real PostgreSQL/Rust/API/SDK-MCP adversarial generation test; no mocked reducer.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { pool, scoped } from "../packages/database/index.js";
import { ingest } from "../packages/application/ingest.js";
import { newKey, verifier } from "../packages/auth/index.js";
import { runtimeFingerprint } from "../packages/runtime/compatibility.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const internal = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8");
const phase = process.argv[2] ?? "seed",
  path = "work/projection-generation-fixture.json";
const engine = async (url: string, body: any, expected = 200) => {
  const response = await fetch(process.env.ENGINE_URL + url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-blackbox-internal": internal,
      "x-blackbox-contract": runtimeFingerprint,
    },
    body: JSON.stringify(body),
  });
  const value: any = await response.json();
  assert.equal(response.status, expected, JSON.stringify(value));
  return value;
};
async function read(
  key: string,
  entity: string,
  version?: string,
  expected = 200,
) {
  const r = await fetch(
    process.env.BLACKBOX_API_URL + "/v1/tools/get_business_state",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + key,
      },
      body: JSON.stringify({
        entity_id: entity,
        ...(version ? { interpretation_version: version } : {}),
      }),
    },
  );
  const body: any = await r.json();
  assert.equal(r.status, expected);
  return body;
}
async function grant(tenant: string) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO bb.projection_builds(tenant_id,build_id,source_generation_id,source_rule,target_rule,source_cutoff,target_cutoff)SELECT tenant_id,$2,projection_generation,projection_rule,'lifecycle-v3',committed,committed FROM bb.heads WHERE tenant_id=$1",
    [tenant, id],
  );
  return id;
}
async function step(
  tenant: string,
  id: string,
  action = "step",
  expected = 200,
) {
  return engine(
    "/v1/projection-build",
    { tenant_id: tenant, build_id: id, action },
    expected,
  );
}
async function finish(tenant: string, id: string) {
  let s;
  for (let i = 0; i < 30; i++) {
    s = await step(tenant, id);
    if (s.state === "ready") return s;
  }
  throw Error("build_not_ready");
}
async function digest(tenant: string) {
  const rows = (
    await db.query(
      "SELECT to_jsonb(j) AS row FROM bb.journal j WHERE tenant_id=$1 ORDER BY sequence",
      [tenant],
    )
  ).rows;
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
const event = (entity: string, kind: string, amount = 0, extra: any = {}) => ({
  id: randomUUID(),
  entity_id: entity,
  kind,
  amount_minor: amount,
  currency: "EUR",
  economic_id: randomUUID(),
  occurred_at: "2026-10-31T09:00:00Z",
  test: false,
  ...extra,
});
try {
  if (phase === "seed") {
    const tenant = randomUUID(),
      other = randomUUID(),
      connection = randomUUID(),
      entity = randomUUID(),
      shipment = randomUUID(),
      agent = newKey("agent"),
      credential = randomUUID();
    for (const t of [tenant, other]) {
      await db.query(
        "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic generation proof')",
        [t],
      );
      await db.query(
        "INSERT INTO bb.heads(tenant_id,projection_rule)VALUES($1,'lifecycle-v2')",
        [t],
      );
    }
    await db.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,'agent',$4,'Synthetic generation reader')",
      [tenant, credential, randomUUID(), verifier(agent)],
    );
    await db.query(
      "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor)VALUES($1,$2,'generic',$3)",
      [tenant, connection, randomUUID()],
    );
    const economic = randomUUID(),
      dispatch = randomUUID();
    const observations = [
      event(entity, "order.accepted", 10000),
      event(entity, "payment.captured", 2000, { economic_id: economic }),
      event(entity, "payment.captured", 1000, {
        economic_id: economic,
        occurred_at: "2026-10-31T09:00:00.100Z",
      }),
      event(shipment, "shipment.dispatched", 0, {
        economic_id: dispatch,
        occurred_at: "2026-10-31T09:00:00.100Z",
        quantity: "1",
        details: {
          item_id: randomUUID(),
          location_id: randomUUID(),
          unit: "piece",
        },
      }),
      event(shipment, "shipment.delivered", 0, {
        details: { related_id: dispatch },
      }),
      ...Array.from({ length: 28 }, () =>
        event(randomUUID(), "order.accepted", 1900),
      ),
    ];
    await ingest(tenant, connection, observations as any, { synthetic: true });
    await engine("/v1/apply", { tenant_id: tenant });
    assert.equal((await read(agent, entity)).result.captured_minor, 2000);
    assert.equal(
      (await read(agent, shipment)).result.shipment_status,
      "delivered",
    );
    const build = await grant(tenant);
    assert.equal((await step(tenant, build)).processed, 25);
    assert.equal((await read(agent, entity)).rule_version, "lifecycle-v2");
    await writeFile(
      path,
      JSON.stringify({
        tenant,
        other,
        connection,
        entity,
        shipment,
        agent,
        credential,
        build,
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        status: "seeded",
        entities: 30,
        candidate_batch: 25,
        next: "Restart the actual native engine/PostgreSQL/API, then run verify.",
      }),
    );
  } else if (phase === "restart") {
    const f = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual((await read(f.agent, f.entity)).result, f.expected);
    await db.query(
      "DELETE FROM bb.projections WHERE tenant_id=$1 AND generation_id=$2",
      [f.tenant, f.published],
    );
    assert.deepEqual((await read(f.agent, f.shipment)).result.conflicts, [
      "delivery_precedes_dispatch",
    ]);
    assert.equal(await digest(f.tenant), f.journal);
    await db.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE tenant_id=$1 AND credential_id=$2",
      [f.tenant, f.credential],
    );
    await read(f.agent, f.entity, undefined, 401);
    console.log(
      JSON.stringify({
        status: "passed",
        phase,
        checks: [
          "published_generation_survives_restart",
          "missing_active_projection_uses_versioned_cold_replay",
          "journal_still_unchanged",
          "revocation_denies_cached_state",
        ],
      }),
    );
  } else {
    const f = JSON.parse(await readFile(path, "utf8"));
    const { tenant, other, connection, entity, shipment, agent, credential } =
      f;
    assert.equal(
      Number(
        (
          await db.query(
            "SELECT built_count FROM bb.projection_builds WHERE tenant_id=$1 AND build_id=$2",
            [tenant, f.build],
          )
        ).rows[0].built_count,
      ),
      25,
    );
    await assert.rejects(
      () =>
        scoped(tenant, (c) =>
          c.query(
            "INSERT INTO bb.projection_builds(tenant_id,build_id,source_generation_id,source_rule,target_rule,source_cutoff,target_cutoff)VALUES($1,$2,$2,'lifecycle-v2','lifecycle-v3',0,0)",
            [tenant, randomUUID()],
          ),
        ),
      /permission denied/,
    );
    assert.equal(
      (await step(other, f.build, "step", 503)).error,
      "host_build_grant_required",
    );
    await finish(tenant, f.build);
    // A new source arrives after verification; publish must return to catch-up.
    await ingest(
      tenant,
      connection,
      [event(entity, "payment.captured", 300)] as any,
      { synthetic_tail: true },
    );
    await engine("/v1/apply", { tenant_id: tenant });
    assert.equal((await step(tenant, f.build, "publish")).state, "catching_up");
    await finish(tenant, f.build);
    assert.equal((await read(agent, entity)).result.captured_minor, 2300);
    await db.query(
      "UPDATE bb.projections SET checksum='corrupt' WHERE tenant_id=$1 AND generation_id=$2 AND entity_id=$3",
      [tenant, f.build, entity],
    );
    assert.equal(
      (await step(tenant, f.build, "publish", 503)).error,
      "candidate_corrupt",
    );
    assert.equal(
      (
        await db.query(
          "SELECT state FROM bb.projection_builds WHERE tenant_id=$1 AND build_id=$2",
          [tenant, f.build],
        )
      ).rows[0].state,
      "failed",
    );
    assert.equal((await read(agent, entity)).rule_version, "lifecycle-v2");
    const build = await grant(tenant);
    await finish(tenant, build);
    const journal = await digest(tenant),
      before = await read(agent, entity);
    const during = Array.from({ length: 8 }, () => read(agent, entity));
    assert.equal((await step(tenant, build, "publish")).state, "published");
    for (const result of await Promise.all(during))
      assert.ok(
        (result.rule_version === "lifecycle-v2" &&
          result.result.captured_minor === 2300) ||
          (result.rule_version === "lifecycle-v3" &&
            result.result.captured_minor === 1300),
      );
    const current = await read(agent, entity);
    assert.equal(current.rule_version, "lifecycle-v3");
    assert.equal(current.result.captured_minor, 1300);
    assert.equal(current.recorded_cutoff, before.recorded_cutoff);
    const shipping = await read(agent, shipment);
    assert.equal(shipping.result.shipment_status, "dispatched");
    assert.deepEqual(shipping.result.conflicts, ["delivery_precedes_dispatch"]);
    const prior = await read(agent, entity, "lifecycle-v2");
    assert.equal(prior.result.captured_minor, 2300);
    assert.deepEqual(prior.result.input_entries, current.result.input_entries);
    assert.deepEqual(prior.result.evidence, current.result.evidence);
    await read(agent, entity, "unknown-rule", 400);
    assert.equal(await digest(tenant), journal);
    const transport = new StdioClientTransport({
      command: "node",
      args: ["--import", "tsx", "packages/mcp/main.ts"],
      env: {
        ...(process.env as Record<string, string>),
        BLACKBOX_AGENT_KEY: agent,
      },
    });
    const client = new Client({ name: "generation-proof", version: "1" });
    await client.connect(transport);
    try {
      for (const version of ["lifecycle-v2", "lifecycle-v3"]) {
        const r = await client.callTool({
          name: "get_business_state",
          arguments: { entity_id: entity, interpretation_version: version },
        });
        assert.ok(!r.isError);
        const body = JSON.parse((r.content as any)[0].text);
        assert.equal(
          body.result.captured_minor,
          version === "lifecycle-v2" ? 2300 : 1300,
        );
      }
    } finally {
      await client.close();
    }
    f.published = build;
    f.journal = journal;
    f.expected = current.result;
    await writeFile(path, JSON.stringify(f), { mode: 0o600 });
    console.log(
      JSON.stringify({
        status: "passed",
        phase,
        checks: [
          "restart_resumes_candidate_keyset",
          "API_cannot_create_host_grants",
          "foreign_tenant_cannot_advance_grant",
          "tail_returns_verified_build_to_catchup",
          "corrupt_candidate_fails_without_publication",
          "concurrent_reads_use_whole_old_or_new_interpretation",
          "real_v2_money_and_delivery_defects_corrected",
          "explicit_prior_interpretation_preserved",
          "actual_SDK_MCP_versions_match_API",
          "complete_journal_unchanged",
        ],
      }),
    );
  }
} finally {
  await db.end();
  await pool.end();
}

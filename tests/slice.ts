import { localApiRequest } from "../packages/transport/local-api.js";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import http from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { importShopify } from "../packages/connectors/shopify.js";
import { pool, scoped } from "../packages/database/index.js";
import { newKey, verifier } from "../packages/auth/index.js";
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const base = process.env.BLACKBOX_API_URL!;
const headers = {
  host: `127.0.0.1:${process.env.PUBLIC_PORT ?? 18741}`,
  "content-type": "application/json",
};
async function call(key: string, tool: string, body: unknown) {
  const response = await localApiRequest(base, `/v1/tools/${tool}`, {
    method: "POST",
    headers: { ...headers, authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
  });
  return { code: response.status, body: (await response.json()) as any };
}
async function ready(key: string, entity: string) {
  for (let n = 0; n < 100; n++) {
    const r = await call(key, "get_business_state", { entity_id: entity });
    if (r.code === 200) return r.body;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw Error("projection did not catch up");
}
async function mcp(key: string, entity: string, cutoff: number) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "packages/mcp/main.ts"],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (x): x is [string, string] => x[1] !== undefined,
        ),
      ),
      BLACKBOX_AGENT_KEY: key,
    },
  });
  const client = new Client({ name: "blackbox-slice-test", version: "1.0.0" });
  await client.connect(transport);
  try {
    assert.ok(
      (await client.listTools()).tools.some((t) => t.name === "query_business"),
    );
    const r = await client.callTool({
      name: "get_business_state",
      arguments: { entity_id: entity, recorded_cutoff: cutoff },
    });
    assert.ok(!r.isError);
    return JSON.parse((r.content as { text: string }[])[0].text);
  } finally {
    await client.close();
  }
}
async function seed(label: string) {
  const tenant = randomUUID(),
    connection = randomUUID(),
    run = randomUUID(),
    owner = newKey("owner"),
    agent = newKey("agent"),
    credential = randomUUID(),
    principal = randomUUID();
  await admin.query("INSERT INTO bb.workspaces(tenant_id,name) VALUES($1,$2)", [
    tenant,
    label,
  ]);
  await admin.query("INSERT INTO bb.heads(tenant_id) VALUES($1)", [tenant]);
  for (const [purpose, key, id] of [
    ["owner", owner, randomUUID()],
    ["agent", agent, credential],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name) VALUES($1,$2,$3,$4,$5,$6)",
      [tenant, id, principal, purpose, verifier(key), "Synthetic principal"],
    );
  await admin.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor) VALUES($1,$2,'shopify',$3)",
    [tenant, connection, randomUUID()],
  );
  await admin.query(
    "INSERT INTO bb.import_runs(tenant_id,run_id,connection_id) VALUES($1,$2,$3)",
    [tenant, run, connection],
  );
  await importShopify({
    tenant,
    connection,
    run,
    shop: process.env.FIXTURE_HOST ?? "fixture:8082",
    token: "synthetic-fixture-token",
    fixture: true,
    from: "2026-10-01T00:00:00Z",
  });
  const entities = (
    await admin.query(
      "SELECT DISTINCT entity_id FROM bb.journal WHERE tenant_id=$1 AND record_type='source' ORDER BY entity_id",
      [tenant],
    )
  ).rows.map((x) => x.entity_id);
  return { tenant, connection, run, owner, agent, credential, entities };
}
const phase = process.argv[2] ?? "seed";
try {
  if (phase === "seed") {
    await fetch(
      `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"revision":0}',
      },
    );
    const a = await seed("Synthetic A"),
      b = await seed("Synthetic B");
    const states = [];
    for (const entity of a.entities) {
      const r = await ready(a.agent, entity);
      assert.ok([11900, 5573].includes(r.result.captured_minor));
      assert.equal(r.result.outstanding_minor, 0);
      assert.equal(r.result.payment_status, "paid");
      states.push(r);
    }
    await fetch(
      `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"revision":2}',
      },
    );
    const c = await seed("Synthetic refund and missing payment");
    const edgeStates = [];
    for (const entity of c.entities) {
      const result = await ready(c.agent, entity);
      const state = result.result;
      if (state.agreed_minor === 11900) {
        assert.equal(state.captured_minor, 11900);
        assert.equal(state.refunded_minor, 2380);
        assert.equal(state.customer_net_paid_minor, 9520);
        assert.equal(state.outstanding_minor, 2380);
      } else {
        assert.equal(state.agreed_minor, 5573);
        assert.equal(state.captured_minor, 0);
        assert.equal(result.status, "partial");
        assert.ok(
          result.missing_inputs.includes(
            "verified_payment_population_coverage",
          ),
        );
      }
      const protocol = await mcp(c.agent, entity, result.recorded_cutoff);
      assert.deepEqual(protocol.result, state);
      edgeStates.push(result);
    }
    await fetch(
      `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"revision":0}',
      },
    );
    const before = Number(
      (
        await admin.query("SELECT committed FROM bb.heads WHERE tenant_id=$1", [
          a.tenant,
        ])
      ).rows[0].committed,
    );
    await admin.query(
      "UPDATE bb.import_runs SET cursor=NULL WHERE tenant_id=$1",
      [a.tenant],
    );
    await importShopify({
      tenant: a.tenant,
      connection: a.connection,
      run: a.run,
      shop: process.env.FIXTURE_HOST ?? "fixture:8082",
      token: "synthetic-fixture-token",
      fixture: true,
      from: "2026-10-01T00:00:00Z",
    });
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT committed FROM bb.heads WHERE tenant_id=$1",
            [a.tenant],
          )
        ).rows[0].committed,
      ),
      before,
    );
    await fetch(
      `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"revision":3}',
      },
    );
    await admin.query(
      "UPDATE bb.import_runs SET cursor=NULL WHERE tenant_id=$1",
      [a.tenant],
    );
    await importShopify({
      tenant: a.tenant,
      connection: a.connection,
      run: a.run,
      shop: process.env.FIXTURE_HOST ?? "fixture:8082",
      token: "synthetic-fixture-token",
      fixture: true,
      from: "2026-10-01T00:00:00Z",
    });
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT committed FROM bb.heads WHERE tenant_id=$1",
            [a.tenant],
          )
        ).rows[0].committed,
      ),
      before,
    );
    assert.equal(
      (
        await admin.query(
          "SELECT * FROM bb.review_cases WHERE tenant_id=$1 AND kind='provider_content_conflict'",
          [a.tenant],
        )
      ).rowCount,
      2,
    );
    await fetch(
      `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: '{"revision":0}',
      },
    );
    const sdk = await mcp(a.agent, a.entities[0], states[0].recorded_cutoff);
    assert.deepEqual(sdk.result, states[0].result);
    const other = await call(a.agent, "get_business_state", {
      entity_id: b.entities[0],
    });
    assert.equal(other.body.result.agreed_minor, null);
    assert.deepEqual(other.body.result.evidence, []);
    const crossEvidence = (
      await call(b.agent, "get_business_state", { entity_id: b.entities[0] })
    ).body.result.evidence[0];
    assert.equal(
      (await call(a.agent, "get_evidence", { evidence_id: crossEvidence })).body
        .status,
      "unavailable",
    );
    assert.equal((await call(a.owner, "list_journal_entries", {})).code, 401);
    const noauth = await localApiRequest(base, "/v1/status", { headers });
    assert.equal(noauth.status, 401);
    assert.equal(
      await new Promise<number>((resolve, reject) => {
        const r = http.request(
          `${base}/v1/status`,
          {
            headers: {
              host: "evil.example",
              authorization: `Bearer ${a.agent}`,
            },
          },
          (s) => {
            s.resume();
            resolve(s.statusCode!);
          },
        );
        r.on("error", reject);
        r.end();
      }),
      403,
    );
    const list = await call(a.agent, "list_journal_entries", { limit: 2 });
    assert.equal(list.body.entries.length, 2);
    assert.ok(list.body.next_cursor);
    assert.equal(
      (
        await call(b.agent, "list_journal_entries", {
          limit: 2,
          cursor: list.body.next_cursor,
        })
      ).code,
      400,
    );
    for (const url of [
      process.env.DATABASE_URL,
      process.env.WORKER_DATABASE_URL,
      process.env.ENGINE_DATABASE_URL,
    ]) {
      const role = new pg.Pool({ connectionString: url });
      try {
        assert.equal(
          (await role.query("SELECT * FROM bb.journal")).rowCount,
          0,
        );
        const c = await role.connect();
        try {
          for (const statement of [
            "UPDATE bb.journal SET payload='{}'",
            "DELETE FROM bb.journal",
            "TRUNCATE bb.journal",
            "DELETE FROM bb.evidence",
            "TRUNCATE bb.security_audit",
          ]) {
            await c.query("BEGIN");
            await c.query("SELECT set_config('bb.tenant_id',$1,true)", [
              a.tenant,
            ]);
            await assert.rejects(() => c.query(statement));
            await c.query("ROLLBACK");
          }
          await c.query("BEGIN");
          await c.query("SELECT set_config('bb.tenant_id',$1,true)", [
            a.tenant,
          ]);
          assert.equal(
            (
              await c.query("SELECT * FROM bb.journal WHERE tenant_id=$1", [
                b.tenant,
              ])
            ).rowCount,
            0,
          );
          await c.query("ROLLBACK");
          assert.equal((await c.query("SELECT * FROM bb.journal")).rowCount, 0);
        } finally {
          c.release();
        }
      } finally {
        await role.end();
      }
    }
    await writeFile(
      `${process.env.TEST_RUNTIME_DIR ?? "/runtime"}/slice-case.json`,
      JSON.stringify({ a, b, c, states, edgeStates }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        phase: "seed",
        result: "passed",
        checks: [
          "provider_HTTP_two_pages",
          "exact_varied_money",
          "refund_and_missing_payment_HTTP_API_MCP",
          "authorization_not_extra_cash",
          "duplicate_idempotency",
          "conflicting_identity_preserved_and_reviewed",
          "SDK_MCP_API_parity",
          "two_tenant_collision",
          "cross_tenant_evidence_denial",
          "owner_key_substitution_denial",
          "host_denial",
          "snapshot_cursor_scope",
          "actual_three_role_RLS_and_immutability",
          "pool_scope_reset",
        ],
        source_entries: 6,
        cutoff: before,
      }),
    );
  } else {
    const { a, b, c, states, edgeStates } = JSON.parse(
      await readFile(
        `${process.env.TEST_RUNTIME_DIR ?? "/runtime"}/slice-case.json`,
        "utf8",
      ),
    );
    if (phase === "corrupt") {
      await admin.query(
        "UPDATE bb.projections SET checksum='corrupt' WHERE tenant_id=$1",
        [a.tenant],
      );
      console.log(JSON.stringify({ phase, result: "injected" }));
    } else if (phase === "remove") {
      await admin.query("DELETE FROM bb.projections WHERE tenant_id=$1", [
        a.tenant,
      ]);
      console.log(JSON.stringify({ phase, result: "injected" }));
    } else if (phase === "verify") {
      for (let i = 0; i < a.entities.length; i++) {
        const r = await call(a.agent, "get_business_state", {
          entity_id: a.entities[i],
          recorded_cutoff: states[i].recorded_cutoff,
        });
        assert.equal(r.code, 200);
        assert.deepEqual(r.body.result, states[i].result);
        const m = await mcp(a.agent, a.entities[i], states[i].recorded_cutoff);
        assert.deepEqual(m.result, states[i].result);
      }
      for (let i = 0; i < c.entities.length; i++) {
        const r = await call(c.agent, "get_business_state", {
          entity_id: c.entities[i],
          recorded_cutoff: edgeStates[i].recorded_cutoff,
        });
        assert.deepEqual(r.body.result, edgeStates[i].result);
        assert.deepEqual(
          (await mcp(c.agent, c.entities[i], edgeStates[i].recorded_cutoff))
            .result,
          edgeStates[i].result,
        );
      }
      console.log(
        JSON.stringify({
          phase,
          result: "passed",
          checks: ["fixed_cutoff_API_MCP_persisted_values_and_evidence"],
        }),
      );
    } else if (phase === "lag") {
      await fetch(
        `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"revision":1}',
        },
      );
      await admin.query(
        "UPDATE bb.import_runs SET cursor=NULL WHERE tenant_id=$1",
        [a.tenant],
      );
      await importShopify({
        tenant: a.tenant,
        connection: a.connection,
        run: a.run,
        shop: process.env.FIXTURE_HOST ?? "fixture:8082",
        token: "synthetic-fixture-token",
        fixture: true,
        from: "2026-10-01T00:00:00Z",
      });
      const r = await call(a.agent, "get_business_state", {
        entity_id: a.entities[0],
      });
      assert.equal(r.code, 503);
      assert.equal(r.body.error, "projection_behind");
      console.log(
        JSON.stringify({
          phase,
          result: "passed",
          checks: ["committed_but_unapplied_is_never_current"],
        }),
      );
    } else if (phase === "correction") {
      await fetch(
        `http://${process.env.FIXTURE_HOST ?? "fixture:8082"}/revision`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: '{"revision":1}',
        },
      );
      await admin.query(
        "UPDATE bb.import_runs SET cursor=NULL WHERE tenant_id=$1",
        [a.tenant],
      );
      await importShopify({
        tenant: a.tenant,
        connection: a.connection,
        run: a.run,
        shop: process.env.FIXTURE_HOST ?? "fixture:8082",
        token: "synthetic-fixture-token",
        fixture: true,
        from: "2026-10-01T00:00:00Z",
      });
      for (let i = 0; i < a.entities.length; i++) {
        const current = await ready(a.agent, a.entities[i]);
        assert.equal(current.result.agreed_minor, 13000);
        assert.equal(
          current.result.outstanding_minor,
          13000 - states[i].result.captured_minor,
        );
        const old = await call(a.agent, "get_business_state", {
          entity_id: a.entities[i],
          recorded_cutoff: states[i].recorded_cutoff,
        });
        assert.deepEqual(old.body.result, states[i].result);
      }
      await admin.query(
        "UPDATE bb.credentials SET revoked_at=now() WHERE credential_id=$1",
        [a.credential],
      );
      assert.equal(
        (
          await call(a.agent, "get_business_state", {
            entity_id: a.entities[0],
          })
        ).code,
        401,
      );
      assert.equal(
        (
          await call(b.agent, "get_business_state", {
            entity_id: b.entities[0],
          })
        ).code,
        200,
      );
      console.log(
        JSON.stringify({
          phase,
          result: "passed",
          checks: [
            "late_revision_current_and_historical",
            "durable_revocation",
            "unrelated_agent_still_active",
          ],
        }),
      );
    }
  }
} finally {
  await pool.end();
  await admin.end();
}

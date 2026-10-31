import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fulfillmentOrder } from "./fixtures/fulfillments.js";
import {
  recordObservation,
  recordKind,
} from "../packages/contracts/records.js";
process.env.DATABASE_URL = process.env.WORKER_DATABASE_URL;
const { sendObservations } = await import("../packages/connectors/replay.js");
const { pool } = await import("../packages/database/index.js");
const { claimSourceJob, processSourceJob } =
  await import("../packages/application/source-worker.js");
const { opaqueIdentity } = await import("../packages/auth/secrets.js");
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  base = process.env.BLACKBOX_API_URL!,
  runtime = process.env.TEST_RUNTIME_DIR!,
  phase = process.argv[2];
const checks: string[] = [];
const credentials = {
  shop: process.env.FIXTURE_HOST,
  auth: "access_token",
  access_token: "synthetic-fixture-token",
  fixture: true,
};
const scopes = ["read_orders", "read_all_orders"];
async function scenario(orders: any[], grants = scopes) {
  const r = await fetch(
    "http://" + process.env.FIXTURE_HOST + "/source-scenario",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orders, scopes: grants }),
    },
  );
  assert.equal(r.status, 200);
}
async function tenant() {
  const id = randomUUID(),
    owner = "bb_owner_" + randomBytes(32).toString("base64url"),
    agent = "bb_agent_" + randomBytes(32).toString("base64url"),
    principal = randomUUID();
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Fulfillment source synthetic')",
    [id],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [id]);
  for (const [purpose, value] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Fulfillment source test')",
      [
        id,
        randomUUID(),
        principal,
        purpose,
        createHash("sha256").update(value).digest("hex"),
      ],
    );
  const r = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key: owner }),
  });
  assert.equal(r.status, 200);
  return {
    id,
    agent,
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie: r.headers.getSetCookie()[0].split(";")[0],
      "x-blackbox-csrf": (await r.json()).csrf,
    },
  };
}
async function api(t: any, path: string, body?: unknown, status = 200) {
  const r = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: t.headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  return value;
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
async function drain(t: any) {
  for (let i = 0; i < 120; i++) {
    const job = await claimSourceJob(t.id);
    if (!job) {
      await apply(t.id);
      const pending = (
        await admin.query(
          "SELECT state,error_code FROM bb.source_jobs WHERE tenant_id=$1 AND kind IN ('initial','history_expansion') AND state IN ('queued','running')",
          [t.id],
        )
      ).rows;
      if (!pending.length) return;
      await new Promise((r) => setTimeout(r, 300));
      continue;
    }
    await processSourceJob(job);
    await apply(t.id);
    await new Promise((r) => setTimeout(r, 280));
  }
  throw Error("fulfillment_drain_budget");
}
const stable = (v: any) => {
  const { read_path, applied_cursor, ...rest } = v;
  return rest;
};
async function query(t: any, request: any) {
  return api(
    {
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + t.agent,
      },
    },
    "/v1/tools/query_business",
    request,
  );
}
async function mcp(t: any, request: any, expected: any) {
  const file = runtime + "/fulfillment-agent-key";
  await writeFile(file, t.agent, { mode: 0o600 });
  const client = new Client({
    name: "fulfillment-persisted-verifier",
    version: "1",
  });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "packages/mcp/main.ts"],
        env: {
          ...(process.env as Record<string, string>),
          BLACKBOX_AGENT_KEY_FILE: file,
          BLACKBOX_API_URL: base,
        },
        stderr: "pipe",
      }),
    );
    const r = await client.callTool({
      name: "query_business",
      arguments: request,
    });
    assert.ok(!r.isError);
    assert.deepEqual(
      JSON.parse((r.content as any[]).find((c) => c.type === "text").text),
      expected,
    );
  } finally {
    await client.close();
  }
}
async function trackingFixture(t: any, entities: string[], at: string) {
  const connection = randomUUID(),
    principal = randomUUID(),
    secret = "bb_producer_" + randomBytes(32).toString("base64url");
  await admin.query(
    "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,'producer',$4,'Synthetic tracking scope')",
    [
      t.id,
      randomUUID(),
      principal,
      createHash("sha256").update(secret).digest("hex"),
    ],
  );
  await admin.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'generic',$3,$4)",
    [
      t.id,
      connection,
      randomUUID(),
      JSON.stringify({ producer_principal_id: principal }),
    ],
  );
  const observations = entities.map((entity) => {
    const record = {
      dataset: "coverage",
      capability: "tracking",
      entity_scope: entity,
      history_start: at,
      complete_through: "2099-01-01T00:00:00Z",
      backfill_complete: true,
      missing_fields: [],
      failure_state: "none",
      basis: "declared",
      history_kind: "event_history",
    };
    return recordObservation.parse({
      id: randomUUID(),
      economic_id: randomUUID(),
      entity_id: entity,
      kind: recordKind(record as any),
      occurred_at: at,
      record,
      test: true,
    });
  });
  await sendObservations(base, connection, secret, observations);
  await apply(t.id);
}
const planCounts = new Map<string, number>();
async function createPlan(
  t: any,
  connection: string,
  selection: any = { preset: "last_30_days", timezone: "UTC" },
) {
  const count = planCounts.get(connection) ?? 0;
  planCounts.set(connection, count + 1);
  if (count && selection.preset === "last_30_days")
    selection = {
      preset: "custom",
      timezone: "UTC",
      custom_date: new Date(Date.now() - (count + 1) * 30 * 86400000)
        .toISOString()
        .slice(0, 10),
    };
  return api(t, `/v1/sources/${connection}/import`, {
    selection,
    capabilities: ["orders", "fulfillments"],
    acknowledge_restrictions: true,
  });
}
async function answer(t: any, entity: string, at: string) {
  return query(t, {
    intent: "orders.partial_delivery_gaps",
    entity_id: entity,
    as_of: at,
    effective_at: at,
  });
}
const snapshots: any[] = [];
async function freeze(t: any, entity: string, at: string) {
  const result = await answer(t, entity, at),
    request = {
      intent: "orders.partial_delivery_gaps",
      entity_id: entity,
      as_of: at,
      effective_at: at,
      recorded_cutoff: result.recorded_cutoff,
    };
  await mcp(t, request, result);
  snapshots.push({ request, result });
  return result;
}
async function noFalseMovements(t: any, entity: string) {
  assert.equal(
    Number(
      (
        await admin.query(
          "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND entity_id=$2 AND record_type='movement' AND payload->'record'->>'dataset'='fulfillments'",
          [t.id, entity],
        )
      ).rows[0].count,
    ),
    0,
  );
}
try {
  if (phase === "seed") {
    assert.equal(
      (await pool.query("SELECT current_user")).rows[0].current_user,
      "bb_worker",
    );
    const a = await tenant(),
      b = await tenant(),
      at = new Date(Date.now() - 120000).toISOString();
    const nodes = [
      fulfillmentOrder(81001, at, "handed_over", true),
      fulfillmentOrder(81002, at, "prepared"),
      fulfillmentOrder(81003, at, "delivered"),
    ];
    nodes[2].fulfillments[0].inTransitAt = null;
    await scenario(nodes);
    const connection = (
      await api(a, "/v1/sources/shopify", {
        name: "Synthetic fulfillment",
        credentials,
      })
    ).connection_id;
    const foreign = (
      await api(b, "/v1/sources/shopify", {
        name: "Other fulfillment",
        credentials,
      })
    ).connection_id;
    const entities = await Promise.all(
      nodes.map((n) => opaqueIdentity(connection, n.id)),
    );
    assert.notEqual(await opaqueIdentity(foreign, nodes[0].id), entities[0]);
    await api(
      b,
      `/v1/sources/${connection}/preview`,
      {
        selection: { preset: "last_30_days", timezone: "UTC" },
        capabilities: ["fulfillments"],
      },
      404,
    );
    const plan = await createPlan(a, connection);
    assert.ok(
      plan.restrictions.includes("fulfillment_preparation_is_not_handover"),
    );
    await drain(a);
    // A separate synthetic source declares its own tracking population; Shopify is never credited for this input.
    await trackingFixture(a, entities, at);
    const cutoff = plan.initial_cutoff ?? plan.parameters?.initial_cutoff;
    assert.ok(cutoff, JSON.stringify(plan));
    const first = await freeze(a, entities[0], cutoff);
    assert.equal(first.status, "partial", JSON.stringify(first));
    assert.deepEqual(first.missing_inputs, []);
    assert.equal(first.result.rows.length, 2);
    for (const row of first.result.rows) {
      assert.equal(row.remaining_to_dispatch, "1");
      assert.equal(row.remaining_to_deliver, "3");
    }
    const missing = await freeze(a, entities[1], cutoff);
    assert.equal(missing.status, "insufficient_data");
    assert.equal(missing.result, null);
    assert.ok(
      missing.missing_inputs.includes("fulfillments.handover_confirmation"),
    );
    await noFalseMovements(a, entities[1]);
    const delivered = await freeze(a, entities[2], cutoff);
    assert.equal(delivered.result.rows[0].remaining_to_deliver, "1");
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND entity_id=$2 AND record_type='movement' AND payload->'record'->>'dataset'='fulfillments'",
            [a.id, entities[2]],
          )
        ).rows[0].count,
      ),
      1,
    );
    const requests = (
      await (
        await fetch("http://" + process.env.FIXTURE_HOST + "/source-requests")
      ).json()
    ).requests;
    assert.ok(requests.some((r: any) => r.query === "fulfillment_lines"));
    assert.ok(
      requests.some(
        (r: any) => r.query === "fulfillments" && r.variables.after === "1",
      ),
    );
    checks.push(
      "paginated_provider_shaped_HTTP_through_PostgreSQL_Rust_API_actual_SDK_MCP",
      "preparation_is_not_goods_handover_and_missing_timestamp_blocks_physical_answer",
      "delivered_first_observation_carries_movement_assertion_without_invented_handover_time",
    );
    const before = (
      await admin.query(
        "SELECT count(*) count FROM bb.journal WHERE tenant_id=$1",
        [a.id],
      )
    ).rows[0].count;
    const replay = (
      await admin.query(
        "SELECT * FROM bb.source_jobs WHERE tenant_id=$1 AND capability='fulfillments' AND kind='initial'",
        [a.id],
      )
    ).rows[0];
    await admin.query(
      "UPDATE bb.source_jobs SET state='queued',phase='import_records',checkpoint=jsonb_set(jsonb_set(jsonb_set(checkpoint,'{after}','null'),'{pages}','0'),'{stage}','\"recent\"'),next_at=now() WHERE tenant_id=$1 AND job_id=$2",
      [a.id, replay.job_id],
    );
    await drain(a);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*) count FROM bb.journal WHERE tenant_id=$1",
          [a.id],
        )
      ).rows[0].count,
      before,
    );
    checks.push(
      "replayed_fixed_provider_revision_has_no_duplicate_canonical_or_movement_effect",
    );
    const empty = structuredClone(nodes);
    empty[1].fulfillments = [];
    empty[1].fulfillmentsCount.count = 0;
    empty[1].updatedAt = new Date(Date.now() - 500).toISOString();
    await scenario(empty);
    const emptyPlan = await createPlan(a, connection);
    await drain(a);
    const stillUnknown = await freeze(
      a,
      entities[1],
      emptyPlan.parameters.initial_cutoff,
    );
    assert.equal(stillUnknown.status, "insufficient_data");
    assert.ok(
      stillUnknown.missing_inputs.includes(
        "fulfillments.handover_confirmation",
      ),
    );
    checks.push(
      "empty_later_population_does_not_erase_unresolved_preparation_evidence",
    );
    const updateAt = new Date(Date.now() - 1000).toISOString();
    for (const n of nodes) {
      n.updatedAt = updateAt;
      n.fulfillments[0].updatedAt = updateAt;
    }
    nodes[0].fulfillments[0].status = "CANCELLED";
    nodes[0].fulfillments[0].deliveredAt = updateAt;
    nodes[1].fulfillments[0].inTransitAt = updateAt;
    await scenario(nodes);
    const expanded = await createPlan(a, connection);
    await drain(a);
    const nextCutoff =
      expanded.initial_cutoff ?? expanded.parameters?.initial_cutoff;
    const changed = await freeze(a, entities[0], nextCutoff);
    for (const row of changed.result.rows) {
      assert.equal(row.remaining_to_dispatch, "1");
      assert.equal(row.remaining_to_deliver, "1");
    }
    const resolved = await freeze(a, entities[1], nextCutoff);
    assert.deepEqual(resolved.missing_inputs, [], JSON.stringify(resolved));
    assert.equal(resolved.result.rows[0].remaining_to_dispatch, "1");
    for (const saved of snapshots.slice(0, 3))
      assert.deepEqual(
        stable(await query(a, saved.request)),
        stable(saved.result),
      );
    checks.push(
      "administrative_cancel_keeps_physical_delivery_and_does_not_duplicate_quantities",
      "later_handover_resolves_preparation_gap_and_fixed_past_answers_remain_reproducible",
    );
    const f = await answer(b, entities[0], nextCutoff);
    assert.equal(f.status, "insufficient_data");
    assert.equal(f.result, null);
    assert.deepEqual(
      await api(b, "/v1/tools/get_evidence", {
        evidence_id: changed.evidence[0],
      }),
      { status: "unavailable" },
    );
    const invalid = structuredClone(nodes);
    invalid[0].fulfillments[0].fulfillmentLineItems.nodes[0].quantity = null;
    invalid[0].updatedAt = new Date(Date.now() - 500).toISOString();
    invalid[0].fulfillments[0].updatedAt = invalid[0].updatedAt;
    await scenario(invalid);
    const badPlan = await createPlan(a, connection);
    await drain(a);
    const bad = await freeze(
      a,
      entities[0],
      badPlan.initial_cutoff ?? badPlan.parameters?.initial_cutoff,
    );
    assert.equal(bad.status, "insufficient_data");
    assert.ok(bad.missing_inputs.includes("fulfillments.coverage"));
    assert.ok(
      Number(
        (
          await admin.query(
            "SELECT count(*) FROM bb.review_cases WHERE tenant_id=$1 AND kind='fulfillment_quantity_missing'",
            [a.id],
          )
        ).rows[0].count,
      ) > 0,
    );
    checks.push(
      "null_quantity_is_quarantined_without_zero_default_or_population_coverage",
      "two_workspace_identity_query_and_evidence_isolation",
    );
    const regressed = structuredClone(nodes);
    regressed[2].updatedAt = new Date(Date.now() - 500).toISOString();
    regressed[2].fulfillments[0].updatedAt = regressed[2].updatedAt;
    regressed[2].fulfillments[0].status = "CANCELLED";
    regressed[2].fulfillments[0].inTransitAt = null;
    regressed[2].fulfillments[0].deliveredAt = null;
    await scenario(regressed);
    const regressionPlan = await createPlan(a, connection);
    await drain(a);
    const regression = await freeze(
      a,
      entities[2],
      regressionPlan.parameters.initial_cutoff,
    );
    assert.equal(regression.status, "conflict");
    assert.ok(regression.conflicts.includes("provider_content_conflict"));
    assert.equal(regression.result.rows[0].remaining_to_deliver, "1");
    checks.push(
      "later_cancellation_cannot_erase_previously_recorded_physical_delivery",
    );
    const strict = await tenant();
    const strictConnection = (
      await api(strict, "/v1/sources/shopify", {
        name: "Strict fulfillment",
        credentials,
      })
    ).connection_id;
    await createPlan(strict, strictConnection, {
      preset: "from_now",
      timezone: "UTC",
      include_open_items: false,
      include_related_records: false,
      include_opening_state: false,
    });
    await drain(strict);
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'='fulfillments'",
            [strict.id],
          )
        ).rows[0].count,
      ),
      0,
    );
    await api(strict, `/v1/connections/${strictConnection}/state`, {
      state: "paused",
    });
    checks.push("strict_new_only_import_excludes_old_fulfillment_context");
    await scenario(nodes);
    const recoveryPlan = await createPlan(a, connection);
    // Leave an actual first provider page durable but unapplied at shutdown.
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now()+interval '1 hour' WHERE tenant_id=$1 AND state='queued'",
      [a.id],
    );
    const recovery = (
      await admin.query(
        "SELECT job_id FROM bb.source_jobs WHERE tenant_id=$1 AND plan_id=$2 AND capability='fulfillments' AND kind IN ('initial','history_expansion') ORDER BY created_at DESC LIMIT 1",
        [a.id, recoveryPlan.plan_id],
      )
    ).rows[0];
    assert.ok(recovery, JSON.stringify(recoveryPlan));
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND job_id=$2",
      [a.id, recovery.job_id],
    );
    const j = await claimSourceJob(a.id);
    assert.ok(j);
    await processSourceJob(j);
    const cp = (
      await admin.query(
        "SELECT checkpoint FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
        [a.id, j.job_id],
      )
    ).rows[0].checkpoint;
    assert.equal(cp.after, "1");
    assert.equal(cp.pages, 1);
    assert.ok(
      Number(
        (
          await admin.query(
            "SELECT count(*) FROM bb.outbox WHERE tenant_id=$1 AND state='pending'",
            [a.id],
          )
        ).rows[0].count,
      ) > 0,
    );
    await api(a, `/v1/connections/${connection}/state`, { state: "paused" });
    await api(b, `/v1/connections/${foreign}/state`, { state: "paused" });
    await writeFile(
      runtime + "/fulfillment-state.json",
      JSON.stringify({
        a,
        connection,
        entities,
        nodes,
        plan_id: recoveryPlan.plan_id,
        interrupted_job: j.job_id,
        interrupted_checkpoint: cp,
        snapshots,
      }),
      { mode: 0o600 },
    );
  } else {
    const saved = JSON.parse(
      await readFile(runtime + "/fulfillment-state.json", "utf8"),
    );
    if (phase === "remove") {
      await admin.query("DELETE FROM bb.current_records WHERE tenant_id=$1", [
        saved.a.id,
      ]);
      await admin.query("DELETE FROM bb.record_versions WHERE tenant_id=$1", [
        saved.a.id,
      ]);
      checks.push("own_projections_removed_for_cold_recovery");
    } else {
      if (!saved.interrupted_verified)
        assert.deepEqual(
          (
            await admin.query(
              "SELECT checkpoint FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
              [saved.a.id, saved.interrupted_job],
            )
          ).rows[0].checkpoint,
          saved.interrupted_checkpoint,
        );
      for (const snapshot of saved.snapshots) {
        const actual = await query(saved.a, snapshot.request);
        assert.deepEqual(stable(actual), stable(snapshot.result));
        await mcp(saved.a, snapshot.request, actual);
      }
      if (!saved.interrupted_verified) {
        await scenario(saved.nodes);
        await api(saved.a, `/v1/connections/${saved.connection}/state`, {
          state: "configured",
        });
        await admin.query(
          "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND plan_id=$2 AND state='queued' AND kind IN ('initial','history_expansion')",
          [saved.a.id, saved.plan_id],
        );
        await drain(saved.a);
        const result = await freeze(
          saved.a,
          saved.entities[0],
          saved.interrupted_checkpoint.through,
        );
        assert.equal(result.result.rows[0].remaining_to_deliver, "1");
        saved.snapshots.push(...snapshots);
        saved.interrupted_verified = true;
        await writeFile(
          runtime + "/fulfillment-state.json",
          JSON.stringify(saved),
          { mode: 0o600 },
        );
        await api(saved.a, `/v1/connections/${saved.connection}/state`, {
          state: "paused",
        });
        checks.push(
          "unapplied_page_and_provider_cursor_survive_process_restart",
        );
      }
      checks.push(
        "all_frozen_answers_and_evidence_recover_through_API_MCP_after_restart_and_projection_deletion",
      );
    }
  }
  console.log(
    JSON.stringify({
      suite: "shopify-fulfillments-v1",
      phase,
      result: "passed",
      checks,
      synthetic: true,
      limitations: [
        "No live account/grant or independent review",
        "Tracking scope is separately supplied by an explicit synthetic generic producer; no Shopify carrier tracking certification",
      ],
    }),
  );
} finally {
  await pool.end();
  await admin.end();
}

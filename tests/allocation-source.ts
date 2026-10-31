import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { assignmentOrder } from "./fixtures/allocations.js";
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
const scopes = [
  "read_orders",
  "read_all_orders",
  "read_assigned_fulfillment_orders",
  "read_merchant_managed_fulfillment_orders",
];
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
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Allocation source synthetic')",
    [id],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [id]);
  for (const [purpose, value] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Allocation source test')",
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
  throw Error("allocation_drain_budget");
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
  const file = runtime + "/allocation-agent-key";
  await writeFile(file, t.agent, { mode: 0o600 });
  const client = new Client({
    name: "allocation-persisted-verifier",
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
const counts = new Map<string, number>();
async function createPlan(
  t: any,
  connection: string,
  selection: any = { preset: "last_30_days", timezone: "UTC" },
  capabilities = ["orders", "allocations"],
) {
  const count = counts.get(connection) ?? 0;
  counts.set(connection, count + 1);
  if (count && selection.preset === "last_30_days")
    selection = {
      ...selection,
      preset: "custom",
      custom_date: new Date(Date.now() - (31 + count) * 86400000)
        .toISOString()
        .slice(0, 10),
    };
  return api(t, `/v1/sources/${connection}/import`, {
    selection,
    capabilities,
    acknowledge_restrictions: true,
  });
}
const snapshots: any[] = [];
async function freeze(t: any, entity: string, at: string) {
  const request: any = {
    intent: "cancellations.outstanding_steps",
    entity_id: entity,
    as_of: at,
    effective_at: at,
  };
  const result = await query(t, request);
  request.recorded_cutoff = result.recorded_cutoff;
  await mcp(t, request, result);
  snapshots.push({ request, result });
  return result;
}
async function records(t: any, connection: string) {
  return (
    await admin.query(
      "SELECT record_id AS economic_id,payload FROM bb.current_records WHERE tenant_id=$1 AND connection_id=$2 AND dataset='allocations'",
      [t.id, connection],
    )
  ).rows;
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
      assignmentOrder(92001, at, true),
      assignmentOrder(92002, at),
    ];
    for (const n of nodes) n.cancelledAt = at;
    await scenario(nodes);
    const connection = (
      await api(a, "/v1/sources/shopify", {
        name: "Synthetic assignments",
        credentials,
      })
    ).connection_id;
    const foreign = (
      await api(b, "/v1/sources/shopify", {
        name: "Foreign assignments",
        credentials,
      })
    ).connection_id;
    const entities = await Promise.all(
      nodes.map((n) => opaqueIdentity(connection, n.id)),
    );
    await api(
      b,
      `/v1/sources/${connection}/preview`,
      {
        selection: { preset: "last_30_days", timezone: "UTC" },
        capabilities: ["allocations"],
      },
      404,
    );
    const plan = await createPlan(a, connection);
    assert.ok(
      plan.restrictions.includes("allocation_assignments_not_reservations"),
    );
    await drain(a);
    const initial = await freeze(
      a,
      entities[0],
      plan.parameters.initial_cutoff,
    );
    assert.equal(initial.status, "partial");
    assert.ok(
      initial.result.rows[0].remaining_steps.includes("cancel_assignment"),
    );
    assert.ok(
      !initial.result.rows[0].remaining_steps.includes("release_reservation"),
    );
    assert.ok(initial.missing_inputs.includes("allocations.reservation_basis"));
    assert.equal(initial.result.rows[0].reservation_step, "unknown");
    const assignments = await records(a, connection);
    assert.equal(assignments.length, 4);
    for (const r of assignments) {
      assert.equal(r.payload.basis, "derived_plan");
      assert.equal(r.payload.quantity, "3");
    }
    const trackCounts = (
      await admin.query(
        "SELECT record_type,count(*) count FROM bb.journal WHERE tenant_id=$1 AND payload->'record'->>'dataset'='allocations' GROUP BY record_type",
        [a.id],
      )
    ).rows;
    assert.equal(
      Number(trackCounts.find((r) => r.record_type === "fact")?.count),
      4,
    );
    assert.ok(
      !trackCounts.some((r) =>
        ["reservation", "movement", "commitment"].includes(r.record_type),
      ),
    );
    const requests = (
      await (
        await fetch("http://" + process.env.FIXTURE_HOST + "/source-requests")
      ).json()
    ).requests;
    for (const kind of ["allocation_groups", "allocation_lines"])
      assert.ok(requests.some((r: any) => r.query === kind));
    assert.ok(
      requests.some(
        (r: any) => r.query === "allocations" && r.variables.after === "1",
      ),
    );
    checks.push(
      "bounded_outer_group_and_line_HTTP_pagination_persisted_exact_assignments",
      "derived_assignments_remain_facts_without_stock_reservation_movement_or_promise",
      "actual_API_SDK_MCP_unknown_reservation_basis_and_distinct_cancellation_step",
    );
    const before = (
      await admin.query("SELECT count(*) FROM bb.journal WHERE tenant_id=$1", [
        a.id,
      ])
    ).rows[0].count;
    await admin.query(
      `UPDATE bb.source_jobs SET state='queued',phase='import_records',checkpoint=jsonb_set(jsonb_set(jsonb_set(checkpoint,'{after}','null'),'{pages}','0'),'{stage}','"recent"'),next_at=now() WHERE tenant_id=$1 AND capability='allocations' AND kind='initial'`,
      [a.id],
    );
    await drain(a);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*) FROM bb.journal WHERE tenant_id=$1",
          [a.id],
        )
      ).rows[0].count,
      before,
    );
    checks.push("same_snapshot_replay_has_no_extra_canonical_effect");
    // Empty accessible cohort retires prior assignments from answers without inventing a stock release.
    const empty = structuredClone(nodes);
    empty[0].fulfillmentOrders = {
      nodes: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    };
    empty[0].extraGroups = [];
    empty[0].updatedAt = new Date(Date.now() - 500).toISOString();
    await scenario(empty);
    const emptyPlan = await createPlan(a, connection);
    await drain(a);
    const removed = await freeze(
      a,
      entities[0],
      emptyPlan.parameters.initial_cutoff,
    );
    assert.ok(
      !removed.result.rows[0].remaining_steps.includes("cancel_assignment"),
    );
    assert.equal(removed.result.rows[0].reservation_step, "unknown");
    assert.deepEqual(
      stable(await query(a, snapshots[0].request)),
      stable(snapshots[0].result),
    );
    checks.push(
      "omitted_assignments_retired_by_persisted_cohort_without_fabricated_reservation_release",
      "fixed_old_cutoff_preserves_prior_assignment",
    );
    const { recorded_cutoff: _foreignCutoff, ...foreignRequest } =
      snapshots[0].request;
    const f = await query(b, foreignRequest);
    assert.equal(f.result.rows.length, 0);
    assert.deepEqual(
      await api(b, "/v1/tools/get_evidence", {
        evidence_id: initial.evidence[0],
      }),
      { status: "unavailable" },
    );
    checks.push("cross_tenant_source_query_and_evidence_denied");
    // Changed revision, location and remaining quantity retain one economic assignment.
    const moved = structuredClone(nodes);
    moved[0].updatedAt = new Date(Date.now() - 400).toISOString();
    const group = moved[0].fulfillmentOrders.nodes[0];
    group.updatedAt = moved[0].updatedAt;
    group.assignedLocation.location = { id: "gid://shopify/Location/2" };
    group.lineItems.nodes[0].remainingQuantity = 1;
    await scenario(moved);
    const movedPlan = await createPlan(a, connection);
    await drain(a);
    await freeze(a, entities[0], movedPlan.parameters.initial_cutoff);
    const lineId = await opaqueIdentity(
      connection,
      "allocations:gid://shopify/FulfillmentOrderLineItem/92001",
    );
    const movedRecord = (await records(a, connection)).find(
      (r) => r.economic_id === lineId,
    )!;
    assert.equal(movedRecord.payload.quantity, "1");
    assert.equal(
      movedRecord.payload.location_id,
      await opaqueIdentity(connection, "gid://shopify/Location/2"),
    );
    checks.push(
      "new_revision_location_move_preserves_identity_and_exact_remaining_quantity",
    );
    const contradictory = structuredClone(moved);
    contradictory[0].fulfillmentOrders.nodes[0].lineItems.nodes[0].remainingQuantity = 2;
    await scenario(contradictory);
    const conflictPlan = await createPlan(a, connection);
    await drain(a);
    const conflictAnswer = await freeze(
      a,
      entities[0],
      conflictPlan.parameters.initial_cutoff,
    );
    assert.equal(conflictAnswer.status, "conflict");
    assert.ok(conflictAnswer.conflicts.includes("provider_content_conflict"));
    assert.equal(
      (await records(a, connection)).find((r) => r.economic_id === lineId)!
        .payload.quantity,
      "1",
    );
    checks.push(
      "same_provider_revision_changed_assignment_quantity_is_quarantined_with_original_preserved",
    );
    const invalid = structuredClone(moved);
    invalid[0].updatedAt = new Date(Date.now() - 200).toISOString();
    invalid[0].fulfillmentOrders.nodes[0].updatedAt = invalid[0].updatedAt;
    invalid[0].fulfillmentOrders.nodes[0].lineItems.nodes[0].remainingQuantity = 4;
    await scenario(invalid);
    const invalidPlan = await createPlan(a, connection);
    await drain(a);
    const invalidAnswer = await freeze(
      a,
      entities[0],
      invalidPlan.parameters.initial_cutoff,
    );
    assert.ok(
      invalidAnswer.missing_inputs.includes("allocations.invalid_snapshot"),
    );
    assert.ok(
      !invalidAnswer.result.rows[0].remaining_steps.includes(
        "cancel_assignment",
      ),
    );
    const cases = await api(a, "/v1/reviews");
    const invalidCase = cases.cases.find(
      (c: any) => c.kind === "allocation_quantity_conflict",
    );
    assert.ok(invalidCase, JSON.stringify(cases));
    const retry = await api(a, `/v1/reviews/${invalidCase.case_id}/decisions`, {
      command_id: randomUUID(),
      action: "retry",
      revision: invalidCase.revision,
      reason_code: "retry_mapping",
      evidence_ids: [],
      acknowledged: true,
      note: "Retry the retained synthetic invalid assignment.",
    });
    assert.equal(retry.state, "unresolved");
    assert.equal(
      (await api(a, `/v1/reviews/${invalidCase.case_id}`)).retry_count,
      1,
    );
    checks.push(
      "invalid_remaining_quantity_quarantines_entire_order_cohort_and_retained_retry_stays_invalid",
    );
    // A second tenant proves declined opening quantities never enter raw evidence or canonical state.
    await scenario(nodes);
    const strict = await createPlan(
      b,
      foreign,
      {
        preset: "from_now",
        timezone: "UTC",
        include_open_items: false,
        include_related_records: false,
        include_opening_state: false,
      },
      ["allocations"],
    );
    await admin.query(
      "UPDATE bb.source_jobs SET checkpoint=jsonb_set(checkpoint,'{from}',to_jsonb($2::text)) WHERE tenant_id=$1 AND plan_id=$3",
      [b.id, new Date(Date.now() - 3600000).toISOString(), strict.plan_id],
    );
    await drain(b);
    assert.equal((await records(b, foreign)).length, 0);
    const ev = (
      await admin.query(
        "SELECT evidence_id FROM bb.import_objects WHERE tenant_id=$1 AND run_id IN(SELECT run_id FROM bb.source_jobs WHERE plan_id=$2)",
        [b.id, strict.plan_id],
      )
    ).rows;
    assert.ok(ev.length);
    for (const e of ev) {
      const raw = await api(b, "/v1/tools/get_evidence", {
        evidence_id: e.evidence_id,
      });
      assert.ok(!JSON.stringify(raw).includes("remainingQuantity"));
      assert.ok(!JSON.stringify(raw).includes("totalQuantity"));
    }
    checks.push(
      "strict_from_now_drops_declined_quantity_payloads_even_when_provider_returns_older_context",
    );
    // Narrowing one category must fail even while a different fulfillment grant remains.
    await scenario(nodes, [
      "read_orders",
      "read_all_orders",
      "read_merchant_managed_fulfillment_orders",
    ]);
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND capability='allocations' AND kind='incremental' AND state='queued'",
      [a.id],
    );
    await drain(a);
    const health = await api(a, "/v1/sources/readiness");
    assert.equal(
      health.capabilities.find((c: any) => c.capability === "allocations")
        .effective_state,
      "reauthorization_required",
    );
    checks.push(
      "loss_of_one_granted_fulfillment_category_requires_reauthorization",
    );
    await scenario(moved);
    await api(a, "/v1/sources/shopify", {
      name: "Synthetic assignments",
      credentials,
      connection_id: connection,
    });
    const recoveryPlan = await createPlan(a, connection);
    const recovery = (
      await admin.query(
        "SELECT * FROM bb.source_jobs WHERE tenant_id=$1 AND plan_id=$2 AND capability='allocations'",
        [a.id, recoveryPlan.plan_id],
      )
    ).rows[0];
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now()+interval '1 hour' WHERE tenant_id=$1 AND state='queued'",
      [a.id],
    );
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
      runtime + "/allocation-state.json",
      JSON.stringify({
        a,
        connection,
        entities,
        nodes: moved,
        plan_id: recoveryPlan.plan_id,
        interrupted_job: j.job_id,
        interrupted_checkpoint: cp,
        snapshots,
      }),
      { mode: 0o600 },
    );
  } else {
    const saved = JSON.parse(
      await readFile(runtime + "/allocation-state.json", "utf8"),
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
      for (const snap of saved.snapshots) {
        const actual = await query(saved.a, snap.request);
        assert.deepEqual(stable(actual), stable(snap.result));
        await mcp(saved.a, snap.request, actual);
      }
      if (!saved.interrupted_verified) {
        await scenario(saved.nodes);
        await api(saved.a, `/v1/connections/${saved.connection}/state`, {
          state: "configured",
        });
        await admin.query(
          "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND plan_id=$2 AND state='queued'",
          [saved.a.id, saved.plan_id],
        );
        await drain(saved.a);
        const answer = await freeze(
          saved.a,
          saved.entities[0],
          saved.interrupted_checkpoint.through,
        );
        assert.ok(
          answer.result.rows[0].remaining_steps.includes("cancel_assignment"),
        );
        saved.snapshots.push(...snapshots);
        saved.interrupted_verified = true;
        await writeFile(
          runtime + "/allocation-state.json",
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
        "frozen_API_MCP_answers_and_evidence_survive_restart_and_deleted_projections",
      );
    }
  }
  console.log(
    JSON.stringify({
      suite: "shopify-allocations-v1",
      phase,
      result: "passed",
      checks,
      limitations: [
        "Synthetic provider only; no live grant or independent review",
        "Shopify assignments do not prove actual stock reservations or complete scope",
      ],
    }),
  );
} finally {
  await pool.end();
  await admin.end();
}

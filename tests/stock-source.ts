import { runtimeFingerprint } from "../packages/runtime/compatibility.js";
import assert from "node:assert/strict";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { stockItem } from "./fixtures/stock.js";
process.env.DATABASE_URL = process.env.WORKER_DATABASE_URL;
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
const scopes = ["read_orders", "read_all_orders", "read_inventory"];
async function scenario(stock_items: any[], grants = scopes) {
  const r = await fetch(
    "http://" + process.env.FIXTURE_HOST + "/source-scenario",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stock_items, scopes: grants }),
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
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Inventory source synthetic')",
    [id],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [id]);
  for (const [purpose, value] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Inventory source test')",
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
      "x-blackbox-contract": runtimeFingerprint,
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
  for (let i = 0; i < 45; i++) {
    const job = await claimSourceJob(t.id);
    if (!job) {
      await apply(t.id);
      return;
    }
    await processSourceJob(job);
    await apply(t.id);
    await new Promise((r) => setTimeout(r, 280));
  }
  throw Error("inventory_drain_budget");
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
  const file = runtime + "/stock-agent-key";
  await writeFile(file, t.agent, { mode: 0o600 });
  const client = new Client({
    name: "inventory-persisted-verifier",
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
try {
  if (phase === "seed") {
    const a = await tenant(),
      b = await tenant(),
      at = new Date(Date.now() - 60000).toISOString(),
      one: any = stockItem(71001, 7, at),
      two = stockItem(71002, 3, at),
      extra = stockItem(71003, 4, at),
      inactive = stockItem(71004, 1000, at);
    inactive.inventoryLevels.nodes[0].isActive = false;
    one.inventoryLevels.pageInfo = {
      hasNextPage: true,
      endCursor: "more-levels",
    };
    one.extraLevels = [
      ...extra.inventoryLevels.nodes,
      ...inactive.inventoryLevels.nodes,
    ];
    await scenario([one, two]);
    const source = await api(a, "/v1/sources/shopify", {
        name: "Synthetic inventory",
        credentials,
      }),
      connection = source.connection_id,
      item = await opaqueIdentity(connection, one.id);
    const foreignSource = await api(b, "/v1/sources/shopify", {
      name: "Other inventory",
      credentials,
    });
    assert.notEqual(
      await opaqueIdentity(foreignSource.connection_id, one.id),
      item,
    );
    await api(
      b,
      `/v1/sources/${connection}/preview`,
      {
        selection: { preset: "last_30_days", timezone: "UTC" },
        capabilities: ["stock"],
      },
      404,
    );
    await api(a, `/v1/sources/${connection}/import`, {
      selection: { preset: "last_30_days", timezone: "UTC" },
      capabilities: ["orders"],
      acknowledge_restrictions: true,
    });
    await drain(a);
    const plan = await api(a, `/v1/sources/${connection}/import`, {
      selection: { preset: "last_30_days", timezone: "UTC" },
      capabilities: ["stock"],
      acknowledge_restrictions: true,
    });
    assert.equal(plan.jobs.length, 3);
    assert.ok(plan.restrictions.includes("inventory_non_atomic_locations"));
    await drain(a);
    const request = {
      intent: "inventory.available_to_sell",
      item_id: item,
      unit: "piece",
      requested_quantity: "12",
      as_of: (await api(a, "/v1/sources/readiness")).capabilities.find(
        (c: any) => c.capability === "stock",
      ).coverage.checked_through,
      effective_at: "",
    };
    request.effective_at = request.as_of;
    const first = await query(a, request);
    assert.ok(first.result, JSON.stringify(first));
    assert.equal(first.result.rows[0].available, "11");
    assert.equal(first.result.rows[0].shortfall, "1");
    assert.equal(first.result.rows[0].incoming_counted_as_stock, false);
    assert.equal(first.status, "partial");
    assert.ok(first.coverage.limitations.includes("stock.non_atomic_snapshot"));
    assert.ok(first.evidence.length);
    await mcp(
      a,
      { ...request, recorded_cutoff: first.recorded_cutoff },
      await query(a, { ...request, recorded_cutoff: first.recorded_cutoff }),
    );
    const requests = await (
      await fetch("http://" + process.env.FIXTURE_HOST + "/source-requests")
    ).json();
    assert.ok(requests.requests.some((r: any) => r.query === "stock_levels"));
    const before = await admin.query(
      "SELECT count(*) count FROM bb.journal WHERE tenant_id=$1",
      [a.id],
    );
    const replay = (
      await admin.query(
        "SELECT * FROM bb.source_jobs WHERE tenant_id=$1 AND capability='stock' AND state='complete_with_gaps' ORDER BY completed_at DESC LIMIT 1",
        [a.id],
      )
    ).rows[0];
    await admin.query(
      "UPDATE bb.source_jobs SET state='queued',phase='import_records',checkpoint=jsonb_set(jsonb_set(checkpoint,'{after}','null'),'{pages}','0'),next_at=now() WHERE tenant_id=$1 AND job_id=$2",
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
      before.rows[0].count,
    );
    checks.push(
      "paginated_HTTP_inventory_atomic_item_cohort_PostgreSQL_Rust_API_actual_SDK_MCP",
      "provider_available_not_double_subtracted_incoming_inactive_excluded",
      "same_fixed_scan_replay_is_idempotent",
      "new_capability_gets_independent_poll_and_reconciliation",
    );
    // A later complete location enumeration omits the second location; old stock must not leak into its new cohort.
    one.inventoryLevels.pageInfo = { hasNextPage: false, endCursor: null };
    delete one.extraLevels;
    await scenario([one, two]);
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND capability='stock' AND state='queued' AND kind='incremental'",
      [a.id],
    );
    await drain(a);
    const secondRequest = {
        ...request,
        as_of: (await api(a, "/v1/sources/readiness")).capabilities.find(
          (c: any) => c.capability === "stock",
        ).coverage.checked_through,
      },
      second = await query(a, {
        ...secondRequest,
        effective_at: secondRequest.as_of,
      });
    secondRequest.effective_at = secondRequest.as_of;
    assert.equal(second.result.rows[0].available, "7");
    assert.deepEqual(
      stable(
        await query(a, { ...request, recorded_cutoff: first.recorded_cutoff }),
      ),
      stable(first),
    );
    const foreign = await query(b, {
      ...request,
      as_of: new Date().toISOString(),
    });
    assert.equal(foreign.status, "insufficient_data");
    assert.deepEqual(
      await api(b, "/v1/tools/get_evidence", {
        evidence_id: second.evidence[0],
      }),
      { status: "unavailable" },
    );
    assert.equal(
      (
        await query(a, {
          ...secondRequest,
          as_of: new Date(Date.parse(secondRequest.as_of) + 1).toISOString(),
        })
      ).status,
      "insufficient_data",
    );
    checks.push(
      "disappeared_location_retires_without_fabricated_zero_or_old_location_double_count",
      "historical_fixed_cutoff_retains_original_snapshot",
      "two_workspace_same_provider_ID_and_evidence_isolation",
    );
    const strictTenant = await tenant(),
      strictSource = await api(strictTenant, "/v1/sources/shopify", {
        name: "Strict inventory",
        credentials,
      });
    await api(
      strictTenant,
      `/v1/sources/${strictSource.connection_id}/import`,
      {
        selection: {
          preset: "from_now",
          timezone: "UTC",
          include_open_items: false,
          include_related_records: false,
          include_opening_state: false,
        },
        capabilities: ["stock"],
        acknowledge_restrictions: true,
      },
    );
    await drain(strictTenant);
    assert.equal(
      Number(
        (
          await admin.query(
            "SELECT count(*) count FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'='stock'",
            [strictTenant.id],
          )
        ).rows[0].count,
      ),
      0,
    );
    await api(
      strictTenant,
      `/v1/connections/${strictSource.connection_id}/state`,
      { state: "paused" },
    );
    checks.push("strict_from_now_does_not_import_declined_opening_states");
    const invalid = structuredClone(one);
    invalid.inventoryLevels.nodes[0].quantities[0].quantity = -1;
    await scenario([invalid, two]);
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND capability='stock' AND state='queued' AND kind='incremental'",
      [a.id],
    );
    await drain(a);
    const invalidRequest = { ...request, as_of: new Date().toISOString() };
    invalidRequest.effective_at = invalidRequest.as_of;
    const invalidAnswer = await query(a, invalidRequest);
    assert.equal(invalidAnswer.status, "insufficient_data");
    assert.ok(invalidAnswer.missing_inputs.includes("stock.invalid_snapshot"));
    assert.equal(invalidAnswer.result, null);
    checks.push(
      "negative_quantity_quarantine_invalidates_current_item_cohort_without_clamping_to_zero",
      "unrelated_millisecond_does_not_claim_snapshot_coverage",
    );
    await scenario([one, two], ["read_orders", "read_all_orders"]);
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND capability='stock' AND state='queued' AND kind='incremental'",
      [a.id],
    );
    await drain(a);
    const health = await api(a, "/v1/sources/readiness");
    assert.equal(
      health.capabilities.find((c: any) => c.capability === "stock")
        .effective_state,
      "reauthorization_required",
    );
    await scenario([one, two]);
    await api(a, "/v1/sources/shopify", {
      name: "Synthetic inventory",
      credentials,
      connection_id: connection,
    });
    await admin.query(
      "UPDATE bb.source_jobs SET next_at=now() WHERE tenant_id=$1 AND capability='stock' AND kind='reconciliation' AND state='queued'",
      [a.id],
    );
    const interrupted = await claimSourceJob(a.id);
    assert.ok(interrupted);
    assert.equal(interrupted.capability, "stock");
    await processSourceJob(interrupted);
    const interruptedCheckpoint = (
      await admin.query(
        "SELECT checkpoint FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
        [a.id, interrupted.job_id],
      )
    ).rows[0].checkpoint;
    assert.equal(interruptedCheckpoint.pages, 1);
    assert.equal(interruptedCheckpoint.after, "1");
    await api(a, `/v1/connections/${connection}/state`, { state: "paused" });
    await api(b, `/v1/connections/${foreignSource.connection_id}/state`, {
      state: "paused",
    });
    checks.push(
      "lost_inventory_scope_stops_collection_and_requires_reauthorization",
    );
    await writeFile(
      runtime + "/stock-state.json",
      JSON.stringify({
        a,
        connection,
        interrupted_job: interrupted.job_id,
        interrupted_checkpoint: interruptedCheckpoint,
        source_items: [one, two],
        snapshots: [
          {
            request: {
              ...invalidRequest,
              recorded_cutoff: invalidAnswer.recorded_cutoff,
            },
            result: invalidAnswer,
          },
          {
            request: { ...request, recorded_cutoff: first.recorded_cutoff },
            result: first,
          },
          {
            request: {
              ...secondRequest,
              recorded_cutoff: second.recorded_cutoff,
            },
            result: second,
          },
        ],
      }),
      { mode: 0o600 },
    );
  } else {
    const saved = JSON.parse(
      await readFile(runtime + "/stock-state.json", "utf8"),
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
      if (!saved.interrupted_verified) {
        assert.deepEqual(
          (
            await admin.query(
              "SELECT checkpoint FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
              [saved.a.id, saved.interrupted_job],
            )
          ).rows[0].checkpoint,
          saved.interrupted_checkpoint,
        );
      }
      for (const s of saved.snapshots) {
        const answer = await query(saved.a, s.request);
        assert.deepEqual(stable(answer), stable(s.result));
        await mcp(saved.a, s.request, answer);
      }
      if (!saved.interrupted_verified) {
        await scenario(saved.source_items);
        await api(saved.a, `/v1/connections/${saved.connection}/state`, {
          state: "configured",
        });
        await drain(saved.a);
        const request = {
          intent: "inventory.available_to_sell",
          item_id: await opaqueIdentity(
            saved.connection,
            saved.source_items[0].id,
          ),
          unit: "piece",
          requested_quantity: "12",
          as_of: saved.interrupted_checkpoint.through,
          effective_at: saved.interrupted_checkpoint.through,
        };
        const result = await query(saved.a, request);
        assert.equal(result.result.rows[0].available, "7");
        await mcp(
          saved.a,
          { ...request, recorded_cutoff: result.recorded_cutoff },
          await query(saved.a, {
            ...request,
            recorded_cutoff: result.recorded_cutoff,
          }),
        );
        saved.snapshots.push({
          request: { ...request, recorded_cutoff: result.recorded_cutoff },
          result,
        });
        saved.interrupted_verified = true;
        await writeFile(runtime + "/stock-state.json", JSON.stringify(saved), {
          mode: 0o600,
        });
        await api(saved.a, `/v1/connections/${saved.connection}/state`, {
          state: "paused",
        });
        checks.push(
          "restart_with_unapplied_item_and_saved_page_cursor_finishes_without_duplicate_location_effects",
        );
      }
      checks.push(
        "restart_and_deleted_projection_recovery_of_both_snapshot_cohorts_API_MCP_values_and_evidence",
      );
    }
  }
  console.log(
    JSON.stringify({
      suite: "shopify-stock-v1",
      phase,
      result: "passed",
      checks,
      synthetic: true,
      limitations: [
        "No live Shopify grants or account",
        "Non-atomic snapshots; no historical opening balance, movement cause or global completeness claimed",
      ],
    }),
  );
} finally {
  await pool.end();
  await admin.end();
}

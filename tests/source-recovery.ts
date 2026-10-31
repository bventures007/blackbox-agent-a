import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import pg from "pg";
process.env.DATABASE_URL = process.env.WORKER_DATABASE_URL;
const { pool } = await import("../packages/database/index.js");
const { claimSourceJob, processSourceJob } =
  await import("../packages/application/source-worker.js");
const runtime = process.env.TEST_RUNTIME_DIR!,
  base = process.env.BLACKBOX_API_URL!,
  saved = JSON.parse(
    await readFile(runtime + "/source-operations-state.json", "utf8"),
  ),
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  checks: string[] = [];
let client: Client | undefined;
async function api(path: string, body: unknown, headers = saved.a.headers) {
  const r = await fetch(base + path, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  assert.equal(r.status, 200);
  return r.json();
}
try {
  const j = (
    await admin.query(
      "SELECT checkpoint,state FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
      [saved.a.id, saved.interrupted_job],
    )
  ).rows[0];
  assert.deepEqual(j.checkpoint, saved.interrupted_checkpoint);
  assert.equal(j.state, "queued");
  const request = {
    intent: "orders.payment_state",
    entity_id: saved.entity,
    recorded_cutoff: saved.result.recorded_cutoff,
    as_of: saved.result.as_of,
  };
  const result = await api("/v1/tools/query_business", request, {
    "content-type": "application/json",
    authorization: "Bearer " + saved.a.agent,
  });
  const stable = (value: any) => {
    const { applied_cursor, read_path, ...business } = value;
    return business;
  };
  assert.deepEqual(stable(result), stable(saved.result));
  assert.ok(result.applied_cursor >= result.recorded_cutoff);
  assert.equal(result.read_path, "indexed_cold_record_history");
  const keyFile = runtime + "/source-agent-key";
  await writeFile(keyFile, saved.a.agent, { mode: 0o600 });
  client = new Client({ name: "source-recovery-verifier", version: "1.0.0" });
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
  const mcp = await client.callTool({
    name: "query_business",
    arguments: request,
  });
  assert.ok(!mcp.isError);
  const text = (mcp.content as any[]).find((c) => c.type === "text").text;
  assert.deepEqual(JSON.parse(text), result);
  checks.push(
    "actual_sdk_stdio_mcp_matches_persisted_api_fixed_cutoff_after_process_restart",
  );
  const old = await api(
    "/v1/tools/query_business",
    {
      ...request,
      as_of: new Date(Date.parse(request.as_of) - 1).toISOString(),
    },
    {
      "content-type": "application/json",
      authorization: "Bearer " + saved.a.agent,
    },
  );
  assert.equal(old.status, "insufficient_data");
  const historical = await api(
    "/v1/tools/query_business",
    {
      ...request,
      from: new Date(Date.parse(request.as_of) - 3600000).toISOString(),
    },
    {
      "content-type": "application/json",
      authorization: "Bearer " + saved.a.agent,
    },
  );
  assert.equal(historical.status, "insufficient_data");
  checks.push(
    "snapshot_scope_rejects_other_milliseconds_and_historical_window",
  );
  const fixture = await fetch(
    "http://" + process.env.FIXTURE_HOST + "/source-scenario",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orders: saved.source_orders }),
    },
  );
  assert.equal(fixture.status, 200);
  await api(`/v1/connections/${saved.connection}/state`, {
    state: "configured",
  });
  for (let i = 0; i < 50; i++) {
    const job = await claimSourceJob(saved.a.id);
    if (job) await processSourceJob(job);
    const apply = await fetch(process.env.ENGINE_URL + "/v1/apply", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbox-internal": await readFile(
          process.env.INTERNAL_KEY_FILE!,
          "utf8",
        ),
      },
      body: JSON.stringify({ tenant_id: saved.a.id }),
    });
    assert.equal(apply.status, 200);
    const state = (
      await admin.query(
        "SELECT state FROM bb.source_jobs WHERE tenant_id=$1 AND job_id=$2",
        [saved.a.id, saved.interrupted_job],
      )
    ).rows[0].state;
    if (state === "complete_with_gaps") break;
    assert.ok(i < 49);
    await new Promise((r) => setTimeout(r, 300));
  }
  const count = (
    await admin.query(
      "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage'",
      [saved.a.id],
    )
  ).rows[0].count;
  assert.equal(Number(count), saved.source_count);
  await api(`/v1/connections/${saved.connection}/state`, { state: "paused" });
  checks.push(
    "interrupted_page_checkpoint_survives_restart_and_finishes_without_duplicate_money",
  );
  const evidence = {
    suite: "source-recovery-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"]).toString().trim(),
    at: new Date().toISOString(),
    checks,
    synthetic: true,
    result: "passed",
  };
  await writeFile(
    runtime + "/source-recovery-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} finally {
  await client?.close();
  await pool.end();
  await admin.end();
}

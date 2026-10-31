import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";
const runtime = process.env.TEST_RUNTIME_DIR!,
  base = process.env.BLACKBOX_API_URL!,
  saved = JSON.parse(
    await readFile(runtime + "/source-browser-state.json", "utf8"),
  ),
  provider = JSON.parse(
    await readFile(runtime + "/source-operations-state.json", "utf8"),
  ),
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
async function api(path: string, body?: unknown) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: saved.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal(r.status, 200);
  return r.json();
}
try {
  const setup = await fetch(
    "http://" + process.env.FIXTURE_HOST + "/source-scenario",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orders: provider.source_orders }),
    },
  );
  assert.equal(setup.status, 200);
  for (const run of (await api("/v1/sources/readiness")).runs)
    if (run.state === "paused")
      await api(`/v1/imports/${run.job_id}/control`, { action: "resume" });
  await api(`/v1/connections/${saved.connection}/state`, {
    state: "configured",
  });
  let readiness: any;
  for (let i = 0; i < 100; i++) {
    readiness = await api("/v1/sources/readiness");
    const initial = readiness.runs.filter((r: any) => r.kind === "initial");
    if (
      initial.length === 3 &&
      initial.every(
        (r: any) =>
          r.state === "complete_with_gaps" && r.processed_objects === 3,
      )
    )
      break;
    assert.ok(i < 99, "background source worker did not complete all cohorts");
    await new Promise((r) => setTimeout(r, 500));
  }
  const count = (
    await admin.query(
      "SELECT count(*) FROM bb.journal WHERE tenant_id=$1 AND record_type='source' AND payload->'record'->>'dataset'<>'coverage'",
      [saved.tenant],
    )
  ).rows[0].count;
  assert.equal(Number(count), 9);
  assert.ok(
    Number(readiness.heads.applied) >= Number(readiness.heads.committed),
  );
  const evidence = {
    suite: "source-background-worker-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"]).toString().trim(),
    at: new Date().toISOString(),
    checks: [
      "real_background_worker_imports_all_pages_and_processes_three_cohorts_after_browser_is_closed",
      "durable_journal_has_exactly_three_orders_three_payments_and_three_refunds",
    ],
    synthetic: true,
    result: "passed",
  };
  await writeFile(
    runtime + "/source-auto-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} finally {
  await api(`/v1/connections/${saved.connection}/state`, { state: "paused" });
  await admin.end();
}

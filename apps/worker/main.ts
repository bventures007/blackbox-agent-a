import { readFile, writeFile, rename } from "node:fs/promises";
import { pool } from "../../packages/database/index.js";
import { log } from "../../packages/diagnostics/index.js";
const key = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8");
log("service.started");
let stopping = false,
  lastHeartbeat = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
while (!stopping) {
  try {
    if (Date.now() - lastHeartbeat > 5000) {
      const path = process.env.LOG_DIR + "/worker-heartbeat.json";
      await writeFile(
        path + ".tmp",
        JSON.stringify({ observed_at: new Date().toISOString() }),
        { mode: 0o600 },
      );
      await rename(path + ".tmp", path);
      lastHeartbeat = Date.now();
    }
    const { rows } = await pool.query("SELECT * FROM bb.pending_tenants()");
    for (const r of rows) {
      const response = await fetch(`${process.env.ENGINE_URL}/v1/apply`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-blackbox-internal": key,
        },
        body: JSON.stringify({ tenant_id: r.tenant_id }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("engine_apply_failed");
      const applied = (await response.json()) as Record<string, unknown>;
      log("engine.batch_applied", { tenant_id: r.tenant_id, ...applied });
    }
  } catch {
    log("worker.failed");
  }
  await new Promise((r) => setTimeout(r, 250));
}
await pool.end();

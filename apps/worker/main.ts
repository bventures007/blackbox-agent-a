import {
  verifyDatabaseContract,
  verifyEngineContract,
  runtimeFingerprint,
} from "../../packages/runtime/compatibility.js";
import { readFile, writeFile, rename } from "node:fs/promises";
import { pool } from "../../packages/database/index.js";
import { recordDerivationFailure } from "../../packages/application/derivation.js";
import { sourceTick } from "../../packages/application/source-worker.js";
import { log } from "../../packages/diagnostics/index.js";
await verifyDatabaseContract(pool);
await verifyEngineContract(process.env.ENGINE_URL);
const key = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8");
log("service.started");
let stopping = false,
  lastHeartbeat = 0;
process.on("SIGTERM", () => {
  stopping = true;
});
const sources = (async () => {
  while (!stopping) {
    try {
      await sourceTick();
    } catch {
      log("source.scheduler_failed");
    }
    await new Promise((r) => setTimeout(r, 250));
  }
})();
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
      let failure: unknown;
      try {
        const response = await fetch(`${process.env.ENGINE_URL}/v1/apply`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-blackbox-contract": runtimeFingerprint,
            "x-blackbox-internal": key,
          },
          body: JSON.stringify({ tenant_id: r.tenant_id }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          // Fixed internal response; never retain a provider error or arbitrary body.
          const reader = response.body?.getReader();
          try {
            const part = await reader?.read();
            if (part?.value && part.value.byteLength <= 4096) {
              try {
                failure = JSON.parse(Buffer.from(part.value).toString("utf8"));
              } catch {}
            }
          } finally {
            await reader?.cancel();
          }
          throw new Error("engine_apply_failed");
        }
        const applied = (await response.json()) as Record<string, unknown>;
        log("engine.batch_applied", { tenant_id: r.tenant_id, ...applied });
      } catch {
        const result = await recordDerivationFailure(r.tenant_id, failure);
        log("engine.apply_failed", { tenant_id: r.tenant_id, ...result });
      }
    }
  } catch {
    log("worker.failed");
  }
  await new Promise((r) => setTimeout(r, 250));
}
await sources;
await pool.end();

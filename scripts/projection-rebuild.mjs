// Privileged host orchestration only. All interpretation and verification is Rust.
import pg from "pg";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";

export async function rebuildAll(db, call) {
  const tenants = (
    await db.query("SELECT tenant_id FROM bb.heads ORDER BY tenant_id LIMIT 65")
  ).rows;
  if (tenants.length > 64) throw Error("rebuild_workspace_budget");
  const results = [];
  for (const { tenant_id } of tenants) {
    await db.query("BEGIN");
    let build;
    try {
      const head = (
        await db.query("SELECT * FROM bb.heads WHERE tenant_id=$1 FOR UPDATE", [
          tenant_id,
        ])
      ).rows[0];
      if (head.applied !== head.committed)
        throw Error("rebuild_outbox_not_ready");
      if (head.projection_rule === "lifecycle-v3") {
        await db.query("COMMIT");
        continue;
      }
      build = (
        await db.query(
          "SELECT build_id,state FROM bb.projection_builds WHERE tenant_id=$1 AND state IN ('scanning','catching_up','verifying','ready')",
          [tenant_id],
        )
      ).rows[0];
      if (!build) {
        // Preserve failed candidates for diagnosis. An explicit owner repair is
        // required before retrying a failed build; the old generation stays live.
        const previous = (
          await db.query(
            "SELECT state FROM bb.projection_builds WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8",
            [tenant_id],
          )
        ).rows;
        if (previous[0]?.state === "failed")
          throw Error("rebuild_requires_explicit_repair");
        if (previous.length >= 8)
          throw Error("rebuild_retained_generation_budget");
        build = { build_id: randomUUID(), state: "scanning" };
        await db.query(
          "INSERT INTO bb.projection_builds(tenant_id,build_id,source_generation_id,source_rule,target_rule,source_cutoff,target_cutoff)VALUES($1,$2,$3,$4,'lifecycle-v3',$5,$5)",
          [
            tenant_id,
            build.build_id,
            head.projection_generation,
            head.projection_rule,
            head.committed,
          ],
        );
      }
      await db.query("COMMIT");
    } catch (error) {
      await db.query("ROLLBACK");
      throw error;
    }
    let result;
    for (let step = 0; step < 16004; step++) {
      result = await call("/v1/projection-build", {
        tenant_id,
        build_id: build.build_id,
        action: build.state === "ready" ? "publish" : "step",
      });
      build.state = result.state;
      if (result.state === "published") break;
    }
    if (result?.state !== "published") throw Error("rebuild_step_budget");
    results.push({
      tenant_id,
      build_id: build.build_id,
      state: result.state,
      recorded_cutoff: result.recorded_cutoff,
    });
  }
  return { published: results.length, builds: results };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = new pg.Pool({
    connectionString: process.env.ADMIN_DATABASE_URL,
    max: 1,
    statement_timeout: 10000,
  });
  try {
    const { runtimeFingerprint } =
      await import("../packages/runtime/compatibility.ts");
    const internal = await readFile(process.env.INTERNAL_KEY_FILE, "utf8");
    const deadline = Date.now() + 300000;
    const call = async (path, body) => {
      if (Date.now() > deadline) throw Error("rebuild_deadline");
      const response = await fetch(process.env.ENGINE_URL + path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-blackbox-internal": internal,
          "x-blackbox-contract": runtimeFingerprint,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw Error("rebuild_engine_failure");
      return response.json();
    };
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        const response = await fetch(process.env.ENGINE_URL + "/health", {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!ready) throw Error("rebuild_engine_not_ready");
    console.log(JSON.stringify(await rebuildAll(db, call)));
  } catch {
    console.error("projection_rebuild_incomplete");
    process.exitCode = 1;
  } finally {
    await db.end();
  }
}

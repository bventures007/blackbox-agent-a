import type { FastifyInstance } from "fastify";
import type { Principal } from "../../packages/auth/index.js";
import { authenticate } from "../../packages/auth/index.js";
import { scoped } from "../../packages/database/index.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod";
import { readLogs } from "../../packages/diagnostics/reader.js";
import { diagnostics } from "../../packages/diagnostics/index.js";
import { replayObservation } from "../../packages/connectors/replay.js";
import { ingest } from "../../packages/application/ingest.js";

export async function registerOwnerRoutes(
  app: FastifyInstance,
  owner: (p?: Principal) => Principal,
  internal: string,
) {
  app.get("/v1/overview", async (req) => {
    const p = owner(req.principal);
    return scoped(p.tenant_id, async (c) => ({
      workspace: (await c.query("SELECT name FROM bb.workspaces")).rows[0],
      heads: (await c.query("SELECT committed,applied FROM bb.heads")).rows[0],
      tracks: (
        await c.query(
          "SELECT record_type,count(*)::integer count,max(recorded_at) latest FROM bb.journal GROUP BY record_type",
        )
      ).rows,
      sources: (
        await c.query(
          "SELECT connection_id,provider,state,created_at,config->>'name' name FROM bb.connections ORDER BY created_at DESC",
        )
      ).rows,
      review: (
        await c.query(
          "SELECT count(*)::integer count FROM bb.review_cases WHERE state<>'resolved'",
        )
      ).rows[0].count,
      observed_at: new Date().toISOString(),
    }));
  });
  app.get("/v1/connections", async (req) => {
    const p = owner(req.principal);
    return scoped(p.tenant_id, async (c) => ({
      connections: (
        await c.query(`SELECT c.connection_id,c.provider,c.state,c.account_anchor,c.created_at,c.config->>'name' name,
      (SELECT count(*)::integer FROM bb.journal j WHERE j.connection_id=c.connection_id AND j.record_type='source') observations,
      (SELECT max(recorded_at) FROM bb.journal j WHERE j.connection_id=c.connection_id AND j.record_type='source') last_new_at
      FROM bb.connections c ORDER BY c.created_at DESC`)
      ).rows,
      runs: (
        await c.query(
          "SELECT run_id,connection_id,plan_id,state,fetched,committed,last_success_at,last_new_at,updated_at FROM bb.import_runs ORDER BY updated_at DESC LIMIT 100",
        )
      ).rows,
    }));
  });
  app.post("/v1/connections/:id/state", async (req) => {
    const p = owner(req.principal),
      id = z.uuid().parse((req.params as { id: string }).id),
      body = z
        .object({ state: z.enum(["configured", "paused"]) })
        .strict()
        .parse(req.body);
    await scoped(p.tenant_id, async (c) => {
      const r = await c.query(
        "UPDATE bb.connections SET state=$1 WHERE connection_id=$2 RETURNING connection_id",
        [body.state, id],
      );
      if (!r.rowCount) throw Error("missing_connection");
      await c.query(
        "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES($1,$2,$3,$4)",
        [
          p.tenant_id,
          randomUUID(),
          p.principal_id,
          "source." + (body.state === "paused" ? "paused" : "resumed"),
        ],
      );
    });
    return { ok: true };
  });
  app.get("/v1/agents", async (req) => {
    const p = owner(req.principal);
    return scoped(p.tenant_id, async (c) => ({
      agents: (
        await c.query(
          "SELECT credential_id,name,created_at,last_used_at,revoked_at FROM bb.credentials WHERE purpose='agent' ORDER BY created_at DESC",
        )
      ).rows,
    }));
  });
  app.post("/v1/example", async (req) => {
    const p = owner(req.principal);
    z.object({}).strict().parse(req.body);
    const connection = await scoped(p.tenant_id, async (c) => {
      await c.query("SELECT tenant_id FROM bb.heads FOR UPDATE");
      const prior = (
        await c.query(
          "SELECT connection_id FROM bb.connections WHERE provider='replay' AND config->>'example'='golden-v1'",
        )
      ).rows[0];
      if (prior) return prior.connection_id;
      const id = randomUUID();
      await c.query(
        "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'replay',$3,$4)",
        [
          p.tenant_id,
          id,
          randomUUID(),
          JSON.stringify({ name: "Golden example", example: "golden-v1" }),
        ],
      );
      return id;
    });
    const source = JSON.parse(
      await readFile(
        new URL("../../examples/golden-source.json", import.meta.url),
        "utf8",
      ),
    );
    const observations = await Promise.all(
      source.events.map((e: unknown) =>
        replayObservation(e, connection, source.currency),
      ),
    );
    const result = await ingest(p.tenant_id, connection, observations, {
      source: "bundled_synthetic_example",
      events: source.events,
    });
    return {
      ...result,
      entity_id: observations[0].entity_id,
      connection_id: connection,
      synthetic: true,
    };
  });
  app.get("/v1/diagnostics/health", async (req) => {
    const p = owner(req.principal),
      started = performance.now();
    const database = await scoped(p.tenant_id, async (c) => ({
      heads: (await c.query("SELECT committed,applied FROM bb.heads")).rows[0],
      pending: (
        await c.query(
          "SELECT count(*)::integer count,min(j.recorded_at) oldest FROM bb.outbox o JOIN bb.journal j USING(tenant_id,sequence) WHERE o.state='pending'",
        )
      ).rows[0],
    }));
    let engine = "unavailable";
    try {
      const r = await fetch(process.env.ENGINE_URL + "/health", {
        signal: AbortSignal.timeout(1500),
      });
      if (r.ok)
        engine =
          Number(database.heads.applied) >= Number(database.heads.committed)
            ? "healthy"
            : "catching_up";
    } catch {}
    let heartbeat: string | null = null;
    try {
      const s = JSON.parse(
        await readFile(
          join(process.env.LOG_DIR!, "worker-heartbeat.json"),
          "utf8",
        ),
      );
      if (z.iso.datetime().safeParse(s.observed_at).success)
        heartbeat = s.observed_at;
    } catch {}
    return {
      observed_at: new Date().toISOString(),
      api: {
        state: "healthy",
        version: "0.1.0",
        uptime_seconds: Math.floor(process.uptime()),
      },
      postgres: {
        state: "healthy",
        read_ms: Math.round(performance.now() - started),
      },
      engine: { state: engine, ...database.heads, ...database.pending },
      worker: {
        state:
          heartbeat && Date.now() - Date.parse(heartbeat) < 30000
            ? "healthy"
            : "unknown",
        heartbeat,
      },
      diagnostics: {
        state: diagnostics.degraded ? "degraded" : "healthy",
        dropped: diagnostics.dropped,
      },
      mcp: { state: "unknown", reason: "actual_client_activity_unmeasured" },
      backup: { state: "not_configured" },
    };
  });
  app.post("/v1/diagnostics/logs", async (req, reply) => {
    const p = owner(req.principal);
    try {
      const result = await readLogs(
        req.body,
        p.tenant_id,
        p.principal_id,
        internal,
      );
      await authenticate(req.accessKey!, ["session"]);
      return result;
    } catch (e) {
      if (e instanceof Error && e.message === "invalid_cursor")
        return reply.code(400).send({ error: "invalid_cursor" });
      throw e;
    }
  });
  app.post("/v1/diagnostics/export", async (req, reply) => {
    const p = owner(req.principal);
    z.object({ confirmed: z.literal(true) })
      .strict()
      .parse(req.body);
    const logs = await readLogs(
        { from: new Date(Date.now() - 3600000).toISOString(), limit: 1000 },
        p.tenant_id,
        p.principal_id,
        internal,
      ),
      salt = randomUUID();
    const records = logs.records.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          k.endsWith("_id")
            ? createHash("sha256")
                .update(salt + v)
                .digest("hex")
                .slice(0, 20)
            : v,
        ]),
      ),
    );
    await scoped(p.tenant_id, (c) =>
      c.query(
        "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES($1,$2,$3,'diagnostics.exported')",
        [p.tenant_id, randomUUID(), p.principal_id],
      ),
    );
    await authenticate(req.accessKey!, ["session"]);
    return reply
      .header(
        "content-disposition",
        'attachment; filename="blackbox-diagnostics.json"',
      )
      .send({
        format_version: 1,
        created_at: new Date().toISOString(),
        categories: ["sanitized_technical_logs"],
        truncated: !!logs.next_cursor,
        records,
      });
  });
}

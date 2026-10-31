import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID, createDecipheriv } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  authenticate,
  newKey,
  verifier,
  touch,
  type Principal,
} from "../../packages/auth/index.js";
import { pool, scoped } from "../../packages/database/index.js";
import { businessQuery } from "../../packages/contracts/index.js";
import { log } from "../../packages/diagnostics/index.js";
const port = Number(process.env.PORT ?? 8080),
  publicPort = Number(process.env.PUBLIC_PORT ?? 18741);
const origin = `http://127.0.0.1:${publicPort}`,
  hosts = new Set([`127.0.0.1:${publicPort}`]);
const internal = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8");
const app = Fastify({
  logger: false,
  bodyLimit: 2 * 1024 * 1024,
  requestTimeout: 5000,
});
await app.register(cookie);
declare module "fastify" {
  interface FastifyRequest {
    principal?: Principal;
    accessKey?: string;
  }
}
const attempts = new Map<string, { count: number; until: number }>();
app.addHook("onRequest", async (req, reply) => {
  reply
    .header("cache-control", "no-store")
    .header("x-content-type-options", "nosniff")
    .header(
      "content-security-policy",
      "default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'",
    );
  if (
    !hosts.has(req.headers.host ?? "") ||
    (req.headers.origin && req.headers.origin !== origin)
  )
    return reply.code(403).send({ error: "origin_denied" });
  if (req.url === "/" || req.url === "/ui.js" || req.url === "/ui.css") return;
  if (req.url === "/v1/login") {
    if (req.headers.origin !== origin)
      return reply.code(403).send({ error: "origin_required" });
    return;
  }
  const bearer = req.headers.authorization?.startsWith("Bearer ")
    ? req.headers.authorization.slice(7)
    : undefined;
  const key = bearer ?? req.cookies.bb_session;
  if (!key) return reply.code(401).send({ error: "unauthorized" });
  try {
    req.principal = await authenticate(
      key,
      bearer ? ["agent", "producer"] : ["session"],
    );
    req.accessKey = key;
    if (
      !bearer &&
      !["GET", "HEAD"].includes(req.method) &&
      (req.headers.origin !== origin ||
        req.headers["x-blackbox-csrf"] !==
          createHmac("sha256", internal).update(key).digest("hex"))
    )
      return reply.code(403).send({ error: "csrf_denied" });
    await touch(req.principal);
  } catch {
    return reply.code(401).send({ error: "unauthorized" });
  }
});
app.setErrorHandler((err, req, reply) => {
  log("access.denied", { tenant_id: req.principal?.tenant_id });
  reply
    .code(
      err instanceof z.ZodError ? 400 : err instanceof Forbidden ? 403 : 503,
    )
    .send({
      error:
        err instanceof z.ZodError ? "invalid_request" : "operation_unavailable",
    });
});
class Forbidden extends Error {}
const owner = (p?: Principal) => {
  if (p?.purpose !== "session") throw new Forbidden("owner_required");
  return p;
};
app.post("/v1/login", async (req, reply) => {
  const attempt = attempts.get(req.ip);
  if (attempt && attempt.until > Date.now() && attempt.count >= 5)
    return reply.code(429).send({ error: "login_throttled" });
  const body = z
    .object({ key: z.string().max(256), remember: z.boolean().default(false) })
    .strict()
    .parse(req.body);
  let p: Principal;
  try {
    p = await authenticate(body.key, ["owner"]);
  } catch {
    attempts.set(req.ip, {
      count: (attempt && attempt.until > Date.now() ? attempt.count : 0) + 1,
      until: Date.now() + 60000,
    });
    return reply.code(401).send({ error: "unauthorized" });
  }
  attempts.delete(req.ip);
  const key = newKey("session");
  await scoped(p.tenant_id, async (c) => {
    await c.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name,expires_at,idle_seconds) VALUES($1,$2,$3,'session',$4,'Browser session',now()+$5::interval,$6)",
      [
        p.tenant_id,
        randomUUID(),
        p.principal_id,
        verifier(key),
        body.remember ? "30 days" : "8 hours",
        body.remember ? 604800 : 28800,
      ],
    );
  });
  reply.setCookie("bb_session", key, {
    path: "/",
    httpOnly: true,
    sameSite: "strict",
    secure: false,
    ...(body.remember ? { maxAge: 2592000 } : {}),
  });
  return { csrf: createHmac("sha256", internal).update(key).digest("hex") };
});
app.get("/v1/session", async (req) => ({
  purpose: req.principal!.purpose,
  csrf:
    req.principal!.purpose === "session"
      ? createHmac("sha256", internal).update(req.accessKey!).digest("hex")
      : undefined,
}));
app.post("/v1/key/rotate", async (req) => {
  const p = owner(req.principal);
  const body = z
    .object({ current_key: z.string().max(256) })
    .strict()
    .parse(req.body);
  const current = await authenticate(body.current_key, ["owner"]);
  if (current.tenant_id !== p.tenant_id) throw new Forbidden("owner_required");
  const key = newKey("owner");
  await scoped(p.tenant_id, async (c) => {
    await c.query(
      "SELECT tenant_id FROM bb.heads WHERE tenant_id=$1 FOR UPDATE",
      [p.tenant_id],
    );
    const valid = await c.query(
      "SELECT 1 FROM bb.credentials WHERE credential_id=$1 AND revoked_at IS NULL FOR UPDATE",
      [current.credential_id],
    );
    if (!valid.rowCount) throw new Forbidden("credential_changed");
    await c.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE purpose IN ('owner','session')",
    );
    await c.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name) VALUES($1,$2,$3,'owner',$4,'Owner')",
      [p.tenant_id, randomUUID(), current.principal_id, verifier(key)],
    );
    await c.query(
      "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) VALUES($1,$2,$3,$4)",
      [p.tenant_id, randomUUID(), p.principal_id, "owner.rotated"],
    );
  });
  return { key };
});
app.post("/v1/logout", async (req, reply) => {
  const p = owner(req.principal);
  await scoped(p.tenant_id, (c) =>
    c.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE credential_id=$1",
      [p.credential_id],
    ),
  );
  reply.clearCookie("bb_session", { path: "/" });
  return { ok: true };
});
app.post("/v1/agents", async (req) => {
  const p = owner(req.principal);
  const body = z
    .object({ name: z.string().min(1).max(80) })
    .strict()
    .parse(req.body);
  const key = newKey("agent"),
    id = randomUUID();
  await scoped(p.tenant_id, async (c) => {
    await c.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name) VALUES($1,$2,$3,'agent',$4,$5)",
      [p.tenant_id, id, randomUUID(), verifier(key), body.name],
    );
    await c.query(
      "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) VALUES($1,$2,$3,$4)",
      [p.tenant_id, randomUUID(), p.principal_id, "agent.created"],
    );
  });
  return { credential_id: id, key };
});
app.post("/v1/agents/:id/revoke", async (req) => {
  const p = owner(req.principal);
  const id = z.uuid().parse((req.params as { id: string }).id);
  await scoped(p.tenant_id, async (c) => {
    await c.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE credential_id=$1 AND purpose='agent'",
      [id],
    );
    await c.query(
      "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) VALUES($1,$2,$3,$4)",
      [p.tenant_id, randomUUID(), p.principal_id, "agent.revoked"],
    );
  });
  return { ok: true };
});
app.get("/v1/status", async (req) => {
  const p = owner(req.principal);
  return scoped(p.tenant_id, async (c) => ({
    observed_at: new Date().toISOString(),
    ...(await c.query("SELECT committed,applied FROM bb.heads")).rows[0],
    imports: (
      await c.query(
        "SELECT run_id,state,fetched,committed,last_success_at,last_new_at FROM bb.import_runs",
      )
    ).rows,
    backup: { state: "not_configured" },
  }));
});
app.post("/v1/tools/:tool", async (req, reply) => {
  const p = req.principal!;
  if (!["agent", "session"].includes(p.purpose))
    return reply.code(403).send({ error: "business_read_required" });
  const tool = (req.params as { tool: string }).tool;
  if (tool === "get_business_state") {
    const q = businessQuery.parse(req.body);
    const response = await fetch(`${process.env.ENGINE_URL}/v1/state`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbox-internal": internal,
      },
      body: JSON.stringify({
        ...q,
        tenant_id: p.tenant_id,
        verifier: verifier(req.accessKey!),
      }),
      signal: AbortSignal.timeout(4500),
    });
    const result = await response.json();
    await authenticate(req.accessKey!, ["agent", "session"]);
    reply.code(response.status);
    log("query.served", { tenant_id: p.tenant_id });
    return result;
  }
  if (tool === "describe_business_schema")
    return {
      version: 1,
      tracks: ["source", "fact", "commitment", "movement", "reservation"],
      tools: [
        "get_business_state",
        "list_journal_entries",
        "get_journal_entry",
        "get_entity_history",
        "search_events",
        "get_evidence",
      ],
      money: "integer minor units",
      history: "fixed tenant committed cutoff",
      coverage: "observed records; completeness unverified",
    };
  if (
    ["list_journal_entries", "get_entity_history", "search_events"].includes(
      tool,
    )
  ) {
    const q = z
      .object({
        entity_id: z.uuid().optional(),
        track: z
          .enum(["source", "fact", "commitment", "movement", "reservation"])
          .optional(),
        limit: z.number().int().min(1).max(500).default(100),
        cursor: z.string().max(2000).optional(),
      })
      .strict()
      .parse(req.body);
    return scoped(p.tenant_id, async (c) => {
      let cutoff = Number(
          (await c.query("SELECT committed FROM bb.heads")).rows[0].committed,
        ),
        after = 0;
      if (q.cursor) {
        const [data, signature] = q.cursor.split(".");
        if (
          createHmac("sha256", internal).update(data).digest("hex") !==
          signature
        )
          throw new Error("invalid_cursor");
        const saved = JSON.parse(Buffer.from(data, "base64url").toString());
        if (
          saved.tenant !== p.tenant_id ||
          saved.entity !== q.entity_id ||
          saved.track !== q.track
        )
          throw new Error("invalid_cursor");
        cutoff = saved.cutoff;
        after = saved.after;
      }
      const rows = (
        await c.query(
          "SELECT * FROM bb.journal WHERE sequence>$1 AND sequence<=$2 AND ($3::uuid IS NULL OR entity_id=$3) AND ($4::text IS NULL OR record_type=$4) ORDER BY sequence LIMIT $5",
          [after, cutoff, q.entity_id ?? null, q.track ?? null, q.limit + 1],
        )
      ).rows;
      const more = rows.length > q.limit,
        entries = rows.slice(0, q.limit);
      const data = Buffer.from(
        JSON.stringify({
          tenant: p.tenant_id,
          entity: q.entity_id,
          track: q.track,
          cutoff,
          after: Number(entries.at(-1)?.sequence ?? after),
        }),
      ).toString("base64url");
      return {
        entries,
        recorded_cutoff: cutoff,
        next_cursor: more
          ? `${data}.${createHmac("sha256", internal).update(data).digest("hex")}`
          : null,
        coverage: "observed_records_only",
      };
    });
  }
  if (tool === "get_journal_entry") {
    const q = z.object({ entry_id: z.uuid() }).strict().parse(req.body);
    return scoped(p.tenant_id, async (c) => ({
      entry:
        (
          await c.query("SELECT * FROM bb.journal WHERE entry_id=$1", [
            q.entry_id,
          ])
        ).rows[0] ?? null,
    }));
  }
  if (tool === "get_evidence") {
    const q = z.object({ evidence_id: z.uuid() }).strict().parse(req.body);
    const present = await scoped(
      p.tenant_id,
      async (c) =>
        (
          await c.query(
            "SELECT 1 FROM bb.evidence WHERE evidence_id=$1 AND expires_at>now()",
            [q.evidence_id],
          )
        ).rowCount,
    );
    if (!present) return { status: "unavailable" };
    const bytes = await readFile(
      join(process.env.EVIDENCE_DIR!, p.tenant_id, q.evidence_id),
    );
    const key = await readFile(process.env.DATA_KEY_FILE!);
    const d = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
    d.setAAD(Buffer.from(`v1:${p.tenant_id}:${q.evidence_id}`));
    d.setAuthTag(bytes.subarray(-16));
    const content = Buffer.concat([
      d.update(bytes.subarray(12, -16)),
      d.final(),
    ]).toString();
    await authenticate(req.accessKey!, ["agent", "session"]);
    return {
      status: "available",
      content: JSON.parse(content),
      untrusted: true,
    };
  }
  return reply.code(400).send({ error: "unsupported_tool" });
});
for (const [url, file, type] of [
  ["/", "index.html", "text/html"],
  ["/ui.js", "ui.js", "text/javascript"],
  ["/ui.css", "ui.css", "text/css"],
])
  app.get(url, async (_, reply) =>
    reply
      .type(type)
      .send(await readFile(new URL(`./${file}`, import.meta.url), "utf8")),
  );
await app.listen({
  port,
  host: process.env.CONTAINER_RUNTIME === "1" ? "0.0.0.0" : "127.0.0.1",
});
log("service.started");
process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
});

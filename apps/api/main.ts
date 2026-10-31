import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID, createDecipheriv } from "node:crypto";
import { join } from "node:path";
import { z } from "zod";
import {
  authenticate,
  equal,
  newKey,
  verifier,
  touch,
  type Principal,
} from "../../packages/auth/index.js";
import { pool, scoped } from "../../packages/database/index.js";
import { ingest } from "../../packages/application/ingest.js";
import { questionQuery, intents } from "../../packages/contracts/questions.js";
import { canonical } from "../../packages/auth/producer.js";
import { validSignature } from "../../packages/auth/producer.js";
import { businessQuery, observation } from "../../packages/contracts/index.js";
import { journal, InvalidCursor } from "../../packages/application/journal.js";
import { registerOwnerRoutes } from "./owner.js";
import { registerStatic } from "./static.js";
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
  if (
    req.method === "GET" &&
    (req.url === "/" || /^\/assets\/[a-zA-Z0-9_.-]+$/.test(req.url))
  )
    return;
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
app.post("/v1/producers", async (req) => {
  const p = owner(req.principal);
  const body = z
    .object({
      name: z.string().min(1).max(80),
      provider: z.enum(["generic", "replay", "bank_csv", "policy"]),
    })
    .strict()
    .parse(req.body);
  const key = newKey("producer"),
    credential = randomUUID(),
    principal = randomUUID(),
    connection = randomUUID();
  await scoped(p.tenant_id, async (c) => {
    await c.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name) VALUES($1,$2,$3,'producer',$4,$5)",
      [p.tenant_id, credential, principal, verifier(key), body.name],
    );
    await c.query(
      "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config) VALUES($1,$2,$3,$4,$5)",
      [
        p.tenant_id,
        connection,
        body.provider,
        randomUUID(),
        JSON.stringify({ producer_principal_id: principal, name: body.name }),
      ],
    );
    await c.query(
      "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action) VALUES($1,$2,$3,'producer.created')",
      [p.tenant_id, randomUUID(), p.principal_id],
    );
  });
  return { connection_id: connection, credential_id: credential, key };
});
app.post("/v1/ingest/:connection", async (req, reply) => {
  const p = req.principal!;
  if (p.purpose !== "producer")
    return reply.code(403).send({ error: "producer_required" });
  const connection = z
    .uuid()
    .parse((req.params as { connection: string }).connection);
  const body = z
    .object({ observations: z.array(observation).min(1).max(250) })
    .strict()
    .parse(req.body);
  const timestamp = String(req.headers["x-blackbox-time"] ?? ""),
    nonce = String(req.headers["x-blackbox-nonce"] ?? "");
  if (
    !validSignature(
      req.accessKey!,
      req.url,
      timestamp,
      nonce,
      req.body,
      String(req.headers["x-blackbox-signature"] ?? ""),
    )
  )
    return reply.code(403).send({ error: "invalid_signature" });
  const allowed = await scoped(p.tenant_id, async (c) => {
    const conn = await c.query(
      "SELECT config FROM bb.connections WHERE connection_id=$1 AND state='configured'",
      [connection],
    );
    if (conn.rows[0]?.config.producer_principal_id !== p.principal_id)
      return false;
    // Replay protection is durable across service restarts; rejected delivery never enters the journal.
    const inserted = await c.query(
      "INSERT INTO bb.producer_receipts(tenant_id,credential_id,nonce) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce",
      [p.tenant_id, p.credential_id, nonce],
    );
    await c.query(
      "DELETE FROM bb.producer_receipts WHERE received_at<now()-interval '10 minutes'",
    );
    return !!inserted.rowCount;
  });
  if (!allowed)
    return reply.code(403).send({ error: "connection_or_nonce_denied" });
  const result = await ingest(p.tenant_id, connection, body.observations, body);
  log("journal.batch_committed", {
    tenant_id: p.tenant_id,
    connection_id: connection,
    committed_cursor: result.committed_cursor,
    record_count: result.added,
  });
  return reply.code(202).send(result);
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
  if (tool === "query_business") {
    const q = questionQuery.parse(req.body),
      { cursor, ...scope } = q;
    const fingerprint = canonical(scope);
    let cutoff = q.recorded_cutoff,
      offset = 0,
      asOf = q.as_of ?? q.effective_at ?? new Date().toISOString();
    if (cursor) {
      const [data, mac] = cursor.split(".");
      if (
        !equal(
          createHmac("sha256", internal).update(data).digest("hex"),
          mac ?? "",
        )
      )
        return reply.code(400).send({ error: "invalid_cursor" });
      const saved = JSON.parse(Buffer.from(data, "base64url").toString());
      if (
        saved.tenant !== p.tenant_id ||
        saved.principal !== p.principal_id ||
        saved.fingerprint !== fingerprint
      )
        return reply.code(400).send({ error: "cursor_scope_mismatch" });
      cutoff = saved.cutoff;
      offset = saved.offset;
      asOf = saved.as_of;
    }
    const response = await fetch(`${process.env.ENGINE_URL}/v1/query`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbox-internal": internal,
      },
      body: JSON.stringify({
        tenant_id: p.tenant_id,
        verifier: verifier(req.accessKey!),
        recorded_cutoff: cutoff,
        effective_at: q.effective_at,
        at_least_cursor: q.at_least_cursor,
        request: {
          intent: q.intent,
          entity_id: q.entity_id,
          item_id: q.item_id,
          currency: q.currency,
          requested_quantity: q.requested_quantity,
          unit: q.unit,
          as_of: asOf,
          from: q.from,
          limit: q.limit,
          offset,
        },
      }),
      signal: AbortSignal.timeout(4500),
    });
    const result = (await response.json()) as Record<string, unknown>;
    await authenticate(req.accessKey!, ["agent", "session"]);
    if (response.ok) {
      const next = result.next_offset;
      delete result.next_offset;
      const data = Buffer.from(
        JSON.stringify({
          tenant: p.tenant_id,
          principal: p.principal_id,
          fingerprint,
          cutoff: result.recorded_cutoff,
          offset: next,
          as_of: asOf,
        }),
      ).toString("base64url");
      result.next_cursor =
        next === null
          ? null
          : `${data}.${createHmac("sha256", internal).update(data).digest("hex")}`;
    }
    log("query.served", { tenant_id: p.tenant_id });
    reply.code(response.status);
    return result;
  }
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
      version: 2,
      intents,
      tracks: ["source", "fact", "commitment", "movement", "reservation"],
      tools: [
        "query_business",
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
    try {
      const result = await journal(req.body, p, internal);
      await authenticate(req.accessKey!, ["agent", "session"]);
      return result;
    } catch (error) {
      if (error instanceof InvalidCursor)
        return reply.code(400).send({ error: "invalid_cursor" });
      throw error;
    }
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
await registerOwnerRoutes(app, owner, internal);
await registerStatic(app);
await app.listen({
  port,
  host: process.env.CONTAINER_RUNTIME === "1" ? "0.0.0.0" : "127.0.0.1",
});
log("service.started");
process.on("SIGTERM", async () => {
  await app.close();
  await pool.end();
});

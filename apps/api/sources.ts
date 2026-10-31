import type { FastifyInstance } from "fastify";
import type { Principal } from "../../packages/auth/index.js";
import { z } from "zod";
import { scoped } from "../../packages/database/index.js";
import {
  connectShopify,
  beginImport,
  planPreview,
  sourceReadiness,
  SourceRequestError,
  auditSource,
} from "../../packages/application/sources.js";
import { shopifyCredentials } from "../../packages/connectors/shopify-client.js";
import { ProviderError } from "../../packages/connectors/transport.js";
export async function registerSourceRoutes(
  app: FastifyInstance,
  owner: (p?: Principal) => Principal,
) {
  const safe = async (reply: any, action: () => Promise<unknown>) => {
    try {
      return await action();
    } catch (e) {
      if (e instanceof SourceRequestError)
        return reply.code(e.status).send({ error: e.code });
      if (e instanceof ProviderError)
        return reply
          .code(422)
          .send({
            error: e.code,
            retry_after_ms: e.retryAfterMs,
            reauthorization_required: e.reauthorization,
          });
      throw e;
    }
  };
  app.post("/v1/sources/shopify", async (req, reply) => {
    const p = owner(req.principal),
      b = z
        .object({
          name: z.string().trim().min(1).max(80),
          credentials: shopifyCredentials,
          connection_id: z.uuid().optional(),
        })
        .strict()
        .parse(req.body);
    return safe(reply, () =>
      connectShopify(p, b.credentials, b.name, b.connection_id),
    );
  });
  app.post("/v1/sources/:id/preview", async (req, reply) => {
    const p = owner(req.principal),
      id = z.uuid().parse((req.params as any).id);
    return safe(reply, () => planPreview(p.tenant_id, id, req.body));
  });
  app.post("/v1/sources/:id/import", async (req, reply) => {
    const p = owner(req.principal),
      id = z.uuid().parse((req.params as any).id);
    return safe(reply, () => beginImport(p, id, req.body));
  });
  app.get("/v1/sources/readiness", async (req) =>
    sourceReadiness(owner(req.principal).tenant_id),
  );
  app.post("/v1/imports/:id/control", async (req, reply) => {
    const p = owner(req.principal),
      id = z.uuid().parse((req.params as any).id),
      b = z
        .object({ action: z.enum(["pause", "resume", "retry", "cancel"]) })
        .strict()
        .parse(req.body);
    return safe(reply, () =>
      scoped(p.tenant_id, async (c) => {
        const job = (
          await c.query(
            "SELECT * FROM bb.source_jobs WHERE job_id=$1 FOR UPDATE",
            [id],
          )
        ).rows[0];
        if (!job) throw new SourceRequestError("missing_run", 404);
        const state = {
          pause: "paused",
          resume: "queued",
          retry: "queued",
          cancel: "cancelled",
        }[b.action];
        const allowed = {
          pause: ["queued", "running"],
          resume: ["paused"],
          retry: ["failed", "reauthorization_required"],
          cancel: [
            "queued",
            "running",
            "paused",
            "failed",
            "reauthorization_required",
          ],
        }[b.action];
        if (!allowed.includes(job.state))
          throw new SourceRequestError("run_state_changed");
        await c.query(
          "UPDATE bb.source_jobs SET state=$2,fence=fence+1,lease_owner=NULL,leased_until=NULL,next_at=now(),error_code=NULL,attempts=0,updated_at=now() WHERE job_id=$1",
          [id, state],
        );
        await c.query(
          "UPDATE bb.import_runs SET state=$2,updated_at=now() WHERE run_id=$1",
          [job.run_id, state],
        );
        await auditSource(c, p, "source.import_" + b.action);
        return {
          ok: true,
          state,
          scope: job.kind,
          committed_history_preserved: true,
        };
      }),
    );
  });
}

import type { FastifyInstance } from "fastify";
import type { Principal } from "../../packages/auth/index.js";
import { z } from "zod";
import {
  saveEvidencePolicy,
  restrictEvidence,
  evidencePolicyStatus,
} from "../../packages/application/evidence-policy.js";
import { SourceRequestError } from "../../packages/application/sources.js";
export async function registerEvidencePolicyRoutes(
  app: FastifyInstance,
  owner: (p?: Principal) => Principal,
) {
  const safe = async (reply: any, action: () => Promise<unknown>) => {
    try {
      return await action();
    } catch (e) {
      if (e instanceof SourceRequestError)
        return reply.code(e.status).send({ error: e.code });
      throw e;
    }
  };
  app.get("/v1/evidence-policy", async (req) =>
    evidencePolicyStatus(owner(req.principal).tenant_id),
  );
  app.post("/v1/evidence-policy", async (req, reply) =>
    safe(reply, () => saveEvidencePolicy(owner(req.principal), req.body)),
  );
  app.post("/v1/evidence/:id/restrict", async (req, reply) => {
    const p = owner(req.principal),
      id = z.uuid().parse((req.params as any).id);
    z.object({ acknowledged: z.literal(true) })
      .strict()
      .parse(req.body);
    return safe(reply, () => restrictEvidence(p, id));
  });
}

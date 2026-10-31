import type { FastifyInstance } from "fastify";
import type { Principal } from "../../packages/auth/index.js";
import { authenticate } from "../../packages/auth/index.js";
import {
  reviewList,
  reviewDetail,
  decideReview,
  checkReview,
  ReviewError,
} from "../../packages/application/reviews.js";
import { z } from "zod";
export async function registerReviewRoutes(
  app: FastifyInstance,
  owner: (p?: Principal) => Principal,
  internal: string,
) {
  const id = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.get("/v1/reviews", async (req) => {
    const p = owner(req.principal),
      result = await reviewList(p.tenant_id);
    await authenticate(req.accessKey!, ["session"]);
    return result;
  });
  app.get("/v1/reviews/:id", async (req, reply) => {
    const p = owner(req.principal);
    try {
      const result = await reviewDetail(p.tenant_id, id(req.params));
      await authenticate(req.accessKey!, ["session"]);
      return result;
    } catch (e) {
      if (e instanceof ReviewError)
        return reply.code(e.status).send({ error: e.code });
      throw e;
    }
  });
  app.post("/v1/reviews/:id/decisions", async (req, reply) => {
    const p = owner(req.principal);
    try {
      return await decideReview(p, id(req.params), req.body, internal);
    } catch (e) {
      if (e instanceof ReviewError)
        return reply.code(e.status).send({ error: e.code });
      throw e;
    }
  });
  app.post("/v1/reviews/:id/check", async (req, reply) => {
    const p = owner(req.principal);
    z.object({}).strict().parse(req.body);
    try {
      return await checkReview(p, id(req.params), req.accessKey!, internal);
    } catch (e) {
      if (e instanceof ReviewError)
        return reply.code(e.status).send({ error: e.code });
      throw e;
    }
  });
}

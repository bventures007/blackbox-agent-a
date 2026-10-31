import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
const root = new URL("../web/dist/", import.meta.url);
export async function registerStatic(app: FastifyInstance) {
  app.get("/", async (_, reply) =>
    reply.type("text/html").send(await readFile(new URL("index.html", root))),
  );
  app.get("/assets/:name", async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (!/^[a-zA-Z0-9_-]+\.(js|css|woff2)$/.test(name))
      return reply.code(404).send();
    const type = name.endsWith(".js")
      ? "text/javascript"
      : name.endsWith(".css")
        ? "text/css"
        : "font/woff2";
    try {
      return reply
        .type(type)
        .send(await readFile(new URL("assets/" + name, root)));
    } catch {
      return reply.code(404).send();
    }
  });
}

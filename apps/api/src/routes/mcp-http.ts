import type { FastifyInstance } from 'fastify';
import type { Services } from '../app.js';
/** Optional authenticated loopback HTTP MCP transport. Disabled by default; the stdio bridge is the tested path. */
export async function registerMcpHttp(app: FastifyInstance, s: Services) {
  app.post('/mcp', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: false, agent: true, csrf: false }); if (!p) return;
    const { handleMcpRequest } = await import('../mcp-core.js');
    return handleMcpRequest(s, p, req.body as Record<string, unknown>);
  });
}

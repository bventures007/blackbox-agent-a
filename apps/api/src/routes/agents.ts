import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Services } from '../app.js';

/** Agents & MCP settings: named read-only agent keys and producer keys. Secrets are shown once. */
export async function registerAgentRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/agents', async (req, reply) => { const p = await app.authenticate(req, reply, { owner: true, csrf: false }); if (!p) return; return { principals: await s.auth.listPrincipals(p.tenantId), grant: 'Read all business records and evidence in this workspace. No administration, no source secrets, no technical logs, no writes.', bridge: { transport: 'stdio', command: 'blackbox-mcp', env: ['BLACKBOX_AGENT_KEY (never a command-line argument)', 'BLACKBOX_API_URL=' + s.config.origin], http_transport: s.config.mcpHttpEnabled ? `${s.config.origin}/mcp` : null } }; });
  app.post('/api/agents', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ name: z.string().min(1).max(80), kind: z.enum(['agent', 'producer']).default('agent'), expires_in_days: z.number().int().min(1).max(365).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const expires = body.data.expires_in_days ? new Date(Date.now() + body.data.expires_in_days * 86400_000) : null;
    const created = body.data.kind === 'agent' ? await s.auth.createAgentKey(p.tenantId, p.ownerId, body.data.name, expires) : await s.auth.createProducerKey(p.tenantId, p.ownerId, body.data.name);
    s.ctx.log.info('agents.key_created', `${body.data.kind} key created`, { tenant_id: p.tenantId, operation_id: created.principalId });
    return reply.code(201).send({ principal_id: created.principalId, secret: created.secret, shown_once: true });
  });
  app.post('/api/agents/:id/revoke', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const ok = await s.auth.revokePrincipal(p.tenantId, p.ownerId, (req.params as { id: string }).id);
    if (!ok) return reply.code(404).send({ error: 'not_found' });
    s.ctx.log.info('agents.key_revoked', 'principal revoked; new requests fail immediately', { tenant_id: p.tenantId, operation_id: (req.params as { id: string }).id });
    return { ok: true, revoked_at: new Date().toISOString() };
  });
  // who am I (agents use this to confirm scope)
  app.get('/api/whoami', async (req, reply) => { const p = await app.authenticate(req, reply, { agent: true, csrf: false }); if (!p) return; return p.kind === 'owner' ? { kind: 'owner', tenant_id: p.tenantId } : { kind: p.kind, tenant_id: p.tenantId, principal_id: p.principalId, name: p.name, grant: 'read_business_records' }; });
}

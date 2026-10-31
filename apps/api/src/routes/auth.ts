import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AuthError, originAllowed } from '@blackbox/application';
import type { Services } from '../app.js';

export async function registerAuthRoutes(app: FastifyInstance, s: Services) {
  const cookieOpts = (remembered: boolean, expires: Date) => ({ httpOnly: true, sameSite: 'strict' as const, path: '/', secure: s.config.origin.startsWith('https://'), ...(remembered ? { expires } : {}) });

  app.post('/api/auth/login', async (req, reply) => {
    if (!originAllowed(req.headers as Record<string, string | undefined>, s.config.origin) || req.headers['x-blackbox-request'] !== '1') return reply.code(403).send({ error: 'csrf_rejected' });
    const body = z.object({ access_key: z.string().min(10).max(200), remember: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    try {
      const { token, session } = await s.auth.loginWithOwnerKey(body.data.access_key.trim(), req.ip || 'local', body.data.remember);
      reply.setCookie('bbx_session', token, cookieOpts(session.remembered, session.absoluteExpiresAt));
      s.ctx.log.info('auth.login', 'owner signed in', { tenant_id: session.tenantId, trace_id: req.id });
      return { ok: true, session: { remembered: session.remembered, absolute_expires_at: session.absoluteExpiresAt, idle_expires_at: session.idleExpiresAt } };
    } catch (err) {
      if (err instanceof AuthError) { s.ctx.log.warn('auth.login_failed', 'owner sign-in rejected', { error_code: err.code, trace_id: req.id }); return reply.code(err.code === 'throttled' ? 429 : 401).send({ error: err.code, message: err.message }); }
      throw err;
    }
  });
  app.post('/api/auth/logout', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p) return;
    if (req.sessionToken) await s.auth.logout(req.sessionToken);
    reply.clearCookie('bbx_session', { path: '/' }); return { ok: true };
  });
  app.get('/api/auth/session', async (req, reply) => {
    const token = req.cookies['bbx_session']; const session = token ? await s.auth.authenticateSession(token) : null;
    if (!session) return reply.code(401).send({ error: 'unauthenticated' });
    const ws = await s.ctx.db.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${session.tenantId}, true)`; const [t] = await tx`SELECT name, timezone FROM tenants WHERE tenant_id = ${session.tenantId}`; const [loc] = await tx`SELECT value FROM settings WHERE tenant_id = ${session.tenantId} AND key = 'locale'`; return { name: t?.name, timezone: t?.timezone, locale: (loc?.value as { default?: string } | undefined)?.default ?? 'en' }; });
    return { owner_id: session.ownerId, tenant_id: session.tenantId, remembered: session.remembered, absolute_expires_at: session.absoluteExpiresAt, idle_expires_at: session.idleExpiresAt, workspace: ws };
  });
  app.post('/api/auth/rotate-key', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ current_key: z.string().min(10).max(200) }).safeParse(req.body); if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    try { const key = await s.auth.rotateOwnerKey(p.tenantId, p.ownerId, body.data.current_key.trim()); reply.clearCookie('bbx_session', { path: '/' }); return { ok: true, new_access_key: key }; }
    catch (err) { if (err instanceof AuthError) return reply.code(401).send({ error: err.code, message: err.message }); throw err; }
  });
  app.put('/api/settings/locale', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p) return;
    const body = z.object({ locale: z.enum(['en', 'de']) }).safeParse(req.body); if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    await s.ctx.db.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${p.tenantId}, true)`; await tx`INSERT INTO settings (tenant_id, scope, key, value, updated_by) VALUES (${p.tenantId}, 'workspace', 'locale', ${tx.json({ default: body.data.locale })}, ${p.kind === 'owner' ? p.ownerId : null}) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`; });
    return { ok: true };
  });
  app.put('/api/settings/workspace', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p) return;
    const body = z.object({ name: z.string().min(1).max(80) }).safeParse(req.body); if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    await s.ctx.db.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${p.tenantId}, true)`; await tx`UPDATE tenants SET name = ${body.data.name} WHERE tenant_id = ${p.tenantId}`; });
    return { ok: true };
  });
}
declare module 'fastify' { interface FastifyInstance { authenticate(req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, opts: { owner?: boolean; agent?: boolean; csrf?: boolean }): Promise<import('@blackbox/application').Principal | null> } }

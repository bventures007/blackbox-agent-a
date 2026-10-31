import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { withScope, withTenant } from '@blackbox/database';
import { queryLogs, storeUsage, DEFAULT_RETENTION, type Level } from '@blackbox/logging';
import { buildExportBundle } from '../export.js';
import type { Services } from '../app.js';

const LogQueryBody = z.object({
  since: z.string().datetime({ offset: true }).optional(), until: z.string().datetime({ offset: true }).optional(),
  levels: z.array(z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR'])).optional(), min_level: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).optional(),
  components: z.array(z.enum(['wrapper', 'api', 'worker', 'engine', 'mcp', 'postgres', 'fixture'])).optional(),
  connection_ids: z.array(z.string().max(80)).max(20).optional(), run_ids: z.array(z.string().max(80)).max(20).optional(), trace_id: z.string().max(80).optional(),
  event_names: z.array(z.string().max(80)).max(20).optional(), text: z.string().max(200).optional(), page_size: z.number().int().min(1).max(1000).default(200), before_cursor: z.string().max(120).optional(), include_installation: z.boolean().default(true),
});
const ORDER: Level[] = ['DEBUG', 'INFO', 'WARN', 'ERROR'];

export async function registerDiagnosticsRoutes(app: FastifyInstance, s: Services, debugState: { base: Level; debugConnections: Set<string>; debugAll: boolean }) {
  // owner only; agents never reach technical diagnostics
  const owner = (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply, csrf?: boolean) => app.authenticate(req, reply, { owner: true, csrf });

  app.get('/api/diagnostics/health', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; const h = await s.health.overview(p.tenantId); return { ...h, ops: await opsStatus(s, p.tenantId) }; });
  app.post('/api/diagnostics/logs', async (req, reply) => {
    const p = await owner(req, reply, false); if (!p) return;
    const b = LogQueryBody.safeParse(req.body ?? {}); if (!b.success) return reply.code(400).send({ error: 'invalid_filter', message: b.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ') });
    const q = b.data; const since = q.since ? new Date(q.since) : new Date(Date.now() - 3600_000); const until = q.until ? new Date(q.until) : undefined;
    let levels = q.levels ? new Set<string>(q.levels) : new Set<string>(['INFO', 'WARN', 'ERROR']);
    if (q.min_level) levels = new Set(ORDER.slice(ORDER.indexOf(q.min_level)));
    const started = Date.now();
    const page = queryLogs(s.config.logDir, { since, until, levels, components: q.components ? new Set(q.components) : undefined, tenantId: p.tenantId, includeInstallation: q.include_installation, connectionIds: q.connection_ids ? new Set(q.connection_ids) : undefined, runIds: q.run_ids ? new Set(q.run_ids) : undefined, traceId: q.trace_id, eventNames: q.event_names ? new Set(q.event_names) : undefined, text: q.text, pageSize: q.page_size, beforeCursor: q.before_cursor });
    const usage = storeUsage(s.config.logDir);
    const retainedFrom = usage.oldestHour ? new Date(usage.oldestHour + ':00:00Z') : null;
    return { records: page.records, next_cursor: page.nextCursor, query_ms: Date.now() - started, scanned_bytes: page.scannedBytes, segments_scanned: page.segmentsScanned, retained_from: retainedFrom, retained_to: usage.newestHour ? new Date(usage.newestHour + ':59:59Z') : null, out_of_retention: retainedFrom ? since < retainedFrom : false, dropped_records: s.ctx.log.dropped.count, filters_applied: { since, until: until ?? null, levels: [...levels], components: q.components ?? null, connection_ids: q.connection_ids ?? null, run_ids: q.run_ids ?? null, trace_id: q.trace_id ?? null, text: q.text ?? null } };
  });
  app.get('/api/diagnostics/debug', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; return { windows: await withScope(s.ctx.db, 'scheduler', (tx) => tx`SELECT window_id, component, connection_id, run_id, started_at, expires_at, stopped_at FROM debug_windows WHERE (tenant_id = ${p.tenantId} OR tenant_id IS NULL) AND stopped_at IS NULL AND expires_at > now() ORDER BY started_at DESC`), max_minutes: 15 }; });
  app.post('/api/diagnostics/debug', async (req, reply) => {
    const p = await owner(req, reply); if (!p || p.kind !== 'owner') return;
    const b = z.object({ component: z.enum(['api', 'worker', 'engine', 'mcp']), connection_id: z.string().uuid().optional(), run_id: z.string().uuid().optional(), minutes: z.number().int().min(1).max(15).default(15) }).safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const expires = new Date(Date.now() + b.data.minutes * 60_000); const id = randomUUID();
    await withTenant(s.ctx.db, p.tenantId, async (tx) => { await tx`INSERT INTO debug_windows (window_id, tenant_id, component, connection_id, run_id, expires_at, actor_id) VALUES (${id}, ${p.tenantId}, ${b.data.component}, ${b.data.connection_id ?? null}, ${b.data.run_id ?? null}, ${expires}, ${p.ownerId})`; await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${p.tenantId}, 'owner', ${p.ownerId}, 'debug.enabled', ${tx.json({ window_id: id, component: b.data.component, connection_id: b.data.connection_id ?? null, expires_at: expires.toISOString() })})`; });
    if (b.data.component === 'engine') await s.ctx.engine.debug(b.data.minutes).catch(() => undefined);
    s.ctx.log.info('diagnostics.debug_enabled', 'temporary debug window started', { tenant_id: p.tenantId, connection_id: b.data.connection_id, action_code: b.data.component });
    return { window_id: id, expires_at: expires.toISOString() };
  });
  app.post('/api/diagnostics/debug/:id/stop', async (req, reply) => {
    const p = await owner(req, reply); if (!p || p.kind !== 'owner') return;
    const id = (req.params as { id: string }).id;
    const rows = await withTenant(s.ctx.db, p.tenantId, (tx) => tx`UPDATE debug_windows SET stopped_at = now() WHERE window_id = ${id} AND tenant_id = ${p.tenantId} AND stopped_at IS NULL RETURNING component`);
    if (rows[0]?.component === 'engine') await s.ctx.engine.debug(0).catch(() => undefined);
    await withTenant(s.ctx.db, p.tenantId, (tx) => tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${p.tenantId}, 'owner', ${p.ownerId}, 'debug.stopped', ${tx.json({ window_id: id })})`);
    s.ctx.log.info('diagnostics.debug_stopped', 'debug window stopped by owner', { tenant_id: p.tenantId });
    return { ok: true };
  });
  app.get('/api/diagnostics/export/preview', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; const since = new Date(Date.now() - Number((req.query as { hours?: string }).hours ?? 1) * 3600_000); const bundle = await buildExportBundle(s, p.tenantId, since, { preview: true }); return bundle; });
  app.post('/api/diagnostics/export', async (req, reply) => {
    const p = await owner(req, reply); if (!p || p.kind !== 'owner') return;
    const b = z.object({ hours: z.number().int().min(1).max(168).default(1), categories: z.array(z.enum(['versions', 'health', 'errors', 'logs', 'config'])).default(['versions', 'health', 'errors', 'logs', 'config']) }).safeParse(req.body ?? {}); if (!b.success) return reply.code(400).send({ error: 'invalid_request' });
    const bundle = await buildExportBundle(s, p.tenantId, new Date(Date.now() - b.data.hours * 3600_000), { preview: false, categories: new Set(b.data.categories) });
    await withTenant(s.ctx.db, p.tenantId, (tx) => tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${p.tenantId}, 'owner', ${p.ownerId}, 'diagnostics.exported', ${tx.json({ hours: b.data.hours, categories: b.data.categories, bytes: Number(bundle.size_bytes ?? 0) })})`);
    reply.header('content-disposition', `attachment; filename="blackbox-diagnostics-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json"`);
    return bundle;
  });
  app.get('/api/diagnostics/retention', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; const policy = await withScope(s.ctx.db, 'scheduler', async (tx) => (await tx`SELECT value FROM settings WHERE scope = 'installation' AND key = 'log_retention' AND tenant_id = '00000000-0000-0000-0000-000000000000'`)[0]?.value); return { policy: policy ?? DEFAULT_RETENTION, usage: storeUsage(s.config.logDir), bounds: { days: [1, 30], total_mib: [10, 1000] } }; });
  app.put('/api/diagnostics/retention', async (req, reply) => {
    const p = await owner(req, reply); if (!p || p.kind !== 'owner') return;
    const b = z.object({ maxDays: z.number().int().min(1).max(30), maxTotalBytes: z.number().int().min(10 << 20).max(1000 << 20) }).safeParse(req.body); if (!b.success) return reply.code(400).send({ error: 'invalid_request', message: 'retention must stay within 1-30 days and 10-1000 MiB' });
    await withScope(s.ctx.db, 'scheduler', (tx) => tx`INSERT INTO settings (tenant_id, scope, key, value, updated_by) VALUES ('00000000-0000-0000-0000-000000000000', 'installation', 'log_retention', ${tx.json(b.data)}, ${p.ownerId}) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    return { ok: true };
  });
  // Review cases (Needs review)
  app.get('/api/review', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; return { cases: await s.review.list(p.tenantId, (req.query as { state?: string }).state) }; });
  app.get('/api/review/:id', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; const c = await s.review.get(p.tenantId, (req.params as { id: string }).id); if (!c) return reply.code(404).send({ error: 'not_found' }); return { case: c }; });
  app.post('/api/review/:id/decide', async (req, reply) => {
    const p = await owner(req, reply); if (!p || p.kind !== 'owner') return;
    const b = z.object({ expected_revision: z.number().int(), decision: z.enum(['retry', 'confirm_link', 'reject_link', 'manual_assertion', 'leave_unresolved']), reason: z.string().min(1).max(500), asserted: z.object({ event_type: z.string(), occurred_at: z.string().datetime({ offset: true }), payload: z.record(z.unknown()), evidence_refs: z.array(z.string()).optional() }).optional() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: 'invalid_request', message: b.error.message });
    const r = await s.review.decide(p.tenantId, p.ownerId, (req.params as { id: string }).id, b.data.expected_revision, b.data.decision, b.data.reason, b.data.asserted);
    if (!r.ok) return reply.code(r.code === 'not_found' ? 404 : 409).send({ error: r.code, revision: r.revision });
    return r;
  });
  // debug windows drive the API logger level provider
  const refresh = async () => { try { const rows = await withScope(s.ctx.db, 'scheduler', (tx) => tx`SELECT component, connection_id FROM debug_windows WHERE stopped_at IS NULL AND expires_at > now()`); debugState.debugAll = rows.some((r) => r.component === 'api' && !r.connection_id); debugState.debugConnections = new Set(rows.filter((r) => r.component === 'api' && r.connection_id).map((r) => r.connection_id as string)); } catch { /* keep previous */ } };
  await refresh(); const t = setInterval(refresh, 5000); t.unref();
  // audit records (safe metadata)
  app.get('/api/audit', async (req, reply) => { const p = await owner(req, reply, false); if (!p) return; return { events: await withTenant(s.ctx.db, p.tenantId, (tx) => tx`SELECT audit_id, at, actor_kind, action, metadata FROM audit_events WHERE tenant_id = ${p.tenantId} ORDER BY at DESC LIMIT 200`) }; });
}

export async function opsStatus(s: Services, tenantId: string) {
  const [backup, fence, gens, release, disk] = await Promise.all([
    withTenant(s.ctx.db, tenantId, async (tx) => (await tx`SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'backup'`)[0]?.value ?? { configured: false }),
    withScope(s.ctx.db, 'scheduler', async (tx) => (await tx`SELECT holder, phase, acquired_at, expires_at, detail FROM maintenance_fence WHERE fence_id = 1`)[0]),
    withScope(s.ctx.db, 'scheduler', (tx) => tx`SELECT generation_id, kind, state, started_at, completed_at, cutoffs, destination, file_name, size_bytes, error_code FROM backup_generations ORDER BY started_at DESC LIMIT 10`),
    withScope(s.ctx.db, 'scheduler', async (tx) => (await tx`SELECT app_version, schema_version, reducer_version, installed_at, updated_at FROM release_info WHERE info_id = 1`)[0] ?? null),
    (async () => { try { const { statfsSync } = await import('node:fs'); const st = statfsSync(s.config.dataDir); return { total_bytes: Number(st.blocks) * Number(st.bsize), free_bytes: Number(st.bavail) * Number(st.bsize) }; } catch { return null; } })(),
  ]);
  const last = gens.find((g) => g.state === 'complete');
  const ageHours = last?.completed_at ? (Date.now() - new Date(last.completed_at as string).getTime()) / 3600_000 : null;
  const freeWarn = disk ? disk.free_bytes < Math.max(disk.total_bytes * 0.1, 5 * 1024 ** 3) : null; const freeCrit = disk ? disk.free_bytes < Math.max(disk.total_bytes * 0.02, 1024 ** 3) : null;
  const unresolved = await withTenant(s.ctx.db, tenantId, async (tx) => Number((await tx`SELECT count(*)::int AS n FROM review_cases WHERE tenant_id = ${tenantId} AND state <> 'resolved'`)[0]?.n ?? 0));
  return { backup: { configured: Boolean((backup as { configured?: boolean }).configured), config: backup, last_complete: last ?? null, recoverable_age_hours: ageHours, overdue: ageHours !== null ? ageHours > 24 : (backup as { configured?: boolean }).configured ? true : null, generations: gens, unprotected: !(backup as { configured?: boolean }).configured }, maintenance: fence?.holder ? { holder: fence.holder, phase: fence.phase, acquired_at: fence.acquired_at, expires_at: fence.expires_at } : null, release, storage: disk ? { ...disk, state: freeCrit ? 'critical' : freeWarn ? 'warning' : 'ok', thresholds: { warning: 'below max(10%, 5 GiB)', critical: 'below max(2%, 1 GiB)' } } : null, unresolved_review_cases: unresolved };
}

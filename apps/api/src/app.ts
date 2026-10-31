import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, withScope } from '@blackbox/database';
import { FileStoreSink, Logger, StderrSink, type Level } from '@blackbox/logging';
import { AuthService, DataKeyring, EngineClient, HealthService, IngestService, QueryService, ReviewService, SourcesService, originAllowed, type AppContext, type Principal } from '@blackbox/application';
import type { ApiConfig } from './config.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerQueryRoutes } from './routes/query.js';
import { registerSourceRoutes } from './routes/sources.js';
import { registerIngestRoutes } from './routes/ingest.js';
import { registerDiagnosticsRoutes } from './routes/diagnostics.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerMcpHttp } from './routes/mcp-http.js';

export interface Services { ctx: AppContext; auth: AuthService; query: QueryService; sources: SourcesService; ingest: IngestService; health: HealthService; review: ReviewService; config: ApiConfig }

declare module 'fastify' { interface FastifyRequest { principal?: Principal; sessionToken?: string } }

export async function buildApp(config: ApiConfig): Promise<{ app: FastifyInstance; services: Services }> {
  const debugState = { base: 'INFO' as Level, debugConnections: new Set<string>(), debugAll: false };
  const sink = new FileStoreSink({ dir: config.logDir, component: 'api' });
  const log = new Logger({ component: 'api', serviceVersion: config.version, sinks: [sink, new StderrSink('WARN')], levelProvider: () => debugState });
  const db = createDb({ url: config.databaseUrl, max: 10, applicationName: 'blackbox-api' });
  const keyring = DataKeyring.fromFiles([{ version: 1, path: config.dataKeyPath }], 1);
  const engine = new EngineClient(config.engineUrl, config.engineToken);
  const ctx: AppContext = { db, log, engine, keyring, version: config.version, origin: config.origin, logDir: config.logDir, dataDir: config.dataDir, now: () => new Date() };
  const auth = new AuthService(db); const query = new QueryService(ctx); const sources = new SourcesService(ctx); const ingest = new IngestService(db, log); const health = new HealthService(ctx); const review = new ReviewService(ctx);
  const services: Services = { ctx, auth, query, sources, ingest, health, review, config };

  const app = Fastify({ logger: false, bodyLimit: 2 * 1024 * 1024, trustProxy: false, disableRequestLogging: true });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024, files: 1 } });

  // Request logging to the shared record; no URLs with query strings, no bodies
  app.addHook('onResponse', async (req, reply) => {
    if (req.url.startsWith('/assets') || req.url === '/api/health/live') return;
    const level = reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'debug';
    log[level]('http.request', `${req.method} ${req.routeOptions?.url ?? req.url.split('?')[0]} -> ${reply.statusCode}`, { tenant_id: req.principal?.tenantId, duration_ms: Math.round(reply.elapsedTime), error_code: reply.statusCode >= 400 ? `http_${reply.statusCode}` : undefined, trace_id: req.id });
  });
  // Exact Host check on every request; loopback is not authorization but forged hosts are refused (DNS rebinding)
  app.addHook('onRequest', async (req, reply) => {
    const host = String(req.headers.host ?? ''); const allowed = new URL(config.origin).host;
    const ok = host === allowed || host === allowed.replace('127.0.0.1', 'localhost') || host === allowed.replace('localhost', '127.0.0.1') || (process.env.BLACKBOX_IN_CONTAINER === '1' && /^(api|localhost|127\.0\.0\.1)(:\d+)?$/.test(host) && !req.url.startsWith('/api/'));
    if (!ok) { reply.code(421).send({ error: 'misdirected_request', message: 'unexpected Host header' }); return reply; }
  });
  // Session or agent authentication (never both); CSRF for mutating owner requests
  app.decorate('authenticate', async (req: FastifyRequest, reply: FastifyReply, opts: { owner?: boolean; agent?: boolean; csrf?: boolean }) => {
    const token = req.cookies['bbx_session'];
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    let principal: Principal | null = null;
    if (opts.owner !== false && token) { principal = await auth.authenticateSession(token); if (principal) req.sessionToken = token; }
    if (!principal && bearer) principal = await auth.authenticateKey(bearer, 'agent');
    if (!principal) { reply.code(401).send({ error: 'unauthenticated', message: 'sign in with your access key or supply an agent key' }); return null; }
    if (!opts.agent && principal.kind !== 'owner') { reply.code(403).send({ error: 'owner_required', message: 'read-only agent keys cannot use this operation' }); return null; }
    if (opts.owner && principal.kind !== 'owner') { reply.code(403).send({ error: 'owner_required', message: 'read-only agent keys cannot use this operation' }); return null; }
    if (principal.kind === 'owner' && (opts.csrf ?? (req.method !== 'GET' && req.method !== 'HEAD'))) {
      if (!originAllowed(req.headers as Record<string, string | undefined>, config.origin) || req.headers['x-blackbox-request'] !== '1') { reply.code(403).send({ error: 'csrf_rejected', message: 'request origin not allowed' }); return null; }
    }
    req.principal = principal; return principal;
  });

  await registerAuthRoutes(app, services);
  await registerQueryRoutes(app, services);
  await registerSourceRoutes(app, services);
  await registerIngestRoutes(app, services);
  await registerDiagnosticsRoutes(app, services, debugState);
  await registerAgentRoutes(app, services);
  if (config.mcpHttpEnabled) await registerMcpHttp(app, services);

  app.get('/api/health/live', async () => ({ status: 'ok', version: config.version, observed_at: new Date().toISOString() }));
  app.get('/api/meta', async () => ({ version: config.version, origin: config.origin, reducer_version: 'r1', schema_version: 1, locales: ['en', 'de'], pilot: 'local_pilot' }));

  // Static UI (SPA) and landing, served only when built
  if (config.landingDist && existsSync(config.landingDist)) await app.register(fastifyStatic, { root: config.landingDist, prefix: '/landing/', decorateReply: false, index: ['index.html'] });
  if (config.webDist && existsSync(config.webDist)) {
    await app.register(fastifyStatic, { root: config.webDist, prefix: '/', wildcard: false, index: false });
    app.setNotFoundHandler(async (req, reply) => {
      // the app shell is served only for navigations; unknown API paths, callbacks or non-GET requests are refused explicitly
      if (req.url.startsWith('/api/') || (req.method !== 'GET' && req.method !== 'HEAD') || req.url.startsWith('/mcp')) return reply.code(404).send({ error: 'not_found' });
      // a missing asset (any path whose last segment has an extension) is a real 404; serving the shell for it would hide broken builds
      if (/\.[A-Za-z0-9]+$/.test(req.url.split('?')[0]!.split('/').pop() ?? '')) return reply.code(404).send({ error: 'not_found' });
      if (req.url.startsWith('/landing')) return reply.sendFile('index.html', config.landingDist!);
      return reply.sendFile('index.html', join(config.webDist!));
    });
  }
  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number; validation?: unknown; code?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    log[status >= 500 ? 'error' : 'warn']('http.error', e.message?.slice(0, 200) ?? 'error', { tenant_id: req.principal?.tenantId, error_code: e.code ?? `http_${status}`, trace_id: req.id });
    reply.code(status).send({ error: status >= 500 ? 'internal_error' : (e.code ?? 'request_error'), message: status >= 500 ? 'an internal error occurred; see diagnostics' : e.message });
  });
  app.addHook('onClose', async () => { sink.close(); await db.end({ timeout: 5 }); });
  // retention: enforce at start and hourly (shared logs volume)
  const { enforceRetention, DEFAULT_RETENTION } = await import('@blackbox/logging');
  const retention = async () => { try { const policy = await withScope(db, 'scheduler', async (tx) => (await tx`SELECT value FROM settings WHERE scope = 'installation' AND key = 'log_retention' AND tenant_id = '00000000-0000-0000-0000-000000000000'`)[0]?.value as { maxDays?: number; maxTotalBytes?: number } | undefined); const r = enforceRetention(config.logDir, { maxDays: Math.min(30, Math.max(1, policy?.maxDays ?? DEFAULT_RETENTION.maxDays)), maxTotalBytes: Math.min(1000 << 20, Math.max(10 << 20, policy?.maxTotalBytes ?? DEFAULT_RETENTION.maxTotalBytes)) }); if (r.removed.length) log.info('diagnostics.retention_applied', 'technical log segments rotated', { record_count: r.removed.length }); } catch (e) { log.warn('diagnostics.retention_failed', (e as Error).message, { error_code: 'retention_failed' }); } };
  await retention(); const timer = setInterval(retention, 3600_000); timer.unref();
  return { app, services };
}

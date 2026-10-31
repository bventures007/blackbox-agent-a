/**
 * Connector worker: leased jobs for Shopify import/poll/reconciliation, coverage emission, backup scheduling,
 * debug-window expiry and heartbeats. Outbound only; no inbound port.
 */
import { readFileSync } from 'node:fs';
import { createDb, withScope, withTenant } from '@blackbox/database';
import { FileStoreSink, Logger, StderrSink, type Level } from '@blackbox/logging';
import { DataKeyring, EngineClient, IngestService, JobQueue, SourcesService, type AppContext } from '@blackbox/application';
import { runShopifyImport } from './shopify-job.js';

function secret(fileEnv: string, inlineEnv: string): string { const f = process.env[fileEnv]; if (f) return readFileSync(f, 'utf8').trim(); const v = process.env[inlineEnv]; if (!v) throw new Error(`missing ${fileEnv}/${inlineEnv}`); return v; }
const version = process.env.SERVICE_VERSION ?? '0.1.0-dev'; const logDir = process.env.LOG_DIR ?? '/var/blackbox/logs';
const debugState = { base: 'INFO' as Level, debugConnections: new Set<string>(), debugAll: false };
const sink = new FileStoreSink({ dir: logDir, component: 'worker' });
const log = new Logger({ component: 'worker', serviceVersion: version, sinks: [sink, new StderrSink('WARN')], levelProvider: () => debugState });
const db = createDb({ url: secret('WORKER_DATABASE_URL_FILE', 'WORKER_DATABASE_URL'), max: 6, applicationName: 'blackbox-worker' });
const keyring = DataKeyring.fromFiles([{ version: 1, path: process.env.DATA_KEY_FILE ?? '/run/secrets/data_key' }], 1);
const engine = new EngineClient(process.env.ENGINE_URL ?? 'http://engine:7000', secret('ENGINE_TOKEN_FILE', 'ENGINE_TOKEN'));
const ctx: AppContext = { db, log, engine, keyring, version, origin: process.env.PUBLIC_ORIGIN ?? 'http://127.0.0.1:19080', logDir, dataDir: process.env.DATA_DIR ?? '/var/blackbox/data', now: () => new Date() };
const sources = new SourcesService(ctx); const ingest = new IngestService(db, log); const queue = new JobQueue(db);
let stopping = false;
process.on('SIGTERM', () => { stopping = true; }); process.on('SIGINT', () => { stopping = true; });
log.info('worker.started', 'worker loop starting', { action_code: 'ready' });

async function refreshDebug() { try { const rows = await withScope(db, 'scheduler', (tx) => tx`SELECT component, connection_id FROM debug_windows WHERE stopped_at IS NULL AND expires_at > now()`); debugState.debugAll = rows.some((r) => r.component === 'worker' && !r.connection_id); debugState.debugConnections = new Set(rows.filter((r) => r.component === 'worker' && r.connection_id).map((r) => r.connection_id as string)); } catch { /* keep */ } }

/** Due polls: every active polling capability whose next_poll_at has passed gets one singleton import job (coalesced, never a burst). */
async function schedulePolls() {
  const due = await withScope(db, 'scheduler', (tx) => tx`SELECT k.tenant_id, k.connection_id, c.provider FROM capability_state k JOIN connections c ON c.connection_id = k.connection_id WHERE c.status = 'configured' AND c.provider IN ('shopify','shopify_payments') AND k.next_poll_at IS NOT NULL AND k.next_poll_at <= now() GROUP BY k.tenant_id, k.connection_id, c.provider`);
  for (const d of due) await queue.enqueue('source.import', { connection_id: d.connection_id, run_kind: 'incremental' }, { tenantId: d.tenant_id as string, singletonKey: `import:${d.connection_id}` });
}
async function tick() {
  await queue.heartbeat('worker', { version, debug: debugState.debugAll });
  await refreshDebug();
  await schedulePolls();
  const job = await queue.claim(['source.import', 'review.retry', 'backup.scheduled', 'retention.enforce'], 300);
  if (!job) return false;
  const started = Date.now();
  try {
    if (job.kind === 'source.import' && job.tenant_id) { await runShopifyImport({ ctx, sources, ingest }, job.tenant_id, String(job.payload.connection_id), (job.payload.run_kind as string) ?? 'incremental', job.attempt); await queue.complete(job.job_id); }
    else if (job.kind === 'review.retry' && job.tenant_id) { await withTenant(db, job.tenant_id, (tx) => tx`UPDATE review_cases SET history = history || ${tx.json([{ at: new Date().toISOString(), actor: 'worker', action: 'retry_executed', detail: 'original accepted input re-evaluated; no new payment fabricated' }])}, updated_at = now() WHERE case_id = ${String(job.payload.case_id)} AND tenant_id = ${job.tenant_id}`); await queue.complete(job.job_id); }
    else if (job.kind === 'backup.scheduled') { const { runScheduledBackupCheck } = await import('./backup-job.js'); const next = await runScheduledBackupCheck(ctx); await queue.complete(job.job_id, next); }
    else await queue.complete(job.job_id);
    log.info('job.completed', `job ${job.kind} completed`, { tenant_id: job.tenant_id ?? undefined, operation_id: job.job_id, duration_ms: Date.now() - started, attempt: job.attempt });
  } catch (err) {
    const e = err as Error & { code?: string; retryAfterMs?: number | null; retryable?: boolean };
    const code = e.code ?? 'job_failed'; const retryable = e.retryable ?? true;
    const r = retryable ? await queue.fail(job, code, e.retryAfterMs ?? undefined) : await queue.fail({ ...job, attempt: job.max_attempts }, code);
    log[r.dead ? 'error' : 'warn']('job.failed', `job ${job.kind} failed: ${e.message?.slice(0, 160)}`, { tenant_id: job.tenant_id ?? undefined, operation_id: job.job_id, error_code: code, retryable: !r.dead, next_retry_at: r.nextRunAt?.toISOString(), attempt: job.attempt, duration_ms: Date.now() - started });
  }
  return true;
}
// ensure the backup scheduler job exists (it decides itself whether a backup is configured/due)
await queue.enqueue('backup.scheduled', {}, { singletonKey: 'backup:scheduler', runAt: new Date(Date.now() + 15_000) });
while (!stopping) { let worked = false; try { worked = await tick(); } catch (err) { log.error('worker.tick_failed', (err as Error).message.slice(0, 200), { error_code: 'tick_failed', retryable: true }); await new Promise((r) => setTimeout(r, 2000)); } if (!worked) await new Promise((r) => setTimeout(r, 1500)); }
log.info('worker.stopped', 'worker stopped cleanly; cursors and journal preserved'); sink.close(); await db.end({ timeout: 3 }); process.exit(0);

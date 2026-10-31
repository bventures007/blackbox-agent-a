import { createHash } from 'node:crypto';
import { queryLogs, storeUsage } from '@blackbox/logging';
import type { LogRecord } from '@blackbox/contracts';
import { opsStatus } from './routes/diagnostics.js';
import type { Services } from './app.js';

const CAP = 10 * 1024 * 1024;

/** Explicit, local diagnostics bundle: allowlisted versions/runtime/health/error counts/excerpts, pseudonymized ids, capped at 10 MiB. */
export async function buildExportBundle(s: Services, tenantId: string, since: Date, opts: { preview: boolean; categories?: Set<string> }) {
  const cats = opts.categories ?? new Set(['versions', 'health', 'errors', 'logs', 'config']);
  const salt = createHash('sha256').update(`${tenantId}|${since.toISOString()}|${Date.now()}`).digest('hex').slice(0, 16);
  const pseud = (v: string | null | undefined) => (v ? 'p_' + createHash('sha256').update(salt + v).digest('hex').slice(0, 12) : v ?? null);
  const bundle: Record<string, unknown> = { bundle_version: 1, generated_at: new Date().toISOString(), range: { since: since.toISOString(), until: new Date().toISOString() }, categories: [...cats], notice: 'Identifiers are pseudonymized consistently within this bundle. No business content, credentials, paths or personal data are included.' };
  const unavailable: string[] = [];
  if (cats.has('versions')) bundle.versions = { app: s.config.version, schema_version: 1, reducer_version: 'r1', node: process.version.split('.')[0], platform: process.platform, arch: process.arch };
  if (cats.has('config')) bundle.config = { locale_default: 'en', mcp_http_enabled: s.config.mcpHttpEnabled, log_retention: 'see diagnostics/retention', bind: 'loopback-only' };
  if (cats.has('health')) { try { const h = await s.health.overview(tenantId); bundle.health = { observed_at: h.observed_at, cards: h.cards.map((c) => ({ area: c.area, state: c.state, reason: c.reason, observed_at: c.observed_at, detail: scrubDetail(c.detail) })) }; bundle.ops = await opsStatus(s, tenantId).then((o) => ({ backup: { configured: o.backup.configured, recoverable_age_hours: o.backup.recoverable_age_hours, overdue: o.backup.overdue }, maintenance: o.maintenance ? { phase: o.maintenance.phase } : null, storage: o.storage ? { state: o.storage.state } : null, unresolved_review_cases: o.unresolved_review_cases })); } catch (e) { unavailable.push('health: ' + (e as Error).message.slice(0, 80)); } }
  let logRecords: LogRecord[] = [];
  if (cats.has('errors') || cats.has('logs')) {
    const page = queryLogs(s.config.logDir, { since, levels: new Set(['WARN', 'ERROR']), tenantId, includeInstallation: true, pageSize: 1000 });
    logRecords = page.records;
    if (cats.has('errors')) { const counts: Record<string, number> = {}; for (const r of logRecords) { const k = `${r.level}:${r.component}:${r.error_code ?? r.event_name}`; counts[k] = (counts[k] ?? 0) + 1; } bundle.error_counts = counts; }
    if (cats.has('logs')) bundle.log_excerpts = logRecords.slice(0, 500).map((r) => ({ occurred_at: r.occurred_at, level: r.level, component: r.component, event_name: r.event_name, message: r.message, error_code: r.error_code ?? null, retryable: r.retryable ?? null, connection: pseud(r.connection_id), run: pseud(r.run_id), trace: pseud(r.trace_id), duration_ms: r.duration_ms ?? null, record_count: r.record_count ?? null }));
    bundle.log_store = storeUsage(s.config.logDir);
  }
  if (unavailable.length) bundle.unavailable_sections = unavailable;
  let json = JSON.stringify(bundle); let truncated = false;
  while (Buffer.byteLength(json) > CAP && Array.isArray(bundle.log_excerpts) && (bundle.log_excerpts as unknown[]).length > 0) { (bundle.log_excerpts as unknown[]).splice(Math.floor((bundle.log_excerpts as unknown[]).length / 2)); truncated = true; json = JSON.stringify(bundle); }
  bundle.truncated = truncated; bundle.size_bytes = Buffer.byteLength(JSON.stringify(bundle));
  if (opts.preview) return { preview: true, categories: [...cats], estimated_size_bytes: bundle.size_bytes, record_count: logRecords.length, truncated, unavailable_sections: unavailable, range: bundle.range };
  return bundle;
}
function scrubDetail(d: Record<string, unknown>) { const out: Record<string, unknown> = {}; for (const [k, v] of Object.entries(d)) { if (/path|host|user|dir|url/i.test(k)) continue; if (typeof v === 'number' || typeof v === 'boolean' || v === null) out[k] = v; else if (typeof v === 'string' && v.length < 80 && !/\//.test(v)) out[k] = v; } return out; }

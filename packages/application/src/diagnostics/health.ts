import { statSync } from 'node:fs';
import { withScope, withTenant } from '@blackbox/database';
import { storeUsage, DEFAULT_RETENTION } from '@blackbox/logging';
import type { AppContext } from '../context.js';
import { EngineUnavailable } from '../query/engine-client.js';

export type HealthState = 'healthy' | 'working' | 'degraded' | 'unavailable' | 'unknown';
export interface HealthCard { area: string; state: HealthState; observed_at: string; reason: string; next_action: string | null; detail: Record<string, unknown> }

export const STALE_AFTER_SECONDS = 30; // UI treats observations older than this as stale/disconnected
export const WORKER_HEARTBEAT_STALE_SECONDS = 45;

/** Measured, not inferred: every card is a probe or durable operational state with its observation time (DIAG-02). */
export class HealthService {
  private started = Date.now();
  constructor(private readonly ctx: AppContext) {}

  async overview(tenantId: string | null): Promise<{ observed_at: string; cards: HealthCard[]; thresholds: Record<string, unknown> }> {
    const now = this.ctx.now(); const iso = now.toISOString();
    const cards: HealthCard[] = [];
    // API
    cards.push({ area: 'api', state: 'healthy', observed_at: iso, reason: 'request served', next_action: null, detail: { version: this.ctx.version, uptime_seconds: Math.round((Date.now() - this.started) / 1000) } });
    // PostgreSQL: actual read and write probes with the runtime role
    let dbCard: HealthCard;
    const t0 = Date.now();
    try {
      const rw = await withScope(this.ctx.db, 'scheduler', async (tx) => { await tx`SELECT 1`; await tx`INSERT INTO settings (tenant_id, scope, key, value) VALUES ('00000000-0000-0000-0000-000000000000', 'installation', 'probe:api', ${tx.json({ at: iso } as never)}) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`; return true; });
      dbCard = { area: 'postgres', state: rw ? 'healthy' : 'degraded', observed_at: iso, reason: 'read and write probes succeeded', next_action: null, detail: { probe_ms: Date.now() - t0 } };
    } catch (err) { dbCard = { area: 'postgres', state: 'unavailable', observed_at: iso, reason: 'probe failed: ' + ((err as Error).message ?? 'error').slice(0, 120), next_action: 'check the database container: ./blackbox status', detail: { probe_ms: Date.now() - t0 } }; }
    cards.push(dbCard);
    // Worker heartbeat + queue
    try {
      const hb = await withScope(this.ctx.db, 'scheduler', async (tx) => (await tx`SELECT value, updated_at FROM settings WHERE scope = 'installation' AND key = 'heartbeat:worker' AND tenant_id = '00000000-0000-0000-0000-000000000000'`)[0]);
      const q = await withScope(this.ctx.db, 'scheduler', async (tx) => (await tx`SELECT state, count(*)::int AS n, min(run_at) FILTER (WHERE state IN ('queued','running')) AS oldest FROM jobs GROUP BY state`));
      const counts: Record<string, number> = {}; let oldest: string | null = null; for (const r of q) { counts[r.state as string] = Number(r.n); if (r.oldest) oldest = new Date(r.oldest as string).toISOString(); }
      const age = hb ? (now.getTime() - new Date(hb.updated_at as string).getTime()) / 1000 : null;
      const state: HealthState = age === null ? 'unavailable' : age > WORKER_HEARTBEAT_STALE_SECONDS ? 'degraded' : (counts.running ?? 0) > 0 ? 'working' : 'healthy';
      const oldestAge = oldest ? Math.max(0, (now.getTime() - new Date(oldest).getTime()) / 1000) : 0;
      cards.push({ area: 'worker', state: oldestAge > 600 && state === 'healthy' ? 'degraded' : state, observed_at: hb ? new Date(hb.updated_at as string).toISOString() : iso, reason: age === null ? 'no worker heartbeat recorded' : age > WORKER_HEARTBEAT_STALE_SECONDS ? `heartbeat ${Math.round(age)} s old` : 'heartbeat current', next_action: age === null || age > WORKER_HEARTBEAT_STALE_SECONDS ? 'restart the worker: ./blackbox up' : null, detail: { heartbeat_age_seconds: age, queued: counts.queued ?? 0, running: counts.running ?? 0, failed: counts.failed ?? 0, dead: counts.dead ?? 0, oldest_pending_at: oldest, oldest_pending_age_seconds: oldestAge, worker: (hb?.value as Record<string, unknown>) ?? null } });
    } catch (err) { cards.push({ area: 'worker', state: 'unknown', observed_at: iso, reason: 'could not read heartbeat: ' + (err as Error).message.slice(0, 80), next_action: null, detail: {} }); }
    // Engine
    try {
      const h = await this.ctx.engine.health();
      const tenants = (h.tenants as Array<Record<string, unknown>>) ?? [];
      const mine = tenantId ? tenants.find((t) => t.tenant_id === tenantId) : null;
      const lagEntries = Number(mine?.lag_entries ?? 0); const phase = String(mine?.phase ?? (tenants.length ? 'current' : 'unknown'));
      const state: HealthState = h.status !== 'healthy' ? 'degraded' : phase === 'rebuilding' || phase === 'catching_up' ? 'working' : mine?.last_error ? 'degraded' : 'healthy';
      cards.push({ area: 'engine', state, observed_at: String(h.observed_at ?? iso), reason: phase === 'current' ? 'projections current with the committed journal' : `engine ${phase}`, next_action: mine?.last_error ? `engine error ${mine.last_error}; see logs` : null, detail: { version: h.version, uptime_seconds: h.uptime_seconds, database: h.database, phase, applied_cursor: mine?.applied_cursor ?? null, committed_cursor: mine?.committed_cursor ?? null, lag_entries: lagEntries, lag_ms: mine?.lag_ms ?? null, resident_entities: mine?.resident_entities ?? null, snapshot_sequence: mine?.snapshot_sequence ?? null, rss_bytes: h.rss_bytes, resident_bytes_total: h.resident_bytes_total, log_dropped: h.log_dropped, debug_active: h.debug_active } });
    } catch (err) { cards.push({ area: 'engine', state: 'unavailable', observed_at: iso, reason: err instanceof EngineUnavailable ? 'engine not reachable' : (err as Error).message.slice(0, 120), next_action: 'check the engine container: ./blackbox logs --component engine', detail: {} }); }
    // Sources (shared state)
    if (tenantId) {
      try {
        const caps = await withTenant(this.ctx.db, tenantId, (tx) => tx`SELECT c.provider, c.display_name, c.status, k.* FROM capability_state k JOIN connections c ON c.connection_id = k.connection_id WHERE k.tenant_id = ${tenantId}`);
        const { SourcesService } = await import('../sources/service.js'); const svc = new SourcesService(this.ctx);
        const views = caps.map((k) => ({ provider: k.provider, display_name: k.display_name, ...svc.capabilityView(k.provider as string, k as Record<string, unknown>, now) }));
        const err = views.filter((v) => v.health === 'error').length; const delayed = views.filter((v) => v.health === 'delayed').length; const importing = views.filter((v) => v.health === 'importing').length;
        const state: HealthState = views.length === 0 ? 'unknown' : err ? 'degraded' : delayed ? 'degraded' : importing ? 'working' : 'healthy';
        cards.push({ area: 'sources', state, observed_at: iso, reason: views.length === 0 ? 'no sources connected' : err ? `${err} capabilities in error` : delayed ? `${delayed} capabilities delayed past their schedule` : importing ? `${importing} capabilities importing` : 'all capabilities within schedule', next_action: err || delayed ? 'open Sources to inspect the affected connection' : null, detail: { capabilities: views.length, error: err, delayed, importing, last_successful_sync_at: views.map((v) => v.last_successful_sync_at).filter(Boolean).sort().at(-1) ?? null, last_new_record_at: views.map((v) => v.last_new_record_at).filter(Boolean).sort().at(-1) ?? null } });
      } catch (err) { cards.push({ area: 'sources', state: 'unknown', observed_at: iso, reason: (err as Error).message.slice(0, 120), next_action: null, detail: {} }); }
    }
    // MCP: last actual authorized agent request (never "connected" from configuration alone)
    try {
      const last = tenantId ? await withTenant(this.ctx.db, tenantId, async (tx) => (await tx`SELECT max(last_used_at) AS at, count(*) FILTER (WHERE status = 'active')::int AS active FROM principals WHERE tenant_id = ${tenantId} AND kind = 'agent'`)[0]) : null;
      const at = last?.at ? new Date(last.at as string).toISOString() : null;
      cards.push({ area: 'mcp', state: at ? 'healthy' : 'unknown', observed_at: iso, reason: at ? 'last authorized agent request recorded' : 'no agent has connected yet (configured keys are not connections)', next_action: at ? null : 'connect a local MCP client with an agent key', detail: { active_agent_keys: Number(last?.active ?? 0), last_agent_request_at: at } });
    } catch { cards.push({ area: 'mcp', state: 'unknown', observed_at: iso, reason: 'could not read agent usage', next_action: null, detail: {} }); }
    // Diagnostics store
    try {
      const usage = storeUsage(this.ctx.logDir); let diskFree: number | null = null; try { statSync(this.ctx.logDir); } catch { /* missing */ }
      const debug = await withScope(this.ctx.db, 'scheduler', async (tx) => (await tx`SELECT component, connection_id, expires_at FROM debug_windows WHERE stopped_at IS NULL AND expires_at > now()`));
      const pct = usage.totalBytes / DEFAULT_RETENTION.maxTotalBytes;
      cards.push({ area: 'diagnostics', state: pct > 0.95 ? 'degraded' : 'healthy', observed_at: iso, reason: pct > 0.95 ? 'log store at its cap; oldest segments rotate' : 'collector writing within bounds', next_action: null, detail: { retained_bytes: usage.totalBytes, cap_bytes: DEFAULT_RETENTION.maxTotalBytes, retained_from_hour: usage.oldestHour, retained_to_hour: usage.newestHour, segments: usage.segments, dropped_records: this.ctx.log.dropped.count, active_debug_windows: debug.map((d) => ({ component: d.component, connection_id: d.connection_id, expires_at: new Date(d.expires_at as string).toISOString() })), disk_free_bytes: diskFree } });
    } catch (err) { cards.push({ area: 'diagnostics', state: 'unknown', observed_at: iso, reason: (err as Error).message.slice(0, 120), next_action: null, detail: {} }); }
    return { observed_at: iso, cards, thresholds: { stale_after_seconds: STALE_AFTER_SECONDS, worker_heartbeat_stale_seconds: WORKER_HEARTBEAT_STALE_SECONDS, refresh_interval_seconds: 5, oldest_pending_degraded_seconds: 600 } };
  }
}

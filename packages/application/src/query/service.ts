import { z } from 'zod';
import { QueryRequest, type ResultEnvelope } from '@blackbox/contracts';
import type { AppContext } from '../context.js';
import type { Principal } from '../auth/service.js';
import { JournalReader } from './journal.js';
import { EngineUnavailable } from './engine-client.js';
import { SourcesService } from '../sources/service.js';

export const QUERY_LIMITS = { default_page_rows: 100, maximum_page_rows: 500, synchronous_deadline_ms: 5000, per_agent: 8, per_workspace: 16, global: 32 } as const;

class Admission {
  private readonly perPrincipal = new Map<string, number>(); private readonly perTenant = new Map<string, number>(); private global = 0;
  acquire(principal: string, tenant: string): (() => void) | null {
    if (this.global >= QUERY_LIMITS.global || (this.perTenant.get(tenant) ?? 0) >= QUERY_LIMITS.per_workspace || (this.perPrincipal.get(principal) ?? 0) >= QUERY_LIMITS.per_agent) return null;
    this.global++; this.perTenant.set(tenant, (this.perTenant.get(tenant) ?? 0) + 1); this.perPrincipal.set(principal, (this.perPrincipal.get(principal) ?? 0) + 1);
    return () => { this.global--; this.perTenant.set(tenant, (this.perTenant.get(tenant) ?? 1) - 1); this.perPrincipal.set(principal, (this.perPrincipal.get(principal) ?? 1) - 1); };
  }
  snapshot() { return { global: this.global, tenants: Object.fromEntries(this.perTenant), principals: this.perPrincipal.size }; }
}

export class QueryRejected extends Error { constructor(public readonly code: 'admission' | 'unavailable' | 'invalid', message: string, public readonly retryAfterMs = 250) { super(message); this.name = 'QueryRejected'; } }

/** The one authorized query path used by UI, API and MCP. Authorization is the caller principal's tenant; nothing else. */
export class QueryService {
  readonly journal: JournalReader; readonly sources: SourcesService; private readonly admission = new Admission();
  constructor(private readonly ctx: AppContext) { this.journal = new JournalReader(ctx.db); this.sources = new SourcesService(ctx); }

  principalKey(p: Principal) { return p.kind === 'owner' ? `owner:${p.ownerId}` : `${p.kind}:${p.principalId}`; }

  async answer(p: Principal, raw: unknown): Promise<ResultEnvelope & Record<string, unknown>> {
    const req = QueryRequest.safeParse(raw);
    if (!req.success) throw new QueryRejected('invalid', 'invalid query: ' + req.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; '));
    const release = this.admission.acquire(this.principalKey(p), p.tenantId);
    if (!release) throw new QueryRejected('admission', 'concurrent query limit reached for this principal or workspace; retry shortly', 250);
    const started = Date.now();
    try {
      const { required, recordedCutoff } = await this.resolveConsistency(p.tenantId, req.data.consistency);
      let res: Record<string, unknown>;
      try {
        res = await this.ctx.engine.query({ tenant_id: p.tenantId, intent: req.data.intent, parameters: req.data.parameters, required_cursor: required, deadline_ms: Math.min(QUERY_LIMITS.synchronous_deadline_ms, 4000), page_size: req.data.pagination.page_size, cursor: req.data.pagination.cursor, now: this.ctx.now().toISOString(), principal: this.principalKey(p) });
      } catch (err) { if (err instanceof EngineUnavailable) throw new QueryRejected('unavailable', 'the query engine is unavailable; answers cannot be served from a cache', 1000); throw err; }
      const readiness = await this.sources.readinessFor(p.tenantId, (res.coverage as Array<{ capability: string; status: string }>) ?? []);
      const envelope = { ...res, intent: req.data.intent, effective_at: null, recorded_cutoff: recordedCutoff, required_cursor: required, readiness, timing_ms: Date.now() - started } as unknown as ResultEnvelope & Record<string, unknown>;
      this.ctx.log.info('query.answered', 'intent answered through the shared query service', { tenant_id: p.tenantId, operation_id: req.data.intent, duration_ms: Date.now() - started, applied_cursor: (res.applied_cursor as number | null) ?? null, committed_cursor: required, trace_id: this.principalKey(p) });
      return envelope;
    } finally { release(); }
  }

  async state(p: Principal, raw: unknown) {
    const schema = z.object({ entity_type: z.string(), entity_id: z.string().min(1).max(200), consistency: z.object({ mode: z.string(), cursor: z.number().int().optional(), recorded_cutoff: z.number().int().optional(), effective_at: z.string().optional() }).default({ mode: 'latest_committed' }) });
    const req = schema.safeParse(raw); if (!req.success) throw new QueryRejected('invalid', 'invalid state request');
    const release = this.admission.acquire(this.principalKey(p), p.tenantId); if (!release) throw new QueryRejected('admission', 'concurrent query limit reached', 250);
    try {
      const { required, recordedCutoff } = await this.resolveConsistency(p.tenantId, req.data.consistency as never);
      const asOf = req.data.consistency.mode === 'as_of';
      try {
        const res = await this.ctx.engine.state({ tenant_id: p.tenantId, entity_type: req.data.entity_type, entity_id: req.data.entity_id, required_cursor: required, deadline_ms: 3000, recorded_cutoff: asOf ? req.data.consistency.recorded_cutoff : undefined, effective_at: asOf ? req.data.consistency.effective_at : undefined });
        return { ...res, recorded_cutoff: recordedCutoff, required_cursor: required };
      } catch (err) { if (err instanceof EngineUnavailable) throw new QueryRejected('unavailable', 'engine unavailable', 1000); throw err; }
    } finally { release(); }
  }

  private async resolveConsistency(tenantId: string, c: { mode: string; cursor?: number; recorded_cutoff?: number }): Promise<{ required: number | null; recordedCutoff: number | null }> {
    switch (c.mode) {
      case 'latest_committed': { const hwm = await this.journal.highWaterMark(tenantId); return { required: hwm, recordedCutoff: hwm }; }
      case 'at_least_cursor': return { required: c.cursor ?? 0, recordedCutoff: c.cursor ?? null };
      case 'as_of': return { required: c.recorded_cutoff ?? null, recordedCutoff: c.recorded_cutoff ?? null };
      case 'stale_allowed': return { required: null, recordedCutoff: null };
      default: throw new QueryRejected('invalid', 'unknown consistency mode');
    }
  }
  admissionSnapshot() { return this.admission.snapshot(); }
}

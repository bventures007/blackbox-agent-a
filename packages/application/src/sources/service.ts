import { randomUUID } from 'node:crypto';
import { withTenant } from '@blackbox/database';
import type { AppContext } from '../context.js';
import { resolvePlan, type Preset } from './import-plan.js';

export type Provider = 'shopify' | 'shopify_payments' | 'replay' | 'generic' | 'bank_csv' | 'policy' | 'runtime';
export const PILOT_PROVIDERS: Provider[] = ['shopify', 'shopify_payments', 'replay', 'generic', 'bank_csv', 'policy', 'runtime'];
export const PLANNED_PROVIDERS = ['shopware', 'woocommerce', 'email', 'lexware', 'sevdesk', 'billbee', 'sufio', 'stripe', 'paypal', 'mollie', 'easybill', 'dhl', 'dpd', 'ups', 'klaviyo'];

/** Capability schedules in seconds: default poll interval and the lag after which a capability is considered delayed. */
export const CAPABILITY_SCHEDULE: Record<string, { poll: number | null; delayed_after: number; reconcile: number | null; kind: 'polling' | 'import' | 'internal' | 'push' }> = {
  'shopify.orders': { poll: 300, delayed_after: 900, reconcile: 86400, kind: 'polling' }, 'shopify.payments': { poll: 300, delayed_after: 900, reconcile: 86400, kind: 'polling' },
  'shopify.fulfillments': { poll: 300, delayed_after: 900, reconcile: 86400, kind: 'polling' }, 'shopify.refunds': { poll: 300, delayed_after: 900, reconcile: 86400, kind: 'polling' },
  'shopify.returns': { poll: 600, delayed_after: 1800, reconcile: 86400, kind: 'polling' }, 'shopify.stock': { poll: 900, delayed_after: 2700, reconcile: 86400, kind: 'polling' },
  'shopify.allocations': { poll: 900, delayed_after: 2700, reconcile: 86400, kind: 'polling' }, 'shopify.receipts': { poll: 900, delayed_after: 2700, reconcile: 86400, kind: 'polling' },
  'shopify_payments.provider_ledger': { poll: 900, delayed_after: 2700, reconcile: 86400, kind: 'polling' }, 'shopify_payments.payouts': { poll: 900, delayed_after: 2700, reconcile: 86400, kind: 'polling' },
  'shopify_payments.positions': { poll: 900, delayed_after: 2700, reconcile: null, kind: 'polling' }, 'shopify_payments.disputes': { poll: 1800, delayed_after: 5400, reconcile: 86400, kind: 'polling' },
  'shopify_payments.refunds': { poll: 900, delayed_after: 2700, reconcile: 86400, kind: 'polling' }, 'shopify_payments.holds': { poll: 1800, delayed_after: 5400, reconcile: null, kind: 'polling' },
  'bank_csv.bank': { poll: null, delayed_after: 0, reconcile: null, kind: 'import' }, 'replay.*': { poll: null, delayed_after: 0, reconcile: null, kind: 'internal' },
  'generic.*': { poll: null, delayed_after: 0, reconcile: null, kind: 'push' }, 'policy.policy': { poll: null, delayed_after: 0, reconcile: null, kind: 'internal' }, 'runtime.*': { poll: null, delayed_after: 0, reconcile: null, kind: 'internal' },
};
export function scheduleFor(provider: string, capability: string) { return CAPABILITY_SCHEDULE[`${provider}.${capability}`] ?? CAPABILITY_SCHEDULE[`${provider}.*`] ?? { poll: null, delayed_after: 0, reconcile: null, kind: 'internal' as const }; }

export interface ConnectionView { connection_id: string; provider: string; display_name: string; account_namespace: string; status: string; config_public: Record<string, unknown>; created_at: string; updated_at: string; capabilities: Array<Record<string, unknown>>; health: string; plan: Record<string, unknown> | null; last_run: Record<string, unknown> | null }

export class SourcesService {
  constructor(private readonly ctx: AppContext) {}

  async createConnection(tenantId: string, ownerId: string, input: { provider: Provider; display_name: string; account_namespace: string; secret?: string; config_public?: Record<string, unknown>; capabilities: string[] }): Promise<string> {
    if (!PILOT_PROVIDERS.includes(input.provider)) throw new Error('provider is planned, not implemented in this pilot');
    const connectionId = randomUUID();
    const enc = input.secret ? this.ctx.keyring.encrypt(input.secret, tenantId, `connection:${connectionId}`) : null;
    await withTenant(this.ctx.db, tenantId, async (tx) => {
      await tx`INSERT INTO connections (connection_id, tenant_id, provider, display_name, account_namespace, status, config_encrypted, config_public) VALUES (${connectionId}, ${tenantId}, ${input.provider}, ${input.display_name.slice(0, 80)}, ${input.account_namespace.slice(0, 200)}, 'configured', ${enc}, ${tx.json((input.config_public ?? {}) as never)})`;
      for (const cap of input.capabilities) { const s = scheduleFor(input.provider, cap); await tx`INSERT INTO capability_state (tenant_id, connection_id, capability, collection_state, next_poll_at, next_poll_reason) VALUES (${tenantId}, ${connectionId}, ${cap}, 'configured', ${s.poll ? new Date() : null}, ${s.poll ? 'initial import pending' : `${s.kind} capability: no scheduled poll`})`; }
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'connection.created', ${tx.json({ connection_id: connectionId, provider: input.provider })})`;
    });
    this.ctx.log.info('source.connection_created', 'source connection configured', { tenant_id: tenantId, connection_id: connectionId });
    return connectionId;
  }
  async secret(tenantId: string, connectionId: string): Promise<string | null> {
    return withTenant(this.ctx.db, tenantId, async (tx) => { const [c] = await tx`SELECT config_encrypted FROM connections WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId}`; return c?.config_encrypted ? this.ctx.keyring.decrypt(c.config_encrypted as string, tenantId, `connection:${connectionId}`) : null; });
  }
  async setStatus(tenantId: string, connectionId: string, status: string, ownerId?: string): Promise<void> {
    await withTenant(this.ctx.db, tenantId, async (tx) => { await tx`UPDATE connections SET status = ${status}, updated_at = now() WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId}`; if (ownerId) await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'connection.status', ${tx.json({ connection_id: connectionId, status })})`; });
  }
  async savePlan(tenantId: string, actorId: string, connectionId: string, preset: Preset, opts: { customStart?: string; includeOpenItems?: boolean; includeRelated?: boolean; includeOpeningState?: boolean; capabilityScope?: string[]; restrictions?: unknown[] } = {}) {
    const tz = await withTenant(this.ctx.db, tenantId, async (tx) => (await tx`SELECT timezone FROM tenants WHERE tenant_id = ${tenantId}`)[0]?.timezone as string) ?? 'UTC';
    const plan = resolvePlan(preset, tz, this.ctx.now(), opts);
    const planId = randomUUID();
    await withTenant(this.ctx.db, tenantId, async (tx) => {
      const [prev] = await tx`SELECT plan_id, max(plan_revision) AS rev FROM import_plans WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId} GROUP BY plan_id ORDER BY rev DESC LIMIT 1`;
      const id = (prev?.plan_id as string | undefined) ?? planId; const rev = Number(prev?.rev ?? 0) + 1;
      await tx`INSERT INTO import_plans (plan_id, plan_revision, tenant_id, connection_id, preset, timezone, requested_from, initial_cutoff, include_open_items, include_related, include_opening_state, strict_from_now, capability_scope, restrictions, actor_id)
        VALUES (${id}, ${rev}, ${tenantId}, ${connectionId}, ${plan.preset}, ${plan.timezone}, ${plan.requested_from}, ${plan.initial_cutoff}, ${plan.include_open_items}, ${plan.include_related}, ${plan.include_opening_state}, ${plan.strict_from_now}, ${tx.json((opts.capabilityScope ?? []) as never)}, ${tx.json((opts.restrictions ?? []) as never)}, ${actorId})`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${actorId}, 'import_plan.saved', ${tx.json({ connection_id: connectionId, plan_id: id, revision: rev, preset })})`;
    });
    return plan;
  }
  async currentPlan(tenantId: string, connectionId: string) {
    return withTenant(this.ctx.db, tenantId, async (tx) => (await tx`SELECT * FROM import_plans WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId} ORDER BY plan_revision DESC LIMIT 1`)[0] ?? null);
  }
  async startRun(tenantId: string, connectionId: string, runKind: 'initial' | 'history_expansion' | 'incremental' | 'reconciliation' | 'import', scope: Record<string, unknown> = {}): Promise<string> {
    const runId = randomUUID();
    await withTenant(this.ctx.db, tenantId, async (tx) => {
      const plan = (await tx`SELECT plan_id, plan_revision FROM import_plans WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId} ORDER BY plan_revision DESC LIMIT 1`)[0];
      await tx`INSERT INTO import_runs (run_id, tenant_id, connection_id, plan_id, plan_revision, run_kind, state, phase, started_at, scope) VALUES (${runId}, ${tenantId}, ${connectionId}, ${plan?.plan_id ?? null}, ${plan?.plan_revision ?? null}, ${runKind}, 'running', 'check_connection', now(), ${tx.json(scope as never)})`;
    });
    return runId;
  }
  async updateRun(tenantId: string, runId: string, patch: { state?: string; phase?: string; counters?: Record<string, unknown>; cursor?: unknown; error?: { code: string; message: string; retryable: boolean }; outcome?: string; next_action?: string; attempt?: number }): Promise<void> {
    await withTenant(this.ctx.db, tenantId, async (tx) => {
      const [cur] = await tx`SELECT counters, errors FROM import_runs WHERE run_id = ${runId} AND tenant_id = ${tenantId}`;
      const counters = { ...((cur?.counters as Record<string, unknown>) ?? {}), ...(patch.counters ?? {}) };
      const errors = [...(((cur?.errors as unknown[]) ?? [])), ...(patch.error ? [{ ...patch.error, at: new Date().toISOString() }] : [])].slice(-20);
      const done = patch.state === 'complete' || patch.state === 'failed' || patch.state === 'canceled' || patch.state === 'complete_with_gaps';
      await tx`UPDATE import_runs SET state = COALESCE(${patch.state ?? null}, state), phase = COALESCE(${patch.phase ?? null}, phase), counters = ${tx.json(counters as never)}, errors = ${tx.json(errors as never)}, cursor = COALESCE(${patch.cursor === undefined ? null : tx.json(patch.cursor as never)}, cursor), outcome = COALESCE(${patch.outcome ?? null}, outcome), next_action = COALESCE(${patch.next_action ?? null}, next_action), attempt = COALESCE(${patch.attempt ?? null}, attempt), updated_at = now(), completed_at = CASE WHEN ${done} THEN now() ELSE completed_at END WHERE run_id = ${runId} AND tenant_id = ${tenantId}`;
    });
  }
  async touchCapability(tenantId: string, connectionId: string, capability: string, patch: Record<string, unknown>): Promise<void> {
    await withTenant(this.ctx.db, tenantId, async (tx) => {
      const [cur] = await tx`SELECT coverage, retry_state, restrictions FROM capability_state WHERE connection_id = ${connectionId} AND capability = ${capability} AND tenant_id = ${tenantId}`;
      const coverage = { ...((cur?.coverage as Record<string, unknown>) ?? {}), ...((patch.coverage as Record<string, unknown>) ?? {}) };
      const retry = patch.retry_state !== undefined ? patch.retry_state : (cur?.retry_state ?? {});
      const restrictions = patch.restrictions !== undefined ? patch.restrictions : (cur?.restrictions ?? []);
      await tx`INSERT INTO capability_state (tenant_id, connection_id, capability) VALUES (${tenantId}, ${connectionId}, ${capability}) ON CONFLICT DO NOTHING`;
      await tx`UPDATE capability_state SET
        collection_state = COALESCE(${(patch.collection_state as string) ?? null}, collection_state), cursor = COALESCE(${patch.cursor === undefined ? null : tx.json(patch.cursor as never)}, cursor),
        last_attempt_at = COALESCE(${(patch.last_attempt_at as Date) ?? null}, last_attempt_at), last_successful_sync_at = COALESCE(${(patch.last_successful_sync_at as Date) ?? null}, last_successful_sync_at),
        last_import_completed_at = COALESCE(${(patch.last_import_completed_at as Date) ?? null}, last_import_completed_at), last_import_outcome = COALESCE(${(patch.last_import_outcome as string) ?? null}, last_import_outcome),
        last_reconciliation_at = COALESCE(${(patch.last_reconciliation_at as Date) ?? null}, last_reconciliation_at), last_received_at = COALESCE(${(patch.last_received_at as Date) ?? null}, last_received_at),
        last_new_record_at = COALESCE(${(patch.last_new_record_at as Date) ?? null}, last_new_record_at), last_journal_commit_at = COALESCE(${(patch.last_journal_commit_at as Date) ?? null}, last_journal_commit_at),
        next_poll_at = CASE WHEN ${patch.next_poll_at !== undefined} THEN ${(patch.next_poll_at as Date | null) ?? null} ELSE next_poll_at END, next_poll_reason = COALESCE(${(patch.next_poll_reason as string) ?? null}, next_poll_reason),
        retry_state = ${tx.json(retry as never)}, pending_count = COALESCE(${(patch.pending_count as number) ?? null}, pending_count), failed_count = COALESCE(${(patch.failed_count as number) ?? null}, failed_count), quarantined_count = COALESCE(${(patch.quarantined_count as number) ?? null}, quarantined_count),
        coverage = ${tx.json(coverage as never)}, restrictions = ${tx.json(restrictions as never)}, updated_at = now() WHERE connection_id = ${connectionId} AND capability = ${capability} AND tenant_id = ${tenantId}`;
    });
  }
  async list(tenantId: string): Promise<ConnectionView[]> {
    return withTenant(this.ctx.db, tenantId, async (tx) => {
      const conns = await tx`SELECT connection_id, provider, display_name, account_namespace, status, config_public, created_at, updated_at FROM connections WHERE tenant_id = ${tenantId} ORDER BY created_at`;
      const caps = await tx`SELECT * FROM capability_state WHERE tenant_id = ${tenantId}`;
      const plans = await tx`SELECT DISTINCT ON (connection_id) * FROM import_plans WHERE tenant_id = ${tenantId} ORDER BY connection_id, plan_revision DESC`;
      const runs = await tx`SELECT DISTINCT ON (connection_id) run_id, connection_id, run_kind, state, phase, started_at, updated_at, completed_at, counters, errors, outcome, next_action, attempt FROM import_runs WHERE tenant_id = ${tenantId} ORDER BY connection_id, updated_at DESC`;
      const now = this.ctx.now();
      return conns.map((c) => {
        const cc = caps.filter((k) => k.connection_id === c.connection_id).map((k) => this.capabilityView(c.provider as string, k as Record<string, unknown>, now));
        const health = cc.some((k) => k.health === 'error') ? 'error' : cc.some((k) => k.health === 'delayed') ? 'delayed' : cc.some((k) => k.health === 'paused') ? 'paused' : cc.length && cc.every((k) => k.health === 'configured') ? 'configured' : cc.some((k) => k.health === 'importing') ? 'importing' : 'current';
        const run = runs.find((r) => r.connection_id === c.connection_id);
        return { connection_id: c.connection_id as string, provider: c.provider as string, display_name: c.display_name as string, account_namespace: c.account_namespace as string, status: c.status as string, config_public: c.config_public as Record<string, unknown>, created_at: new Date(c.created_at as string).toISOString(), updated_at: new Date(c.updated_at as string).toISOString(), capabilities: cc, health: c.status === 'paused' || c.status === 'disconnected' ? c.status as string : health, plan: (plans.find((p) => p.connection_id === c.connection_id) as Record<string, unknown> | undefined) ?? null, last_run: (run as Record<string, unknown> | undefined) ?? null };
      });
    });
  }
  capabilityView(provider: string, k: Record<string, unknown>, now: Date) {
    const s = scheduleFor(provider, k.capability as string);
    const lastOk = k.last_successful_sync_at ? new Date(k.last_successful_sync_at as string) : null;
    const retry = (k.retry_state as Record<string, unknown>) ?? {};
    let health: string = k.collection_state === 'configured' ? 'configured' : 'current';
    if (k.collection_state === 'backfilling' || k.collection_state === 'validating') health = 'importing';
    if (k.collection_state === 'paused') health = 'paused';
    if (k.collection_state === 'blocked' || k.collection_state === 'reauthorization_required') health = 'error';
    else if (s.poll && lastOk && (now.getTime() - lastOk.getTime()) / 1000 > s.delayed_after) health = 'delayed';
    else if (s.poll && !lastOk && k.collection_state !== 'configured') health = 'delayed';
    if (retry.error_code && Number(retry.consecutive_failures ?? 0) >= 3) health = 'error';
    return { capability: k.capability, mode: k.mode, collection_state: k.collection_state, schedule: s, health, cursor_present: k.cursor != null, last_attempt_at: k.last_attempt_at, last_successful_sync_at: k.last_successful_sync_at, last_import_completed_at: k.last_import_completed_at, last_import_outcome: k.last_import_outcome, last_reconciliation_at: k.last_reconciliation_at, last_received_at: k.last_received_at, last_new_record_at: k.last_new_record_at, last_journal_commit_at: k.last_journal_commit_at, next_poll_at: k.next_poll_at, next_poll_reason: k.next_poll_reason, retry_state: retry, pending_count: k.pending_count, failed_count: k.failed_count, quarantined_count: k.quarantined_count, coverage: k.coverage, restrictions: k.restrictions, updated_at: k.updated_at };
  }
  async runs(tenantId: string, connectionId: string, limit = 50) {
    return withTenant(this.ctx.db, tenantId, (tx) => tx`SELECT * FROM import_runs WHERE tenant_id = ${tenantId} AND connection_id = ${connectionId} ORDER BY updated_at DESC LIMIT ${Math.min(limit, 200)}`);
  }
  async run(tenantId: string, runId: string) { return withTenant(this.ctx.db, tenantId, async (tx) => (await tx`SELECT * FROM import_runs WHERE tenant_id = ${tenantId} AND run_id = ${runId}`)[0] ?? null); }
  /** Readiness overlay for an answer: per capability dataset -> connections covering it with their freshness. */
  async readinessFor(tenantId: string, coverage: Array<{ capability: string; status: string }>) {
    const conns = await this.list(tenantId);
    return coverage.map((c) => {
      const providers = conns.flatMap((cn) => cn.capabilities.filter((k) => k.capability === c.capability).map((k) => ({ connection_id: cn.connection_id, provider: cn.provider, display_name: cn.display_name, health: k.health, last_successful_sync_at: k.last_successful_sync_at, last_new_record_at: k.last_new_record_at, collection_state: k.collection_state })));
      const ready = c.status === 'complete_for_declared_scope' ? 'ready' : c.status === 'partial' ? 'partial' : 'blocked';
      return { capability: c.capability, coverage_status: c.status, readiness: ready, sources: providers, missing_source: providers.length === 0 };
    });
  }
}

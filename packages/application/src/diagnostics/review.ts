import { randomUUID } from 'node:crypto';
import { withTenant } from '@blackbox/database';
import type { AppContext } from '../context.js';
import { IngestService } from '../ingest/service.js';

export type Decision = 'retry' | 'confirm_link' | 'reject_link' | 'manual_assertion' | 'leave_unresolved';

/** Needs-review workflow (PILOT-04): owner-only, revision-checked, idempotent; decisions append to the journal. */
export class ReviewService {
  constructor(private readonly ctx: AppContext) {}
  async list(tenantId: string, state?: string) { return withTenant(this.ctx.db, tenantId, (tx) => state ? tx`SELECT * FROM review_cases WHERE tenant_id = ${tenantId} AND state = ${state} ORDER BY updated_at DESC LIMIT 200` : tx`SELECT * FROM review_cases WHERE tenant_id = ${tenantId} ORDER BY (state = 'resolved'), updated_at DESC LIMIT 200`); }
  async get(tenantId: string, caseId: string) { return withTenant(this.ctx.db, tenantId, async (tx) => (await tx`SELECT * FROM review_cases WHERE tenant_id = ${tenantId} AND case_id = ${caseId}`)[0] ?? null); }
  async open(tenantId: string, input: { kind: string; connectionId?: string | null; runId?: string | null; inputRef: Record<string, unknown>; affected: Record<string, unknown>; reasonCode: string; stage: string; evidenceRef?: string | null }): Promise<string> {
    const caseId = randomUUID();
    await withTenant(this.ctx.db, tenantId, (tx) => tx`INSERT INTO review_cases (case_id, tenant_id, kind, connection_id, run_id, input_ref, affected, reason_code, stage, evidence_ref, history) VALUES (${caseId}, ${tenantId}, ${input.kind}, ${input.connectionId ?? null}, ${input.runId ?? null}, ${tx.json(input.inputRef as never)}, ${tx.json(input.affected as never)}, ${input.reasonCode}, ${input.stage}, ${input.evidenceRef ?? null}, ${tx.json([{ at: new Date().toISOString(), actor: 'system', action: 'opened' }] as never)})`);
    return caseId;
  }
  /**
   * Apply an owner decision. `expectedRevision` makes competing clicks safe (second click gets `stale_revision`).
   * Business decisions are appended as `review.decision_recorded` (plus the asserted observation); only the case row mutates.
   */
  async decide(tenantId: string, ownerId: string, caseId: string, expectedRevision: number, decision: Decision, reason: string, asserted?: { event_type: string; occurred_at: string; payload: Record<string, unknown>; evidence_refs?: string[] }): Promise<{ ok: boolean; code?: string; revision?: number; entry_ids?: string[]; required_cursor?: number }> {
    const c = await this.get(tenantId, caseId); if (!c) return { ok: false, code: 'not_found' };
    if (Number(c.revision) !== expectedRevision) return { ok: false, code: 'stale_revision', revision: Number(c.revision) };
    if (c.state === 'resolved') return { ok: false, code: 'already_resolved', revision: Number(c.revision) };
    const ingest = new IngestService(this.ctx.db, this.ctx.log);
    const observations = [{ event_type: 'review.decision_recorded', provider_event_id: `decision:${caseId}:${expectedRevision}:${decision}`, occurred_at: this.ctx.now().toISOString(), record_id: `review_case:${caseId}`, payload: { case_id: caseId, decision, reason: reason.slice(0, 500), actor_kind: 'owner' as const, asserted: asserted ? { event_type: asserted.event_type } : undefined } }];
    if (decision === 'manual_assertion') { if (!asserted) return { ok: false, code: 'assertion_required' }; observations.push({ event_type: asserted.event_type, provider_event_id: `assertion:${caseId}:${expectedRevision}`, occurred_at: asserted.occurred_at, record_id: undefined as never, payload: asserted.payload as never }); }
    const outcome = await ingest.ingest({ tenantId, connectionId: (c.connection_id as string | null) ?? null, providerNamespace: 'owner_review' }, observations as never);
    if (outcome.rejected.length) return { ok: false, code: 'assertion_invalid' };
    const required = outcome.accepted.reduce((m, r) => Math.max(m, r.journal_sequence), 0);
    const nextState = decision === 'leave_unresolved' ? 'in_progress' : decision === 'retry' ? 'in_progress' : 'resolved';
    await withTenant(this.ctx.db, tenantId, async (tx) => {
      await tx`UPDATE review_cases SET state = ${nextState}, revision = revision + 1, resolution_entry_id = ${outcome.accepted[0]?.entry_id ?? null}, history = history || ${tx.json([{ at: new Date().toISOString(), actor: `owner:${ownerId}`, action: decision, reason: reason.slice(0, 500), entry_ids: outcome.accepted.map((a) => a.entry_id) }] as never)}, updated_at = now() WHERE case_id = ${caseId} AND tenant_id = ${tenantId} AND revision = ${expectedRevision}`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'review.decided', ${tx.json({ case_id: caseId, decision })})`;
    });
    if (decision === 'retry') await withTenant(this.ctx.db, tenantId, (tx) => tx`INSERT INTO jobs (tenant_id, kind, payload, run_at) VALUES (${tenantId}, 'review.retry', ${tx.json({ case_id: caseId })}, now())`);
    return { ok: true, revision: expectedRevision + 1, entry_ids: outcome.accepted.map((a) => a.entry_id), required_cursor: required };
  }
}

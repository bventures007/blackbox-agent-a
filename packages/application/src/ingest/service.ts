import { randomUUID } from 'node:crypto';
import { appendJournal, JournalConflictError, withTenant, type AppendResult, type Db } from '@blackbox/database';
import { entityRefsFor, parseSourcePayload, SourceEventType, type JournalEntryInput } from '@blackbox/contracts';
import type { Logger } from '@blackbox/logging';

export interface Observation {
  event_type: string;
  provider_event_id: string;
  occurred_at: string;
  payload: unknown;
  evidence_refs?: string[];
  correlation_id?: string;
  record_id?: string;
}
export interface IngestTarget { tenantId: string; connectionId: string | null; providerNamespace: string; runId?: string }
export interface IngestOutcome { accepted: AppendResult[]; duplicates: number; conflicts: Array<{ dedup_key: string; existing_entry_id?: string; case_id: string }>; rejected: Array<{ provider_event_id: string; reason: string; case_id: string }> }

export class IngestError extends Error { constructor(public readonly code: string, message: string) { super(message); this.name = 'IngestError'; } }

/** Validate typed observations and append Source entries through the journal boundary; commit before acknowledging. */
export class IngestService {
  constructor(private readonly db: Db, private readonly log: Logger) {}

  toEntry(target: IngestTarget, o: Observation): JournalEntryInput {
    const type = SourceEventType.parse(o.event_type);
    const payload = parseSourcePayload(type, o.payload);
    const refs = entityRefsFor(type, payload);
    const recordId = o.record_id ?? (refs[0] ? `${refs[0].type}:${refs[0].id}` : `${type}:${o.provider_event_id}`);
    return { entry_id: randomUUID(), record_type: 'source', record_id: recordId, event_type: type, schema_version: 1, connection_id: target.connectionId, provider_namespace: target.providerNamespace,
      dedup_key: `${target.providerNamespace}:${o.provider_event_id}`, occurred_at: new Date(o.occurred_at).toISOString(), entity_refs: refs, payload, evidence_refs: o.evidence_refs ?? [], input_entry_ids: [], correlation_id: o.correlation_id, causation_id: undefined };
  }

  async ingest(target: IngestTarget, observations: Observation[]): Promise<IngestOutcome> {
    const out: IngestOutcome = { accepted: [], duplicates: 0, conflicts: [], rejected: [] };
    const entries: Array<{ o: Observation; e: JournalEntryInput }> = [];
    for (const o of observations) {
      try { entries.push({ o, e: this.toEntry(target, o) }); }
      catch (err) { const caseId = await this.quarantine(target, o, 'invalid_observation', (err as Error).message); out.rejected.push({ provider_event_id: o.provider_event_id, reason: 'invalid_observation', case_id: caseId }); }
    }
    if (entries.length === 0) return out;
    const started = Date.now();
    try {
      const res = await withTenant(this.db, target.tenantId, (tx) => appendJournal(tx, target.tenantId, entries.map((x) => x.e)));
      this.collect(out, res);
    } catch (err) {
      if (!(err instanceof JournalConflictError)) throw err;
      // isolate the conflicting identity: append one by one so valid observations still commit
      for (const { o, e } of entries) {
        try { const res = await withTenant(this.db, target.tenantId, (tx) => appendJournal(tx, target.tenantId, [e])); this.collect(out, res); }
        catch (e2) {
          if (!(e2 instanceof JournalConflictError)) throw e2;
          const caseId = await this.quarantine(target, o, 'same_identity_different_content', `provider event ${o.provider_event_id} was already recorded with different content; original preserved`, e2.existingEntryId);
          out.conflicts.push({ dedup_key: e2.dedupKey, existing_entry_id: e2.existingEntryId, case_id: caseId });
        }
      }
    }
    const committed = out.accepted.reduce((m, r) => Math.max(m, r.journal_sequence), 0);
    this.log.info('journal.batch_committed', 'source observations committed', { tenant_id: target.tenantId, connection_id: target.connectionId, run_id: target.runId, record_count: out.accepted.length, duration_ms: Date.now() - started, committed_cursor: committed || undefined, journal_batch_id: randomUUID() });
    if (out.conflicts.length) this.log.warn('ingest.conflicts', 'same provider identity with different content recorded as review cases', { tenant_id: target.tenantId, connection_id: target.connectionId, run_id: target.runId, record_count: out.conflicts.length, error_code: 'same_identity_different_content', retryable: false, action_code: 'review_required' });
    return out;
  }

  private collect(out: IngestOutcome, res: AppendResult[]) { for (const r of res) { if (r.inserted) out.accepted.push(r); else out.duplicates++; } }

  private async quarantine(target: IngestTarget, o: Observation, reason: string, detail: string, existing?: string): Promise<string> {
    const caseId = randomUUID();
    await withTenant(this.db, target.tenantId, (tx) => tx`INSERT INTO review_cases (case_id, tenant_id, kind, state, connection_id, run_id, input_ref, affected, reason_code, stage, history)
      VALUES (${caseId}, ${target.tenantId}, ${reason === 'invalid_observation' ? 'quarantined_input' : 'content_conflict'}, 'open', ${target.connectionId}, ${target.runId ?? null},
      ${tx.json({ provider_event_id: o.provider_event_id, event_type: o.event_type, existing_entry_id: existing ?? null })}, ${tx.json({ event_type: o.event_type })}, ${reason}, 'ingest_validation',
      ${tx.json([{ at: new Date().toISOString(), actor: 'ingest', action: 'opened', detail: detail.slice(0, 300) }])})`);
    return caseId;
  }
}

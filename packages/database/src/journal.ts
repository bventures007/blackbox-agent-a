import { JournalEntryInput, type JournalEntry } from '@blackbox/contracts';
import type { Tx } from './client.js';
import { pgErrorCode } from './client.js';

export interface AppendResult { entry_id: string; journal_sequence: number; inserted: boolean; recorded_at: string }

export class JournalConflictError extends Error {
  constructor(public readonly dedupKey: string, public readonly existingEntryId: string | undefined) {
    super(`dedup key ${dedupKey} already recorded with different content`);
    this.name = 'JournalConflictError';
  }
}

/**
 * Append entries through the single database boundary (journal_append). Must run inside withTenant().
 * Identical re-deliveries return inserted=false; same identity with different content raises JournalConflictError.
 */
export async function appendJournal(tx: Tx, tenantId: string, entries: JournalEntryInput[]): Promise<AppendResult[]> {
  if (entries.length === 0) return [];
  const parsed = entries.map((e) => JournalEntryInput.parse(e));
  try {
    const rows = await tx`SELECT entry_id, journal_sequence, inserted, recorded_at FROM journal_append(${tenantId}::uuid, ${tx.json(parsed as never)}::jsonb)`;
    return rows.map((r) => ({ entry_id: r.entry_id as string, journal_sequence: Number(r.journal_sequence), inserted: r.inserted as boolean, recorded_at: new Date(r.recorded_at as string).toISOString() }));
  } catch (err) {
    if (pgErrorCode(err) === 'BBX02') {
      const message = (err as Error).message;
      const key = /dedup key (.+?) already/.exec(message)?.[1] ?? 'unknown';
      const detail = (err as { detail?: string }).detail;
      throw new JournalConflictError(key, detail);
    }
    throw err;
  }
}

export async function committedHighWaterMark(tx: Tx, tenantId: string): Promise<number> {
  const [row] = await tx`SELECT next_sequence - 1 AS hwm FROM tenant_sequences WHERE tenant_id = ${tenantId}::uuid`;
  return Number(row?.hwm ?? 0);
}

export function rowToEntry(r: Record<string, unknown>): JournalEntry {
  return {
    entry_id: r.entry_id as string, tenant_id: r.tenant_id as string, journal_sequence: Number(r.journal_sequence),
    record_type: r.record_type as JournalEntry['record_type'], record_id: r.record_id as string, event_type: r.event_type as string,
    schema_version: Number(r.schema_version), connection_id: (r.connection_id as string | null) ?? null,
    provider_namespace: (r.provider_namespace as string | null) ?? null, dedup_key: r.dedup_key as string,
    occurred_at: new Date(r.occurred_at as string).toISOString(), recorded_at: new Date(r.recorded_at as string).toISOString(),
    entity_refs: (r.entity_refs as JournalEntry['entity_refs']) ?? [], payload: (r.payload as Record<string, unknown>) ?? {},
    payload_hash: r.payload_hash as string, evidence_refs: (r.evidence_refs as string[]) ?? [], input_entry_ids: (r.input_entry_ids as string[]) ?? [],
    rule_version: (r.rule_version as string | undefined) ?? undefined, supersedes_entry_id: (r.supersedes_entry_id as string | undefined) ?? undefined,
    correlation_id: (r.correlation_id as string | undefined) ?? undefined, causation_id: (r.causation_id as string | undefined) ?? undefined,
  };
}

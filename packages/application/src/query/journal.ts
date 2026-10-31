import { committedHighWaterMark, rowToEntry, withTenant, type Db } from '@blackbox/database';
import type { JournalEntry, ListEntriesRequest } from '@blackbox/contracts';

export interface EntriesPage { entries: JournalEntry[]; snapshot_cursor: number; next_after_sequence: number | null; newer_committed: boolean; truncated: boolean }

/** Tenant-scoped journal traversal with a stable snapshot boundary (committed high-water mark at first page). */
export class JournalReader {
  constructor(private readonly db: Db) {}

  async highWaterMark(tenantId: string): Promise<number> { return withTenant(this.db, tenantId, (tx) => committedHighWaterMark(tx, tenantId)); }

  async list(tenantId: string, req: ListEntriesRequest): Promise<EntriesPage> {
    return withTenant(this.db, tenantId, async (tx) => {
      const hwm = await committedHighWaterMark(tx, tenantId);
      const snapshot = req.snapshot_cursor !== undefined ? Math.min(req.snapshot_cursor, hwm) : hwm;
      const after = req.after_sequence ?? 0;
      const limit = req.page_size + 1;
      const types = req.record_types ?? null; const events = req.event_types ?? null;
      const rows = req.entity
        ? await tx`SELECT je.* FROM journal_entity_links l JOIN journal_entries je ON je.entry_id = l.entry_id WHERE l.tenant_id = ${tenantId} AND l.entity_type = ${req.entity.type} AND l.entity_id = ${req.entity.id} AND l.journal_sequence > ${after} AND l.journal_sequence <= ${snapshot}
            ${types ? tx`AND je.record_type = ANY(${types})` : tx``} ${events ? tx`AND je.event_type = ANY(${events})` : tx``}
            ${req.connection_id ? tx`AND je.connection_id = ${req.connection_id}` : tx``}
            ${req.occurred_from ? tx`AND je.occurred_at >= ${req.occurred_from}` : tx``} ${req.occurred_to ? tx`AND je.occurred_at <= ${req.occurred_to}` : tx``}
            ${req.recorded_from ? tx`AND je.recorded_at >= ${req.recorded_from}` : tx``} ${req.recorded_to ? tx`AND je.recorded_at <= ${req.recorded_to}` : tx``}
            ORDER BY l.journal_sequence LIMIT ${limit}`
        : await tx`SELECT je.* FROM journal_entries je WHERE je.tenant_id = ${tenantId} AND je.journal_sequence > ${after} AND je.journal_sequence <= ${snapshot}
            ${types ? tx`AND je.record_type = ANY(${types})` : tx``} ${events ? tx`AND je.event_type = ANY(${events})` : tx``}
            ${req.connection_id ? tx`AND je.connection_id = ${req.connection_id}` : tx``}
            ${req.occurred_from ? tx`AND je.occurred_at >= ${req.occurred_from}` : tx``} ${req.occurred_to ? tx`AND je.occurred_at <= ${req.occurred_to}` : tx``}
            ${req.recorded_from ? tx`AND je.recorded_at >= ${req.recorded_from}` : tx``} ${req.recorded_to ? tx`AND je.recorded_at <= ${req.recorded_to}` : tx``}
            ${req.text ? tx`AND (je.record_id ILIKE ${'%' + req.text + '%'} OR je.event_type ILIKE ${'%' + req.text + '%'} OR je.entity_refs::text ILIKE ${'%' + req.text + '%'})` : tx``}
            ORDER BY je.journal_sequence LIMIT ${limit}`;
      const truncated = rows.length > req.page_size;
      const entries = rows.slice(0, req.page_size).map((r) => rowToEntry(r as Record<string, unknown>));
      return { entries, snapshot_cursor: snapshot, next_after_sequence: truncated ? entries.at(-1)!.journal_sequence : null, newer_committed: hwm > snapshot, truncated };
    });
  }

  async get(tenantId: string, entryId: string): Promise<JournalEntry | null> {
    return withTenant(this.db, tenantId, async (tx) => { const [r] = await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND entry_id = ${entryId}`; return r ? rowToEntry(r as Record<string, unknown>) : null; });
  }
  async getMany(tenantId: string, ids: string[]): Promise<JournalEntry[]> {
    if (ids.length === 0) return [];
    return withTenant(this.db, tenantId, async (tx) => (await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND entry_id = ANY(${ids.slice(0, 500)}::uuid[]) ORDER BY journal_sequence`).map((r) => rowToEntry(r as Record<string, unknown>)));
  }
  /** Derivation/correction graph for one entry: inputs, outputs, supersedes/superseded-by. */
  async links(tenantId: string, entryId: string): Promise<{ inputs: JournalEntry[]; derived: JournalEntry[]; supersedes: JournalEntry | null; superseded_by: JournalEntry[] }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [self] = await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND entry_id = ${entryId}`;
      if (!self) return { inputs: [], derived: [], supersedes: null, superseded_by: [] };
      const inputs = (await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND entry_id = ANY(${self.input_entry_ids as string[]}::uuid[])`).map((r) => rowToEntry(r as Record<string, unknown>));
      const derived = (await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND ${entryId}::uuid = ANY(input_entry_ids) ORDER BY journal_sequence LIMIT 200`).map((r) => rowToEntry(r as Record<string, unknown>));
      const sup = self.supersedes_entry_id ? await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND entry_id = ${self.supersedes_entry_id as string}` : [];
      const by = (await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} AND supersedes_entry_id = ${entryId} ORDER BY journal_sequence`).map((r) => rowToEntry(r as Record<string, unknown>));
      return { inputs, derived, supersedes: sup[0] ? rowToEntry(sup[0] as Record<string, unknown>) : null, superseded_by: by };
    });
  }
  async counts(tenantId: string): Promise<Record<string, number>> {
    return withTenant(this.db, tenantId, async (tx) => { const rows = await tx`SELECT record_type, count(*)::int AS n FROM journal_entries WHERE tenant_id = ${tenantId} GROUP BY record_type`; const out: Record<string, number> = { source: 0, fact: 0, commitment: 0, movement: 0, reservation: 0 }; for (const r of rows) out[r.record_type as string] = Number(r.n); return out; });
  }
  async recent(tenantId: string, limit = 50): Promise<JournalEntry[]> {
    return withTenant(this.db, tenantId, async (tx) => (await tx`SELECT * FROM journal_entries WHERE tenant_id = ${tenantId} ORDER BY journal_sequence DESC LIMIT ${Math.min(limit, 500)}`).map((r) => rowToEntry(r as Record<string, unknown>)));
  }
  async evidence(tenantId: string, evidenceId: string): Promise<{ status: 'available' | 'redacted' | 'unavailable'; meta?: Record<string, unknown>; reason?: string }> {
    return withTenant(this.db, tenantId, async (tx) => {
      const [red] = await tx`SELECT action, reason, at FROM redaction_ledger WHERE tenant_id = ${tenantId} AND evidence_id = ${evidenceId} ORDER BY at DESC LIMIT 1`;
      if (red) return { status: 'redacted' as const, reason: `${red.action}: ${red.reason}` };
      const [ev] = await tx`SELECT evidence_id, connection_id, object_key, sha256, size_bytes, media_type, retention_class, received_at, source_ref FROM journal_evidence WHERE tenant_id = ${tenantId} AND evidence_id = ${evidenceId}`;
      if (!ev) return { status: 'unavailable' as const, reason: 'no evidence object recorded under this id' };
      return { status: 'available' as const, meta: ev as Record<string, unknown> };
    });
  }
}

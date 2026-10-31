import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ListEntriesRequest } from '@blackbox/contracts';
import { QueryRejected } from '@blackbox/application';
import type { Services } from '../app.js';

export function sendQueryError(reply: import('fastify').FastifyReply, err: unknown) {
  if (err instanceof QueryRejected) { reply.header('retry-after', String(Math.ceil(err.retryAfterMs / 1000) || 1)); return reply.code(err.code === 'admission' ? 429 : err.code === 'unavailable' ? 503 : 400).send({ error: err.code, message: err.message, retry_after_ms: err.retryAfterMs }); }
  throw err;
}

/** Shared business read routes for the browser (owner session) and agents (agent key). Both use the same QueryService. */
export async function registerQueryRoutes(app: FastifyInstance, s: Services) {
  const auth = (req: import('fastify').FastifyRequest, reply: import('fastify').FastifyReply) => app.authenticate(req, reply, { agent: true, csrf: false });

  app.post('/api/query', async (req, reply) => { const p = await auth(req, reply); if (!p) return; try { return await s.query.answer(p, req.body); } catch (err) { return sendQueryError(reply, err); } });
  app.post('/api/state', async (req, reply) => { const p = await auth(req, reply); if (!p) return; try { return await s.query.state(p, req.body); } catch (err) { return sendQueryError(reply, err); } });
  app.post('/api/journal/entries', async (req, reply) => { const p = await auth(req, reply); if (!p) return; const r = ListEntriesRequest.safeParse(req.body ?? {}); if (!r.success) return reply.code(400).send({ error: 'invalid_request', message: r.error.message }); return s.query.journal.list(p.tenantId, r.data); });
  app.get('/api/journal/entries/:id', async (req, reply) => { const p = await auth(req, reply); if (!p) return; const id = (req.params as { id: string }).id; if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: 'invalid_id' }); const e = await s.query.journal.get(p.tenantId, id); if (!e) return reply.code(404).send({ error: 'not_found' }); const links = await s.query.journal.links(p.tenantId, id); return { entry: e, links }; });
  app.post('/api/journal/entries/batch', async (req, reply) => { const p = await auth(req, reply); if (!p) return; const r = z.object({ ids: z.array(z.string().uuid()).max(500) }).safeParse(req.body); if (!r.success) return reply.code(400).send({ error: 'invalid_request' }); return { entries: await s.query.journal.getMany(p.tenantId, r.data.ids) }; });
  app.get('/api/journal/counts', async (req, reply) => { const p = await auth(req, reply); if (!p) return; return { counts: await s.query.journal.counts(p.tenantId), committed_cursor: await s.query.journal.highWaterMark(p.tenantId) }; });
  app.get('/api/journal/recent', async (req, reply) => { const p = await auth(req, reply); if (!p) return; const limit = Number((req.query as { limit?: string }).limit ?? 50); return { entries: await s.query.journal.recent(p.tenantId, Number.isFinite(limit) ? limit : 50) }; });
  app.get('/api/evidence/:id', async (req, reply) => { const p = await auth(req, reply); if (!p) return; const id = (req.params as { id: string }).id; return s.query.journal.evidence(p.tenantId, id.slice(0, 200)); });
  app.get('/api/schema', async (req, reply) => { const p = await auth(req, reply); if (!p) return; const { SourceEventType, IntentId } = await import('@blackbox/contracts'); const conns = await s.sources.list(p.tenantId); return describeSchema(SourceEventType.options, IntentId.options, conns.map((c) => ({ provider: c.provider, capabilities: c.capabilities.map((k) => k.capability) }))); });
}

export function describeSchema(eventTypes: readonly string[], intents: readonly string[], coverage: Array<{ provider: string; capabilities: unknown[] }>) {
  return {
    record_types: ['source', 'fact', 'commitment', 'movement', 'reservation'],
    entity_types: ['order', 'customer', 'item', 'invoice', 'transaction', 'account', 'shipment', 'tracking', 'return', 'refund', 'dispute', 'payout', 'bank_entry', 'hold', 'ledger_entry', 'rule', 'case', 'message', 'coverage', 'review_case', 'reservation', 'refund_obligation', 'promise'],
    source_event_types: eventTypes, intents,
    units: { money: 'integer minor currency units with ISO-4217 code; currencies never add', quantity: 'decimal string with explicit unit' },
    time_semantics: { occurred_at: 'effective business time supplied by the source', recorded_at: 'server time at durable commit', journal_sequence: 'tenant-scoped gap-free traversal position; cursors and cutoffs use it' },
    consistency_modes: ['latest_committed', 'at_least_cursor', 'as_of (entity state: recorded_cutoff and/or effective_at)', 'stale_allowed (explicit, labeled)'],
    filterable_fields: { list_journal_entries: ['record_types', 'event_types', 'entity{type,id}', 'connection_id', 'occurred_from/to', 'recorded_from/to', 'text (literal)', 'snapshot_cursor', 'after_sequence', 'page_size<=500'] },
    relationships: ['entity_refs on each entry (tenant-scoped)', 'input_entry_ids: derivation inputs', 'supersedes_entry_id: correction chain', 'correlation_id/causation_id'],
    connector_coverage: coverage,
    limits: { page_rows_default: 100, page_rows_max: 500, synchronous_deadline_ms: 5000, concurrency: { per_agent: 8, per_workspace: 16, global: 32 } },
    excluded: ['credentials, sessions, keys', 'source secrets', 'technical logs and diagnostics', 'journal writes, ingestion, administration'],
  };
}

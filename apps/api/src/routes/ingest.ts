import type { FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { withScope, withTenant } from '@blackbox/database';
import { GenericEnvelope, mapFixture, verifySignature, type FixtureEvent } from '@blackbox/application';
import type { Services } from '../app.js';

/** Ingestion entry points: signed generic producer events (producer key) and owner-triggered replay of synthetic fixtures. */
export async function registerIngestRoutes(app: FastifyInstance, s: Services) {
  // maintenance fence: ingestion is refused (503 + Retry-After) while a backup/upgrade holds the fence
  app.addHook('preHandler', async (req, reply) => {
    if (!(req.method === 'POST' && (req.url.startsWith('/api/ingest') || /\/(replay|bank-csv|rules)$/.test(req.url.split('?')[0]!)))) return;
    const [f] = await withScope(s.ctx.db, 'scheduler', (tx) => tx`SELECT holder FROM maintenance_fence WHERE fence_id = 1 AND holder IS NOT NULL AND expires_at > now()`);
    if (f) { reply.header('retry-after', '30').code(503).send({ error: 'maintenance_fence', message: `maintenance in progress (${f.holder}); ingestion resumes afterwards` }); return reply; }
  });
  // raw body capture for HMAC verification on this route only
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => { (req as unknown as { rawBody: string }).rawBody = body as string; try { done(null, body ? JSON.parse(body as string) : {}); } catch (e) { done(e as Error, undefined); } });

  app.post('/api/ingest/generic', async (req, reply) => {
    const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
    const producer = await s.auth.authenticateKey(bearer, 'producer');
    if (!producer) return reply.code(401).send({ error: 'unauthenticated', message: 'producer key required' });
    const raw = (req as unknown as { rawBody: string }).rawBody ?? '';
    if (!verifySignature(raw, bearer!, req.headers['x-blackbox-signature'] as string | undefined)) return reply.code(401).send({ error: 'bad_signature', message: 'X-Blackbox-Signature does not match the body' });
    const env = GenericEnvelope.safeParse(req.body); if (!env.success) return reply.code(400).send({ error: 'invalid_envelope', message: env.error.issues.slice(0, 5).map((i) => i.path.join('.') + ': ' + i.message).join('; ') });
    // the connection is bound to the producer principal name; payload tenant ids are never trusted
    const conn = await withTenant(s.ctx.db, producer.tenantId, async (tx) => (await tx`SELECT connection_id FROM connections WHERE tenant_id = ${producer.tenantId} AND provider = 'generic' AND account_namespace = ${env.data.producer} AND status <> 'disconnected' LIMIT 1`)[0]);
    if (!conn) return reply.code(403).send({ error: 'unknown_producer', message: 'no generic connection is configured for this producer name' });
    const connectionId = conn.connection_id as string;
    const runId = await s.sources.startRun(producer.tenantId, connectionId, 'incremental', { idempotency_key: env.data.idempotency_key, events: env.data.events.length });
    const out = await s.ingest.ingest({ tenantId: producer.tenantId, connectionId, providerNamespace: `generic:${env.data.producer}`, runId }, env.data.events.map((e) => ({ event_type: e.event_type, provider_event_id: e.event_id, occurred_at: e.occurred_at, payload: e.payload, evidence_refs: e.evidence_refs, correlation_id: e.correlation_id })));
    const now = new Date(); const caps = new Set(env.data.events.map((e) => e.event_type.split('.')[0]!));
    for (const c of capsFromEvents(env.data.events.map((e) => e.event_type))) await s.sources.touchCapability(producer.tenantId, connectionId, c, { collection_state: 'ready', last_attempt_at: now, last_successful_sync_at: now, last_received_at: now, last_new_record_at: out.accepted.length ? now : undefined, last_journal_commit_at: out.accepted.length ? now : undefined, next_poll_at: null, next_poll_reason: 'authenticated push from producer: no poll' });
    if (env.data.declared_coverage) {
      const dc = env.data.declared_coverage;
      await s.ingest.ingest({ tenantId: producer.tenantId, connectionId, providerNamespace: 'runtime', runId }, [{ event_type: 'coverage.observed', provider_event_id: `coverage:${dc.capability}:${connectionId}:${env.data.idempotency_key}`, occurred_at: now.toISOString(), payload: { capability: dc.capability, entity_scope: dc.entity_scope, history_start: dc.history_start ? new Date(dc.history_start).toISOString() : null, complete_through: dc.complete_through ? new Date(dc.complete_through).toISOString() : null, backfill_complete: dc.backfill_complete, coverage_basis: `producer ${env.data.producer} declared coverage (labelled assertion, not independently verified)`, missing_fields: dc.missing_fields } }]);
    }
    await s.sources.updateRun(producer.tenantId, runId, { state: out.rejected.length || out.conflicts.length ? 'complete_with_gaps' : 'complete', phase: 'ready', outcome: `${out.accepted.length} committed, ${out.duplicates} duplicates, ${out.conflicts.length} conflicts, ${out.rejected.length} rejected`, counters: { received: env.data.events.length, committed: out.accepted.length, duplicates: out.duplicates, conflicts: out.conflicts.length, rejected: out.rejected.length } });
    void caps;
    return reply.code(out.rejected.length ? 207 : 202).send({ run_id: runId, accepted: out.accepted.length, duplicates: out.duplicates, conflicts: out.conflicts, rejected: out.rejected, committed_cursor: out.accepted.reduce((m, a) => Math.max(m, a.journal_sequence), 0) });
  });

  // Owner-triggered replay of a bundled synthetic fixture into a replay connection (clearly labelled synthetic)
  app.post('/api/sources/:id/replay', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ fixture: z.enum(['golden_order_to_cash']).default('golden_order_to_cash'), scale: z.number().positive().max(1000).default(1), id_suffix: z.string().max(20).default(''), stop_after: z.string().max(10).optional(), repeat: z.number().int().min(1).max(5).default(1), skip_connections: z.array(z.string()).default([]) }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    const id = (req.params as { id: string }).id;
    const conn = await withTenant(s.ctx.db, p.tenantId, async (tx) => (await tx`SELECT provider FROM connections WHERE connection_id = ${id} AND tenant_id = ${p.tenantId}`)[0]);
    if (!conn || conn.provider !== 'replay') return reply.code(404).send({ error: 'not_a_replay_connection' });
    const fixturePath = process.env.FIXTURES_DIR ? `${process.env.FIXTURES_DIR}/golden-order-to-cash.json` : new URL('../../../../GOLDEN-ORDER-TO-CASH.json', import.meta.url).pathname;
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { events: FixtureEvent[] };
    let events = fixture.events; if (body.data.stop_after) { const idx = events.findIndex((e) => e.id === body.data.stop_after); if (idx >= 0) events = events.slice(0, idx + 1); }
    const mapped = mapFixture(events, { scale: body.data.scale, idSuffix: body.data.id_suffix, connectionsFilter: (c) => !body.data.skip_connections.includes(c) });
    const runId = await s.sources.startRun(p.tenantId, id, 'import', { fixture: body.data.fixture, scale: body.data.scale, id_suffix: body.data.id_suffix, synthetic: true });
    let accepted = 0, duplicates = 0, conflicts = 0; let maxSeq = 0;
    for (let i = 0; i < body.data.repeat; i++) {
      const groups = new Map<string, typeof mapped>(); for (const m of mapped) { const g = groups.get(m.connection) ?? []; g.push(m); groups.set(m.connection, g); }
      // deliver in fixture order, but through per-sub-source namespaces so provider identity stays scoped
      for (const m of mapped) { const out = await s.ingest.ingest({ tenantId: p.tenantId, connectionId: id, providerNamespace: `replay:${m.connection}`, runId }, [m.observation]); accepted += out.accepted.length; duplicates += out.duplicates; conflicts += out.conflicts.length; maxSeq = Math.max(maxSeq, ...out.accepted.map((a) => a.journal_sequence)); }
      void groups;
    }
    const now = new Date(); const touched = new Set(mapped.map((m) => m.observation.event_type.split('.')[0]!));
    for (const cap of capsFromEvents(mapped.map((m) => m.observation.event_type))) {
      await s.sources.touchCapability(p.tenantId, id, cap, { collection_state: 'ready', last_attempt_at: now, last_successful_sync_at: now, last_import_completed_at: now, last_import_outcome: 'complete', last_received_at: now, last_new_record_at: accepted ? now : undefined, last_journal_commit_at: accepted ? now : undefined, coverage: { synthetic: true, fixture: body.data.fixture, history_kind: 'event_history' }, next_poll_at: null, next_poll_reason: 'synthetic replay: no provider poll' });
      await s.ingest.ingest({ tenantId: p.tenantId, connectionId: id, providerNamespace: 'runtime', runId }, [{ event_type: 'coverage.observed', provider_event_id: `coverage:${cap}:${id}:${runId}`, occurred_at: now.toISOString(), payload: { capability: cap, entity_scope: 'synthetic_fixture', history_start: events[0]?.occurred_at ?? null, complete_through: events.at(-1)?.occurred_at ?? null, backfill_complete: true, coverage_basis: `synthetic fixture ${body.data.fixture} fully replayed`, missing_fields: [] } }]);
    }
    void touched;
    await s.sources.updateRun(p.tenantId, runId, { state: 'complete', phase: 'ready', outcome: `${accepted} committed, ${duplicates} duplicates, ${conflicts} conflicts (synthetic)`, counters: { fixture_events: events.length, committed: accepted, duplicates, conflicts } });
    return { run_id: runId, accepted, duplicates, conflicts, required_cursor: maxSeq, synthetic: true };
  });
}

/** Map event families to capability (dataset) ids so capability state and coverage stay per dataset. */
export function capsFromEvents(eventTypes: string[]): string[] {
  const map: Record<string, string> = { order: 'orders', inventory: 'stock', allocation: 'allocations', supply: 'supply', customer: 'promises', shipment: 'fulfillments', carrier: 'tracking', communication: 'communications', invoice: 'invoices', payment: 'payments', business: 'policy', provider: 'provider_ledger', payout: 'payouts', bank: 'bank', return: 'returns', refund: 'refunds', dispute: 'disputes', chargeback: 'disputes', coverage: 'coverage', entity: 'identity', review: 'identity' };
  const out = new Set<string>();
  for (const t of eventTypes) {
    if (t === 'inventory.reserved' || t === 'inventory.reservation_released') { out.add('allocations'); continue; }
    if (t === 'invoice.dispatch_observed') { out.add('invoice_dispatch'); continue; }
    if (t === 'payment.allocation_recorded' || t === 'payment.allocation_revised') { out.add('payment_allocations'); continue; }
    if (t === 'payment.fee_booked' || t === 'provider.ledger_posted') { out.add('provider_ledger'); continue; }
    if (t === 'provider.balance_observed') { out.add('positions'); continue; }
    if (t.startsWith('provider.hold') || t === 'provider.release_promised') { out.add('holds'); continue; }
    if (t === 'return.received' || t === 'return.restocked' || t === 'return.disposition_observed') { out.add('receipts'); continue; }
    if (t.startsWith('refund.entitlement')) { out.add('entitlements'); continue; }
    if (t.startsWith('business.case')) { out.add('cases'); continue; }
    const fam = map[t.split('.')[0]!]; if (fam) out.add(fam);
  }
  return [...out];
}

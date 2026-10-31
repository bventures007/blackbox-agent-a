import { z } from 'zod';
import { Iso, Uuid } from './journal.js';

export const Consistency = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('latest_committed') }),
  z.object({ mode: z.literal('at_least_cursor'), cursor: z.number().int().nonnegative() }),
  z.object({ mode: z.literal('as_of'), effective_at: Iso.optional(), recorded_cutoff: z.number().int().nonnegative().optional() }),
  z.object({ mode: z.literal('stale_allowed') }),
]);
export type Consistency = z.infer<typeof Consistency>;

export const ResultStatus = z.enum(['complete', 'partial', 'insufficient_data', 'conflict', 'unsupported', 'projection_behind', 'denied']);

export const IntentId = z.enum([
  'inventory.available_to_sell', 'orders.fulfillable', 'orders.reservation_variance', 'orders.inbound_delay_impact',
  'shipments.attention', 'shipments.promise_risk', 'orders.partial_delivery_gaps', 'customer.delivery_reply',
  'invoices.outstanding', 'orders.missing_invoice', 'invoices.order_amount_variance', 'invoices.dispatch_evidence',
  'orders.payment_state', 'payments.recovered_attempts', 'invoices.payment_variance', 'receivables.review_queue',
  'providers.money_positions', 'payouts.gross_to_net', 'payouts.missing_bank_confirmation', 'providers.holds_and_releases',
  'returns.lifecycle', 'credits.refund_gaps', 'cancellations.outstanding_steps', 'refunds.chargeback_overlap',
]);
export type IntentId = z.infer<typeof IntentId>;

export const Pagination = z.object({ cursor: z.string().max(400).optional(), page_size: z.number().int().min(1).max(500).default(100) });

export const QueryRequest = z.object({
  intent: IntentId,
  parameters: z.record(z.unknown()).default({}),
  consistency: Consistency.default({ mode: 'latest_committed' }),
  pagination: Pagination.default({}),
});
export type QueryRequest = z.infer<typeof QueryRequest>;

export const Coverage = z.object({
  capability: z.string(), status: z.enum(['complete_for_declared_scope', 'partial', 'unknown', 'unavailable']),
  connection_id: Uuid.nullable().optional(), last_successful_sync_at: Iso.nullable().optional(), last_new_record_at: Iso.nullable().optional(),
  complete_through: Iso.nullable().optional(), note: z.string().optional(),
});

export const ResultEnvelope = z.object({
  intent: z.string().optional(),
  status: ResultStatus,
  result: z.unknown(),
  calculation: z.array(z.string()),
  rule_version: z.string(),
  evidence_entry_ids: z.array(Uuid),
  effective_at: Iso.nullable(),
  recorded_cutoff: z.number().int().nullable(),
  required_cursor: z.number().int().nullable(),
  applied_cursor: z.number().int().nullable(),
  coverage: z.array(Coverage),
  missing_inputs: z.array(z.string()),
  conflicts: z.array(z.object({ code: z.string(), detail: z.string(), entry_ids: z.array(Uuid).default([]) })),
  pagination: z.object({ next_cursor: z.string().nullable(), truncated: z.boolean(), snapshot_cursor: z.number().int().nullable() }),
  timing_ms: z.number().optional(),
});
export type ResultEnvelope = z.infer<typeof ResultEnvelope>;

/** Business-record traversal (list/search/history/state/evidence) shared by API and MCP. */
export const ListEntriesRequest = z.object({
  record_types: z.array(z.enum(['source', 'fact', 'commitment', 'movement', 'reservation'])).optional(),
  event_types: z.array(z.string()).optional(),
  entity: z.object({ type: z.string(), id: z.string() }).optional(),
  connection_id: Uuid.optional(),
  occurred_from: Iso.optional(), occurred_to: Iso.optional(),
  recorded_from: Iso.optional(), recorded_to: Iso.optional(),
  text: z.string().max(200).optional(),
  snapshot_cursor: z.number().int().optional(),
  after_sequence: z.number().int().optional(),
  page_size: z.number().int().min(1).max(500).default(100),
});
export type ListEntriesRequest = z.infer<typeof ListEntriesRequest>;

export const BusinessStateRequest = z.object({
  entity_type: z.enum(['order', 'item', 'invoice', 'transaction', 'payout', 'shipment', 'return', 'account', 'customer', 'hold', 'dispute', 'promise', 'bank_entry']),
  entity_id: z.string(),
  consistency: Consistency.default({ mode: 'latest_committed' }),
});

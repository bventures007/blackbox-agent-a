import { z } from 'zod';

export const SCHEMA_VERSION = 1;
export const RULE_VERSION = 'r1';

export const RecordType = z.enum(['source', 'fact', 'commitment', 'movement', 'reservation']);
export type RecordType = z.infer<typeof RecordType>;

export const Money = z.object({ minor: z.number().int(), currency: z.string().length(3) });
/** Decimal quantity as a string to avoid floating point drift; up to six fractional digits. */
export const Quantity = z.string().regex(/^-?\d{1,15}(\.\d{1,6})?$/);
export const Unit = z.string().min(1).max(32);
export const Iso = z.string().datetime({ offset: true });
export const Uuid = z.string().uuid();
export const Id = z.string().min(1).max(200);

export const EntityRef = z.object({ type: z.string().min(1).max(40), id: Id });
export type EntityRef = z.infer<typeof EntityRef>;

/** Source event families (typed observations) accepted at the ingestion boundary. */
export const SourceEventType = z.enum([
  'order.accepted', 'order.revised', 'order.cancelled',
  'inventory.snapshot', 'inventory.adjustment_observed',
  'inventory.reserved', 'inventory.reservation_released', 'allocation.revised',
  'supply.commitment_recorded', 'supply.commitment_revised',
  'customer.commitment_recorded', 'customer.commitment_revised',
  'shipment.observed', 'shipment.dispatched', 'shipment.delivered', 'shipment.cancelled',
  'carrier.scan_observed', 'carrier.forecast_observed',
  'communication.observed', 'communication.extraction_reviewed',
  'invoice.issued', 'invoice.revised', 'invoice.credit_issued', 'invoice.cancelled', 'invoice.payment_marked',
  'invoice.dispatch_observed',
  'payment.authorized', 'payment.captured', 'payment.failed', 'payment.voided',
  'payment.allocation_recorded', 'payment.allocation_revised',
  'business.rule_recorded', 'business.rule_revised',
  'business.case_recorded', 'business.case_revised',
  'provider.ledger_posted', 'payment.fee_booked', 'provider.balance_observed',
  'payout.announced', 'payout.sent', 'payout.failed', 'payout.reversed',
  'bank.credit_booked', 'bank.debit_booked', 'bank.match_recorded', 'bank.match_revised',
  'provider.hold_recorded', 'provider.hold_released', 'provider.release_promised',
  'return.approved', 'return.revised', 'return.cancelled',
  'return.received', 'return.restocked', 'return.disposition_observed',
  'refund.entitlement_recorded', 'refund.entitlement_revised',
  'refund.pending', 'refund.completed', 'refund.failed', 'refund.reversed',
  'dispute.opened', 'dispute.resolved', 'chargeback.debit_posted', 'chargeback.reversed',
  'coverage.observed', 'coverage.gap_recorded',
  'entity.link_recorded', 'entity.link_revised', 'entity.link_conflict',
  'review.decision_recorded',
]);
export type SourceEventType = z.infer<typeof SourceEventType>;

const base = { currency: z.string().length(3).optional() };
const line = z.object({ line_id: Id, item_id: Id, variant_id: Id.optional(), quantity: Quantity, unit: Unit,
  unit_gross_minor: z.number().int().optional(), line_net_minor: z.number().int().optional(), line_tax_minor: z.number().int().optional(),
  line_gross_minor: z.number().int(), discount_minor: z.number().int().optional() });

/** Payload schemas per source event type. Unknown keys are rejected to keep the permanent journal allowlisted. */
export const SourcePayloads: Record<SourceEventType, z.ZodTypeAny> = {
  'order.accepted': z.object({ order_id: Id, customer_id: Id.optional(), currency: z.string().length(3), lines: z.array(line).min(1),
    shipping_minor: z.number().int().optional(), gross_minor: z.number().int(), agreed_version: z.number().int().default(1), placed_at: Iso.optional() }).strict(),
  'order.revised': z.object({ order_id: Id, agreed_version: z.number().int(), currency: z.string().length(3), lines: z.array(line), gross_minor: z.number().int(), reason: z.string().max(200).optional() }).strict(),
  'order.cancelled': z.object({ order_id: Id, lines: z.array(z.object({ line_id: Id, quantity: Quantity })).optional(), full: z.boolean().default(true), reason: z.string().max(200).optional() }).strict(),
  'inventory.snapshot': z.object({ item_id: Id, location_id: Id.default('default'), unit: Unit, basis: z.enum(['physical_components', 'provider_available']).default('physical_components'),
    physical: Quantity.optional(), available: Quantity.optional(), committed: Quantity.optional(), reserved: Quantity.optional(), damaged: Quantity.optional(),
    safety_stock: Quantity.optional(), quality_control: Quantity.optional(), incoming: Quantity.optional(), observed_at: Iso.optional() }).strict(),
  'inventory.adjustment_observed': z.object({ item_id: Id, location_id: Id.default('default'), unit: Unit, physical_delta: Quantity, reason: z.string().max(120).optional() }).strict(),
  'inventory.reserved': z.object({ reservation_id: Id, order_id: Id, line_id: Id.optional(), item_id: Id, location_id: Id.default('default'), quantity: Quantity, unit: Unit, policy_version: z.string().optional() }).strict(),
  'inventory.reservation_released': z.object({ reservation_id: Id, quantity: Quantity, unit: Unit, reason: z.enum(['shipped', 'cancelled', 'expired', 'manual']) }).strict(),
  'allocation.revised': z.object({ reservation_id: Id, quantity: Quantity, unit: Unit, revision: z.number().int() }).strict(),
  'supply.commitment_recorded': z.object({ promise_id: Id, supplier_id: Id, item_id: Id, location_id: Id.default('default'), quantity: Quantity, unit: Unit, promised_at: Iso, timezone: z.string(), revision: z.number().int().default(1), allocation_links: z.array(Id).default([]) }).strict(),
  'supply.commitment_revised': z.object({ promise_id: Id, quantity: Quantity.optional(), unit: Unit.optional(), promised_at: Iso, timezone: z.string(), revision: z.number().int(), reason: z.string().max(200).optional() }).strict(),
  'customer.commitment_recorded': z.object({ promise_id: Id, order_id: Id, line_id: Id.optional(), promised_at: Iso, timezone: z.string(), promise_kind: z.enum(['delivery', 'dispatch']), revision: z.number().int().default(1), evidence_id: Id.optional() }).strict(),
  'customer.commitment_revised': z.object({ promise_id: Id, promised_at: Iso, timezone: z.string(), revision: z.number().int(), evidence_id: Id.optional() }).strict(),
  'shipment.observed': z.object({ shipment_id: Id, order_id: Id, lines: z.array(z.object({ line_id: Id, quantity: Quantity, unit: Unit })), carrier: z.string().optional(), tracking_number: z.string().optional(), state: z.enum(['label_created', 'in_transit', 'delivered', 'cancelled']), location_id: Id.optional() }).strict(),
  'shipment.dispatched': z.object({ shipment_id: Id, order_id: Id, lines: z.array(z.object({ line_id: Id, item_id: Id, quantity: Quantity, unit: Unit })), location_id: Id.default('default'),
    carrier: z.string().optional(), tracking_number: z.string().optional(), reservation_id: Id.optional(), handover_at: Iso.optional() }).strict(),
  'shipment.delivered': z.object({ shipment_id: Id, order_id: Id.optional(), delivered_at: Iso.optional(), carrier_status: z.string().optional() }).strict(),
  'shipment.cancelled': z.object({ shipment_id: Id, order_id: Id.optional(), reason: z.string().max(200).optional() }).strict(),
  'carrier.scan_observed': z.object({ carrier_service: z.string(), tracking_number: z.string(), scan_identity: Id, status_code: z.string(), effective_time: Iso, timezone: z.string().optional(), shipment_id: Id.optional() }).strict(),
  'carrier.forecast_observed': z.object({ carrier_service: z.string(), tracking_number: z.string(), forecast: Iso.nullable(), shipment_id: Id.optional() }).strict(),
  'communication.observed': z.object({ message_id: Id, customer_id: Id.optional(), order_id: Id.optional(), sent_at: Iso, actor: z.enum(['merchant', 'customer', 'system']), evidence_id: Id, visibility_scope: z.enum(['internal', 'customer']).default('internal') }).strict(),
  'communication.extraction_reviewed': z.object({ message_id: Id, reviewed_commitments: z.array(z.object({ promise_id: Id, promised_at: Iso, kind: z.enum(['delivery', 'dispatch', 'refund', 'other']) })), reviewer: z.string() }).strict(),
  'invoice.issued': z.object({ document_id: Id, invoice_id: Id, order_id: Id.optional(), customer_id: Id.optional(), currency: z.string().length(3), gross_minor: z.number().int(), due_date: z.string().date().optional(),
    line_links: z.array(z.object({ line_id: Id, quantity: Quantity.optional(), gross_minor: z.number().int().optional() })).default([]), revision: z.number().int().default(1), draft_state: z.enum(['draft', 'final']).default('final') }).strict(),
  'invoice.revised': z.object({ document_id: Id, invoice_id: Id, revision: z.number().int(), gross_minor: z.number().int(), currency: z.string().length(3), reason: z.string().max(200).optional() }).strict(),
  'invoice.credit_issued': z.object({ document_id: Id, invoice_id: Id, credit_id: Id, currency: z.string().length(3), credit_minor: z.number().int().positive(), cash_refund_confirmed: z.boolean().default(false) }).strict(),
  'invoice.cancelled': z.object({ document_id: Id, invoice_id: Id, reason: z.string().max(200).optional() }).strict(),
  'invoice.payment_marked': z.object({ invoice_id: Id, transaction_id: Id.optional(), paid_minor: z.number().int(), currency: z.string().length(3), is_new_cash_movement: z.literal(false).default(false), marked_at: Iso.optional() }).strict(),
  'invoice.dispatch_observed': z.object({ dispatch_id: Id, document_id: Id, channel: z.string(), status: z.enum(['sent', 'pending', 'error']), processed_at: Iso.optional(), source_scope: z.string().optional() }).strict(),
  'payment.authorized': z.object({ transaction_id: Id, order_id: Id, account_id: Id.optional(), gateway: z.string().optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), test: z.boolean().default(false) }).strict(),
  'payment.captured': z.object({ transaction_id: Id, parent_transaction_id: Id.optional(), order_id: Id, account_id: Id.optional(), gateway: z.string().optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), test: z.boolean().default(false), economic_effect_id: Id.optional() }).strict(),
  'payment.failed': z.object({ transaction_id: Id, order_id: Id, amount_minor: z.number().int(), currency: z.string().length(3), kind: z.enum(['authorization', 'capture', 'sale']).default('sale'), error_code: z.string().optional() }).strict(),
  'payment.voided': z.object({ transaction_id: Id, parent_transaction_id: Id, order_id: Id, amount_minor: z.number().int(), currency: z.string().length(3) }).strict(),
  'payment.allocation_recorded': z.object({ allocation_id: Id, invoice_id: Id, transaction_id: Id, amount_minor: z.number().int(), currency: z.string().length(3), confidence: z.enum(['confirmed', 'proposed']).default('confirmed'), revision: z.number().int().default(1), evidence_id: Id.optional() }).strict(),
  'payment.allocation_revised': z.object({ allocation_id: Id, amount_minor: z.number().int(), currency: z.string().length(3), revision: z.number().int(), confidence: z.enum(['confirmed', 'proposed', 'rejected']) }).strict(),
  'business.rule_recorded': z.object({ rule_id: Id, rule_kind: z.enum(['allocation_priority', 'invoicing_trigger', 'delivery_risk', 'reminder_policy', 'attention_policy']), version: z.number().int(), effective_from: Iso, scope: z.string().default('workspace'),
    priority_method: z.string().optional(), invoicing_trigger: z.string().optional(), tolerance: z.record(z.unknown()).optional(), currency: z.string().length(3).optional(), timezone: z.string().optional(), reminder_policy: z.string().optional() }).strict(),
  'business.rule_revised': z.object({ rule_id: Id, version: z.number().int(), effective_from: Iso, changes: z.record(z.unknown()) }).strict(),
  'business.case_recorded': z.object({ case_id: Id, customer_id: Id.optional(), invoice_id: Id.optional(), transaction_id: Id.optional(), status: z.enum(['open', 'extension_agreed', 'disputed', 'closed']), agreed_extension_until: z.string().date().optional(), evidence_id: Id.optional() }).strict(),
  'business.case_revised': z.object({ case_id: Id, status: z.enum(['open', 'extension_agreed', 'disputed', 'closed']), agreed_extension_until: z.string().date().optional() }).strict(),
  'provider.ledger_posted': z.object({ ledger_entry_id: Id, account_id: Id, source_transaction_id: Id.optional(), order_id: Id.optional(), payout_id: Id.optional(), posting_type: z.enum(['charge', 'refund', 'fee', 'adjustment', 'dispute', 'dispute_reversal', 'transfer', 'reserve']),
    gross_minor: z.number().int(), fee_minor: z.number().int().default(0), net_minor: z.number().int(), currency: z.string().length(3), effective_time: Iso.optional() }).strict(),
  'payment.fee_booked': z.object({ transaction_id: Id, account_id: Id.optional(), fee_minor: z.number().int(), currency: z.string().length(3), ledger_entry_id: Id.optional() }).strict(),
  'provider.balance_observed': z.object({ account_id: Id, currency: z.string().length(3), observed_at: Iso, total_minor: z.number().int().optional(), processing_minor: z.number().int().optional(), available_minor: z.number().int().optional(), held_minor: z.number().int().optional(), coverage: z.enum(['complete_partition', 'total_only', 'partial']) }).strict(),
  'payout.announced': z.object({ payout_id: Id, account_id: Id.optional(), amount_minor: z.number().int(), currency: z.string().length(3), expected_at: Iso.optional(), trace_reference: z.string().optional() }).strict(),
  'payout.sent': z.object({ payout_id: Id, account_id: Id.optional(), amount_minor: z.number().int(), currency: z.string().length(3), issued_at: Iso.optional(), trace_reference: z.string().optional(), ledger_membership: z.array(Id).optional() }).strict(),
  'payout.failed': z.object({ payout_id: Id, reason: z.string().max(200).optional() }).strict(),
  'payout.reversed': z.object({ payout_id: Id, reversal_id: Id, amount_minor: z.number().int(), currency: z.string().length(3) }).strict(),
  'bank.credit_booked': z.object({ entry_id: Id, statement_id: Id.optional(), account_id: Id.default('bank'), booked_at: Iso.optional(), value_at: Iso.optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), reference: z.string().optional(), payout_id: Id.optional(), booking_status: z.enum(['booked', 'pending']).default('booked') }).strict(),
  'bank.debit_booked': z.object({ entry_id: Id, statement_id: Id.optional(), account_id: Id.default('bank'), booked_at: Iso.optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), reference: z.string().optional(), booking_status: z.enum(['booked', 'pending']).default('booked') }).strict(),
  'bank.match_recorded': z.object({ entry_id: Id, payout_id: Id, confidence: z.enum(['confirmed', 'proposed']), evidence_id: Id.optional() }).strict(),
  'bank.match_revised': z.object({ entry_id: Id, payout_id: Id.nullable(), confidence: z.enum(['confirmed', 'proposed', 'rejected']) }).strict(),
  'provider.hold_recorded': z.object({ hold_id: Id, account_id: Id, transaction_id: Id.optional(), currency: z.string().length(3), amount_minor: z.number().int().positive(), reason: z.string().max(120) }).strict(),
  'provider.hold_released': z.object({ hold_id: Id, amount_minor: z.number().int().positive(), currency: z.string().length(3), released_at: Iso.optional() }).strict(),
  'provider.release_promised': z.object({ hold_id: Id, release_promised_at: Iso }).strict(),
  'return.approved': z.object({ return_id: Id, order_id: Id, lines: z.array(z.object({ line_id: Id.optional(), item_id: Id, quantity: Quantity, unit: Unit })), expected_credit_minor: z.number().int().optional(), currency: z.string().length(3).optional(), reverse_shipment_id: Id.optional() }).strict(),
  'return.revised': z.object({ return_id: Id, lines: z.array(z.object({ line_id: Id.optional(), item_id: Id, quantity: Quantity, unit: Unit })) }).strict(),
  'return.cancelled': z.object({ return_id: Id, reason: z.string().max(200).optional() }).strict(),
  'return.received': z.object({ receipt_id: Id, return_id: Id, item_id: Id, location_id: Id.default('default'), quantity: Quantity, unit: Unit, disposition: z.enum(['quarantine', 'restocked', 'damaged', 'missing']).default('quarantine') }).strict(),
  'return.restocked': z.object({ receipt_id: Id, return_id: Id, item_id: Id, location_id: Id.default('default'), quantity: Quantity, unit: Unit }).strict(),
  'return.disposition_observed': z.object({ receipt_id: Id, return_id: Id, item_id: Id, quantity: Quantity, unit: Unit, disposition: z.enum(['restocked', 'damaged', 'missing', 'not_restocked']) }).strict(),
  'refund.entitlement_recorded': z.object({ entitlement_id: Id, order_id: Id.optional(), invoice_id: Id.optional(), credit_id: Id.optional(), original_transaction_id: Id, amount_minor: z.number().int().positive(), currency: z.string().length(3), destination: z.enum(['original_payment', 'store_credit', 'bank_transfer']), approved_at: Iso.optional() }).strict(),
  'refund.entitlement_revised': z.object({ entitlement_id: Id, amount_minor: z.number().int(), currency: z.string().length(3), state: z.enum(['approved', 'withdrawn']) }).strict(),
  'refund.pending': z.object({ refund_id: Id, original_transaction_id: Id, order_id: Id.optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), destination: z.enum(['original_payment', 'store_credit', 'bank_transfer']).default('original_payment') }).strict(),
  'refund.completed': z.object({ refund_id: Id, original_transaction_id: Id, order_id: Id.optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), economic_effect_id: Id.optional() }).strict(),
  'refund.failed': z.object({ refund_id: Id, original_transaction_id: Id, amount_minor: z.number().int(), currency: z.string().length(3), error_code: z.string().optional() }).strict(),
  'refund.reversed': z.object({ refund_id: Id, original_transaction_id: Id, amount_minor: z.number().int(), currency: z.string().length(3) }).strict(),
  'dispute.opened': z.object({ dispute_id: Id, original_transaction_id: Id, order_id: Id.optional(), amount_minor: z.number().int().positive(), currency: z.string().length(3), reason: z.string().max(120).optional() }).strict(),
  'dispute.resolved': z.object({ dispute_id: Id, outcome: z.enum(['won', 'lost', 'withdrawn']) }).strict(),
  'chargeback.debit_posted': z.object({ dispute_id: Id, debit_posting_id: Id, original_transaction_id: Id, debit_minor: z.number().int().positive(), fee_minor: z.number().int().default(0), currency: z.string().length(3) }).strict(),
  'chargeback.reversed': z.object({ dispute_id: Id, reversal_posting_id: Id, reversal_minor: z.number().int().positive(), currency: z.string().length(3) }).strict(),
  'coverage.observed': z.object({ capability: z.string(), entity_scope: z.string(), history_start: Iso.nullable(), complete_through: Iso.nullable(), backfill_complete: z.boolean(), coverage_basis: z.string(), missing_fields: z.array(z.string()).default([]) }).strict(),
  'coverage.gap_recorded': z.object({ capability: z.string(), from: Iso, to: Iso.nullable(), reason: z.string() }).strict(),
  'entity.link_recorded': z.object({ entity_type: z.string(), entity_id: Id, relationship_type: z.string(), target_type: z.string(), target_id: Id, confidence: z.enum(['confirmed', 'proposed']), revision: z.number().int().default(1), evidence_id: Id.optional() }).strict(),
  'entity.link_revised': z.object({ entity_type: z.string(), entity_id: Id, relationship_type: z.string(), target_type: z.string(), target_id: Id.nullable(), confidence: z.enum(['confirmed', 'proposed', 'rejected']), revision: z.number().int() }).strict(),
  'entity.link_conflict': z.object({ entity_type: z.string(), entity_id: Id, relationship_type: z.string(), candidates: z.array(Id), reason: z.string() }).strict(),
  'review.decision_recorded': z.object({ case_id: Id, decision: z.enum(['confirm_link', 'reject_link', 'retry', 'manual_assertion', 'leave_unresolved']), reason: z.string().max(500), actor_kind: z.literal('owner'), asserted: z.record(z.unknown()).optional() }).strict(),
};

export const JournalEntryInput = z.object({
  entry_id: Uuid.optional(),
  record_type: RecordType,
  record_id: Id,
  event_type: z.string().min(1).max(80),
  schema_version: z.number().int().default(SCHEMA_VERSION),
  connection_id: Uuid.nullable().optional(),
  provider_namespace: z.string().max(200).nullable().optional(),
  dedup_key: z.string().min(1).max(300),
  occurred_at: Iso,
  entity_refs: z.array(EntityRef).default([]),
  payload: z.record(z.unknown()),
  evidence_refs: z.array(Id).default([]),
  input_entry_ids: z.array(Uuid).default([]),
  rule_version: z.string().optional(),
  supersedes_entry_id: Uuid.optional(),
  correlation_id: z.string().max(200).optional(),
  causation_id: z.string().max(200).optional(),
});
export type JournalEntryInput = z.infer<typeof JournalEntryInput>;

export const JournalEntry = JournalEntryInput.extend({
  entry_id: Uuid,
  tenant_id: Uuid,
  journal_sequence: z.number().int(),
  recorded_at: Iso,
  payload_hash: z.string(),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

/** Validate a source observation payload against its event family. Returns the parsed (defaulted) payload. */
export function parseSourcePayload(eventType: string, payload: unknown): Record<string, unknown> {
  const type = SourceEventType.parse(eventType);
  return SourcePayloads[type].parse(payload) as Record<string, unknown>;
}

/** Derive the entity references a source observation links to. Shared with adapters so joins stay explicit. */
export function entityRefsFor(eventType: SourceEventType, p: Record<string, unknown>): EntityRef[] {
  const refs: EntityRef[] = [];
  const add = (type: string, id: unknown) => { if (typeof id === 'string' && id) refs.push({ type, id }); };
  add('order', p.order_id); add('customer', p.customer_id); add('item', p.item_id); add('invoice', p.invoice_id);
  add('document', p.document_id); add('transaction', p.transaction_id); add('transaction', p.original_transaction_id);
  add('transaction', p.parent_transaction_id); add('payout', p.payout_id); add('shipment', p.shipment_id);
  add('reservation', p.reservation_id); add('return', p.return_id); add('refund', p.refund_id); add('dispute', p.dispute_id);
  add('hold', p.hold_id); add('bank_entry', p.entry_id); add('promise', p.promise_id); add('rule', p.rule_id); add('case', p.case_id);
  add('credit', p.credit_id); add('entitlement', p.entitlement_id); add('message', p.message_id); add('account', p.account_id);
  add('ledger_entry', p.ledger_entry_id); add('tracking', p.tracking_number); add('allocation', p.allocation_id);
  if (Array.isArray(p.lines)) for (const l of p.lines as Array<Record<string, unknown>>) { add('item', l.item_id); add('line', l.line_id); }
  if (eventType === 'entity.link_recorded' || eventType === 'entity.link_revised' || eventType === 'entity.link_conflict') {
    add(String(p.entity_type), p.entity_id); if (p.target_type) add(String(p.target_type), p.target_id);
  }
  const seen = new Set<string>();
  return refs.filter((r) => { const k = `${r.type}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

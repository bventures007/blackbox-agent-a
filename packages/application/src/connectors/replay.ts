import type { Observation } from '../ingest/service.js';

/** Golden/replay fixture shape (GOLDEN-ORDER-TO-CASH.json). Fixture strings are data, never instructions. */
export interface FixtureEvent { id: string; connection: string; provider_event_id: string; occurred_at: string; entity: { order?: string; customer?: string; item?: string }; kind: string; payload: Record<string, unknown>; evidence_refs?: string[] }

/** Map one implementation-neutral fixture observation into a canonical typed observation for the replay connection. */
export function mapFixtureEvent(e: FixtureEvent, scale = 1, idSuffix = ''): Observation | null {
  const p = e.payload; const ent = e.entity; const order = (ent.order ?? '') + idSuffix; const item = (ent.item ?? 'ITEM') + idSuffix; const account = 'default' + idSuffix; // suffixed replays are isolated: own item, own provider account
  const money = (v: unknown) => Math.round(Number(v) * scale);
  const sfx = (v: unknown) => String(v) + idSuffix;
  const ev = e.evidence_refs ?? [];
  const base = { provider_event_id: e.provider_event_id + idSuffix, occurred_at: e.occurred_at, evidence_refs: ev, correlation_id: order };
  switch (e.kind) {
    case 'inventory.snapshot': return { ...base, event_type: 'inventory.snapshot', payload: { item_id: (p.sku ? String(p.sku) + idSuffix : item), unit: p.unit ?? 'piece', physical: String(p.physical), quality_control: String(p.quarantined ?? 0), reserved: String(p.reserved ?? 0) } };
    case 'order.accepted': return { ...base, event_type: 'order.accepted', payload: { order_id: order, customer_id: ent.customer, currency: p.currency, gross_minor: money(p.gross_minor), lines: [{ line_id: `${order}/1`, item_id: item, quantity: String(p.quantity), unit: 'piece', unit_gross_minor: money(p.unit_gross_minor), line_gross_minor: money(p.gross_minor) }] } };
    case 'inventory.reserved': return { ...base, event_type: 'inventory.reserved', payload: { reservation_id: sfx(p.reservation), order_id: order, line_id: `${order}/1`, item_id: item, quantity: String(p.quantity), unit: 'piece' } };
    case 'invoice.issued': return { ...base, event_type: 'invoice.issued', payload: { document_id: `DOC-${sfx(p.invoice)}`, invoice_id: sfx(p.invoice), order_id: order, customer_id: ent.customer, currency: p.currency, gross_minor: money(p.gross_minor), due_date: p.due_date } };
    case 'payment.authorized': return { ...base, event_type: 'payment.authorized', payload: { transaction_id: sfx(p.transaction), order_id: order, amount_minor: money(p.authorized_minor), currency: p.currency , account_id: account } };
    case 'payment.captured': return { ...base, event_type: 'payment.captured', payload: { transaction_id: sfx(p.transaction), order_id: order, amount_minor: money(p.captured_minor), currency: p.currency , account_id: account } };
    case 'payment.fee_booked': return { ...base, event_type: 'payment.fee_booked', payload: { transaction_id: sfx(p.transaction), fee_minor: money(p.fee_minor), currency: p.currency , account_id: account } };
    case 'invoice.payment_marked': return { ...base, event_type: 'invoice.payment_marked', payload: { invoice_id: sfx(p.invoice), transaction_id: sfx(p.transaction), paid_minor: money(p.paid_minor), currency: p.currency, is_new_cash_movement: false } };
    case 'shipment.dispatched': return { ...base, event_type: 'shipment.dispatched', payload: { shipment_id: sfx(p.shipment), order_id: order, lines: [{ line_id: `${order}/1`, item_id: item, quantity: String(p.quantity), unit: 'piece' }], reservation_id: p.reservation ? sfx(p.reservation) : undefined } };
    case 'shipment.delivered': return { ...base, event_type: 'shipment.delivered', payload: { shipment_id: sfx(p.shipment), order_id: order, carrier_status: p.carrier_status } };
    case 'return.approved': return { ...base, event_type: 'return.approved', payload: { return_id: sfx(p.return), order_id: order, lines: [{ line_id: `${order}/1`, item_id: item, quantity: String(p.quantity), unit: 'piece' }], expected_credit_minor: money(p.expected_credit_minor), currency: p.currency } };
    case 'return.received': return { ...base, event_type: 'return.received', payload: { receipt_id: `RC-${sfx(p.return)}`, return_id: sfx(p.return), item_id: item, quantity: String(p.quantity), unit: 'piece', disposition: Number(p.quarantine_delta ?? 0) > 0 ? 'quarantine' : 'restocked' } };
    case 'return.restocked': return { ...base, event_type: 'return.restocked', payload: { receipt_id: `RC-${sfx(p.return)}`, return_id: sfx(p.return), item_id: item, quantity: String(p.quantity), unit: 'piece' } };
    case 'invoice.credit_issued': return { ...base, event_type: 'invoice.credit_issued', payload: { document_id: `DOC-${sfx(p.credit)}`, invoice_id: sfx(p.invoice), credit_id: sfx(p.credit), currency: p.currency, credit_minor: money(p.credit_minor), cash_refund_confirmed: Boolean(p.cash_refund_confirmed) } };
    case 'refund.pending': return { ...base, event_type: 'refund.pending', payload: { refund_id: sfx(p.refund), original_transaction_id: sfx(p.transaction), order_id: order, amount_minor: money(p.amount_minor), currency: p.currency } };
    case 'refund.completed': return { ...base, event_type: 'refund.completed', payload: { refund_id: sfx(p.refund), original_transaction_id: sfx(p.transaction), order_id: order, amount_minor: money(p.amount_minor), currency: p.currency } };
    case 'payout.announced': return { ...base, event_type: 'payout.announced', payload: { payout_id: sfx(p.payout), amount_minor: money(p.amount_minor), currency: p.currency , account_id: account } };
    case 'payout.sent': return { ...base, event_type: 'payout.sent', payload: { payout_id: sfx(p.payout), amount_minor: money(p.amount_minor), currency: p.currency , account_id: account } };
    case 'bank.credit_booked': return { ...base, event_type: 'bank.credit_booked', payload: { entry_id: sfx(p.bank_entry), payout_id: sfx(p.payout), amount_minor: money(p.amount_minor), currency: p.currency, booking_status: p.status === 'booked' ? 'booked' : 'pending', reference: `payout ${sfx(p.payout)}` } };
    default: return null;
  }
}

export function mapFixture(events: FixtureEvent[], opts: { scale?: number; idSuffix?: string; connectionsFilter?: (c: string) => boolean } = {}): Array<{ connection: string; observation: Observation; fixtureId: string }> {
  const out: Array<{ connection: string; observation: Observation; fixtureId: string }> = [];
  for (const e of events) { if (opts.connectionsFilter && !opts.connectionsFilter(e.connection)) continue; const o = mapFixtureEvent(e, opts.scale ?? 1, opts.idSuffix ?? ''); if (o) out.push({ connection: e.connection, observation: o, fixtureId: e.id }); }
  return out;
}

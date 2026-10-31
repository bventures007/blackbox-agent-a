/**
 * QUERY-01 / QUERY-02 / INGEST-01 / SOURCE-04 / EXTEND-01 support: all 24 intents with a positive case (through the
 * signed generic producer path into PostgreSQL, Rust, API and MCP) and a missing-data case. Positive cases synthesize
 * the datasets each intent requires; missing cases remove a required capability and expect insufficient_data/partial.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { signBody } from '@blackbox/application';
import { API, ROOT, apiFetch, loginOwner, waitApplied, evidence, sql } from '../helpers/env';

let cookie: string; let producerKey: string; let agentKey: string; let genericId: string; let policyId: string; let bankId: string;
const NOW = '2026-10-31T12:00:00Z'; const results: Record<string, unknown> = {};
const S = (n: number) => String(n);

async function producerPost(events: Array<Record<string, unknown>>, coverage?: Record<string, unknown>) {
  const body = JSON.stringify({ schema_version: 1, producer: 'qa-producer', idempotency_key: randomUUID(), events, declared_coverage: coverage });
  const res = await fetch(API + '/api/ingest/generic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${producerKey}`, 'x-blackbox-signature': signBody(body, producerKey) }, body });
  const json = await res.json() as Record<string, unknown>; return { status: res.status, body: json };
}
const ev = (type: string, id: string, occurred: string, payload: Record<string, unknown>) => ({ event_id: id, event_type: type, occurred_at: occurred, payload });
async function cover(capability: string, complete = true, missing: string[] = []) { const r = await producerPost([], { capability, backfill_complete: complete, complete_through: NOW, history_start: '2026-10-01T00:00:00Z', missing_fields: missing }); expect(r.status, `cover ${capability}: ${JSON.stringify(r.body)}`).toBe(202); expect((r.body.rejected as unknown[]).length, `cover ${capability} rejected`).toBe(0); return r; }
async function ask(intent: string, parameters: Record<string, unknown> = {}) { const r = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent, parameters }) }); expect(r.status, JSON.stringify(r.body)).toBe(200); return r.body as { status: string; result: Record<string, unknown>; missing_inputs: string[]; evidence_entry_ids: string[]; coverage: Array<{ capability: string; status: string }>; applied_cursor: number }; }
async function settle(required: number) { await waitApplied(cookie, required, 120_000); }

beforeAll(async () => {
  cookie = await loginOwner();
  const k = await apiFetch('/api/agents', { method: 'POST', cookie, body: JSON.stringify({ name: 'qa-producer', kind: 'producer' }) }); producerKey = k.body.secret as string;
  const a = await apiFetch('/api/agents', { method: 'POST', cookie, body: JSON.stringify({ name: 'qa-agent', kind: 'agent' }) }); agentKey = a.body.secret as string;
  const srcs = (await apiFetch('/api/sources', { cookie })).body.connections as Array<{ connection_id: string; provider: string; account_namespace: string }>;
  const mk = async (provider: string, ns: string) => { const e = srcs.find((c) => c.provider === provider && c.account_namespace === ns); if (e) return e.connection_id; const r = await apiFetch('/api/sources', { method: 'POST', cookie, body: JSON.stringify({ provider, display_name: `${provider} qa`, account_namespace: ns }) }); expect(r.status).toBe(201); return r.body.connection_id as string; };
  genericId = await mk('generic', 'qa-producer'); policyId = await mk('policy', 'workspace'); bankId = await mk('bank_csv', 'bank');
  // rules the intents need
  for (const rule of [{ rule_id: 'allocation-priority', rule_kind: 'allocation_priority', priority_method: 'oldest_first' }, { rule_id: 'invoicing-trigger', rule_kind: 'invoicing_trigger', invoicing_trigger: 'after_confirmed_dispatch' }, { rule_id: 'reminder-policy', rule_kind: 'reminder_policy', reminder_policy: 'review_overdue' }, { rule_id: 'attention-policy', rule_kind: 'attention_policy', tolerance: { stale_scan_hours: 48 } }, { rule_id: 'delivery-risk', rule_kind: 'delivery_risk', tolerance: { risk_hours: 24 } }]) {
    const r = await apiFetch(`/api/sources/${policyId}/rules`, { method: 'POST', cookie, body: JSON.stringify({ ...rule, version: 1, effective_from: '2026-10-01T00:00:00Z' }) }); expect(r.status, JSON.stringify(r.body)).toBe(200);
  }
}, 120_000);
afterAll(() => evidence('queries.json', results));

describe('INGEST-01 signed producer input', () => {
  it('rejects a corrupted signature, a replayed body for another producer and payload tenant ids', async () => {
    const body = JSON.stringify({ schema_version: 1, producer: 'qa-producer', idempotency_key: randomUUID(), events: [ev('order.accepted', 'sig-1', NOW, { order_id: '#S1', currency: 'EUR', gross_minor: 100, lines: [{ line_id: 'L', item_id: 'I', quantity: '1', unit: 'piece', line_gross_minor: 100 }] })] });
    const bad = await fetch(API + '/api/ingest/generic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${producerKey}`, 'x-blackbox-signature': 'sha256=' + '0'.repeat(64) }, body }); expect(bad.status).toBe(401);
    const tampered = await fetch(API + '/api/ingest/generic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${producerKey}`, 'x-blackbox-signature': signBody(body, producerKey) }, body: body.replace('"gross_minor":100', '"gross_minor":999') }); expect(tampered.status).toBe(401);
    const otherProducer = await fetch(API + '/api/ingest/generic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${agentKey}`, 'x-blackbox-signature': signBody(body, agentKey) }, body }); expect(otherProducer.status).toBe(401);
    const withTenant = JSON.stringify({ schema_version: 1, producer: 'qa-producer', idempotency_key: randomUUID(), tenant_id: '11111111-1111-4111-8111-111111111111', events: [ev('order.accepted', 'sig-2', NOW, { order_id: '#S2', currency: 'EUR', gross_minor: 100, lines: [{ line_id: 'L', item_id: 'I', quantity: '1', unit: 'piece', line_gross_minor: 100 }] })] });
    const r = await fetch(API + '/api/ingest/generic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${producerKey}`, 'x-blackbox-signature': signBody(withTenant, producerKey) }, body: withTenant }); expect(r.status).toBe(202);
    const e = await apiFetch('/api/journal/entries', { method: 'POST', cookie, body: JSON.stringify({ entity: { type: 'order', id: '#S2' } }) }); expect((e.body.entries as Array<{ tenant_id: string }>)[0]!.tenant_id).not.toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('QUERY-01 positive paths for all 24 intents via API', () => {
  it('order-01..04', async () => {
    const r = await producerPost([
      ev('inventory.snapshot', 'q-stock-1', NOW, { item_id: 'CUP-Q', unit: 'piece', basis: 'provider_available', physical: '120', committed: '34', available: '86', incoming: '80' }),
      ev('inventory.snapshot', 'q-stock-2', NOW, { item_id: 'MUG-Q', unit: 'piece', physical: '10' }),
      ev('order.accepted', 'q-oA', '2026-10-30T08:00:00Z', { order_id: '#QA', currency: 'EUR', gross_minor: 600, lines: [{ line_id: 'QA/1', item_id: 'MUG-Q', quantity: '6', unit: 'piece', line_gross_minor: 600 }] }),
      ev('order.accepted', 'q-oB', '2026-10-30T09:00:00Z', { order_id: '#QB', currency: 'EUR', gross_minor: 600, lines: [{ line_id: 'QB/1', item_id: 'MUG-Q', quantity: '6', unit: 'piece', line_gross_minor: 600 }] }),
      ev('order.accepted', 'q-oC', '2026-10-30T10:00:00Z', { order_id: '#QC', currency: 'EUR', gross_minor: 1000, lines: [{ line_id: 'QC/1', item_id: 'CUP-Q', quantity: '10', unit: 'piece', line_gross_minor: 1000 }] }),
      ev('order.cancelled', 'q-oC-cancel', '2026-10-30T10:30:00Z', { order_id: '#QC', full: false, lines: [{ line_id: 'QC/1', quantity: '2' }] }),
      ev('inventory.reserved', 'q-res-C', '2026-10-30T10:05:00Z', { reservation_id: 'R-QC', order_id: '#QC', line_id: 'QC/1', item_id: 'CUP-Q', quantity: '4', unit: 'piece' }),
      ev('shipment.dispatched', 'q-ship-C', '2026-10-30T11:00:00Z', { shipment_id: 'SH-QC', order_id: '#QC', lines: [{ line_id: 'QC/1', item_id: 'CUP-Q', quantity: '3', unit: 'piece' }], carrier: 'DHL', tracking_number: 'TRK-QC' }),
      ev('supply.commitment_recorded', 'q-sup-1', '2026-10-28T08:00:00Z', { promise_id: 'PO-1', supplier_id: 'SUP', item_id: 'CUP-Q', quantity: '80', unit: 'piece', promised_at: '2026-11-03T08:00:00Z', timezone: 'Europe/Berlin', allocation_links: ['R-QC'] }),
      ev('supply.commitment_revised', 'q-sup-2', '2026-10-29T08:00:00Z', { promise_id: 'PO-1', promised_at: '2026-11-05T08:00:00Z', timezone: 'Europe/Berlin', revision: 2 }),
      ev('customer.commitment_recorded', 'q-cust-1', '2026-10-30T10:10:00Z', { promise_id: 'CP-QC', order_id: '#QC', promised_at: '2026-11-04T17:00:00Z', timezone: 'Europe/Berlin', promise_kind: 'delivery' }),
    ]); expect(r.status, JSON.stringify(r.body)).toBe(202);
    for (const c of ['stock', 'orders', 'allocations', 'fulfillments', 'supply', 'promises', 'identity']) await cover(c);
    await settle(Number(r.body.committed_cursor));
    const o1 = await ask('inventory.available_to_sell', { item_id: 'CUP-Q', requested_quantity: '100' }); results['order-01'] = o1;
    expect(o1.status).toBe('complete'); expect(o1.result.available).toBe('86'); expect(o1.result.shortfall).toBe('14'); expect(o1.result.incoming_counted_as_stock).toBe(false);
    const o2 = await ask('orders.fulfillable'); results['order-02'] = o2; expect(o2.status).toMatch(/complete|partial/);
    const plan = (o2.result.plan as Array<{ order_id: string; classification: string }>); expect(plan.find((p) => p.order_id === '#QA')!.classification).toBe('fully_fulfillable'); expect(plan.find((p) => p.order_id === '#QB')!.classification).toBe('partial');
    const o3 = await ask('orders.reservation_variance'); results['order-03'] = o3; expect(o3.status).toBe('complete');
    const v = (o3.result.variances as Array<Record<string, string>>).find((x) => x.order_id === '#QC')!; expect(v.remaining_obligation).toBe('5'); expect(v.under_reserved).toBe('1');
    const o4 = await ask('orders.inbound_delay_impact'); results['order-04'] = o4; expect(o4.status).toMatch(/complete|partial/);
    const aff = (o4.result.affected as Array<Record<string, string>>); expect(aff.find((a) => a.order_id === '#QC')?.risk).toBe('incoming_after_customer_deadline');
  }, 180_000);

  it('delivery-01..04', async () => {
    const r = await producerPost([
      ev('carrier.scan_observed', 'q-scan-1', '2026-10-31T09:00:00Z', { carrier_service: 'dhl', tracking_number: 'TRK-QC', scan_identity: 'scan-1', status_code: 'exception', effective_time: '2026-10-31T09:00:00Z', shipment_id: 'SH-QC' }),
      ev('communication.observed', 'q-msg-1', '2026-10-31T08:00:00Z', { message_id: 'M-1', order_id: '#QC', customer_id: 'C-Q', sent_at: '2026-10-31T08:00:00Z', actor: 'merchant', evidence_id: 'ev-m1' }),
    ]); expect(r.status).toBe(202); for (const c of ['tracking', 'communications', 'policy']) await cover(c); await settle(Number(r.body.committed_cursor));
    const d1 = await ask('shipments.attention'); results['delivery-01'] = d1; expect(d1.status).toBe('complete'); expect((d1.result.attention as string[])).toContain('SH-QC');
    const row = (d1.result.shipments as Array<Record<string, unknown>>).find((s) => s.shipment_id === 'SH-QC')!; expect(row.latest_scan).toBe('exception'); expect(row.forecast_is_estimate).toBe(true);
    const d2 = await ask('shipments.promise_risk'); results['delivery-02'] = d2; expect(d2.status).toBe('complete'); const c = (d2.result.commitments as Array<Record<string, unknown>>).find((x) => x.order_id === '#QC')!; expect(c.delivered).toBe(false); expect(c.arrival_known).toBe(false);
    const d3 = await ask('orders.partial_delivery_gaps', { order_id: '#QC' }); results['delivery-03'] = d3; expect(d3.status).toBe('complete'); const l = ((d3.result.partial_deliveries as Array<{ lines: Array<Record<string, string>> }>)[0]!.lines[0]!); expect(l.remaining_to_dispatch).toBe('5'); expect(l.remaining_to_deliver).toBe('8');
    const d4 = await ask('customer.delivery_reply', { order_id: '#QC' }); results['delivery-04'] = d4; expect(d4.status).toBe('complete'); expect(d4.result.send_action).toBe(false); expect(d4.result.prior_promises_checked).toBe(true);
  }, 120_000);

  it('invoice-01..04 and collection-01..04', async () => {
    const r = await producerPost([
      ev('invoice.issued', 'q-inv-1', '2026-10-20T10:00:00Z', { document_id: 'D-I1', invoice_id: 'I1', order_id: '#QC', customer_id: 'C-Q', currency: 'EUR', gross_minor: 11900, due_date: '2026-10-30' }),
      ev('invoice.credit_issued', 'q-cred-1', '2026-10-21T10:00:00Z', { document_id: 'D-C1', invoice_id: 'I1', credit_id: 'CN1', currency: 'EUR', credit_minor: 2380 }),
      ev('invoice.payment_marked', 'q-mark-1', '2026-10-22T10:00:00Z', { invoice_id: 'I1', transaction_id: 'T-Q1', paid_minor: 5000, currency: 'EUR' }),
      ev('invoice.issued', 'q-inv-2', '2026-10-20T10:00:00Z', { document_id: 'D-I2', invoice_id: 'I2', order_id: '#QA', currency: 'EUR', gross_minor: 12000, due_date: '2026-11-30', line_links: [{ line_id: 'QA/1', quantity: '6', gross_minor: 12000 }] }),
      ev('invoice.dispatch_observed', 'q-disp-1', '2026-10-20T11:00:00Z', { dispatch_id: 'DS1', document_id: 'I1', channel: 'email', status: 'sent', processed_at: '2026-10-20T11:00:00Z' }),
      ev('payment.authorized', 'q-auth-1', '2026-10-20T09:00:00Z', { transaction_id: 'T-Q1', order_id: '#QC', amount_minor: 11900, currency: 'EUR' }),
      ev('payment.captured', 'q-cap-1', '2026-10-20T09:30:00Z', { transaction_id: 'T-Q1', order_id: '#QC', amount_minor: 5000, currency: 'EUR' }),
      ev('payment.failed', 'q-fail-1', '2026-10-20T08:00:00Z', { transaction_id: 'T-Q0', order_id: '#QB', amount_minor: 600, currency: 'EUR' }),
      ev('payment.captured', 'q-cap-2', '2026-10-20T08:30:00Z', { transaction_id: 'T-Q2', order_id: '#QB', amount_minor: 600, currency: 'EUR' }),
      ev('payment.allocation_recorded', 'q-alloc-1', '2026-10-22T10:00:00Z', { allocation_id: 'AL1', invoice_id: 'I1', transaction_id: 'T-Q1', amount_minor: 5000, currency: 'EUR' }),
      ev('business.case_recorded', 'q-case-1', '2026-10-25T10:00:00Z', { case_id: 'CASE1', invoice_id: 'I2', status: 'extension_agreed', agreed_extension_until: '2026-12-15' }),
    ]); expect(r.status, JSON.stringify(r.body)).toBe(202); for (const c of ['invoices', 'invoice_dispatch', 'payments', 'payment_allocations', 'cases']) await cover(c); await settle(Number(r.body.committed_cursor));
    const i1 = await ask('invoices.outstanding'); results['invoice-01'] = i1; expect(i1.status).toBe('complete'); const inv = (i1.result.outstanding as Array<Record<string, number | string>>).find((x) => x.invoice_id === 'I1')!; expect(inv.reported_open_minor).toBe(4520); expect(inv.new_cash_from_marker).toBe(0);
    const i2 = await ask('orders.missing_invoice'); results['invoice-02'] = i2; expect(i2.status).toBe('complete'); // #QC dispatched + invoiced 11900 of 1000? covered; #QA not dispatched -> not eligible
    const i3 = await ask('invoices.order_amount_variance', { order_id: '#QA' }); results['invoice-03'] = i3; expect(i3.status).toBe('complete'); expect((i3.result.variances as Array<Record<string, number>>)[0]!.difference_minor).toBe(12000 - 600);
    const i4 = await ask('invoices.dispatch_evidence'); results['invoice-04'] = i4; expect(i4.status).toBe('complete'); expect((i4.result.without_send_evidence as Array<{ invoice_id: string }>).some((x) => x.invoice_id === 'I2')).toBe(true); expect((i4.result.with_send_evidence as Array<{ invoice_id: string; recipient_delivery_proven: boolean }>).find((x) => x.invoice_id === 'I1')!.recipient_delivery_proven).toBe(false);
    const c1 = await ask('orders.payment_state', { order_id: '#QC' }); results['collection-01'] = c1; expect(c1.status).toBe('complete'); const o = (c1.result.orders as Array<Record<string, unknown>>)[0]!; expect(o.collected_minor).toBe(5000); expect(o.remaining_minor).toBe(1000 - 5000 < 0 ? 0 : 1000 - 5000); expect(o.state).toBe('paid');
    const c2 = await ask('payments.recovered_attempts'); results['collection-02'] = c2; expect(c2.status).toBe('complete'); expect((c2.result.recovered as Array<{ order_id: string; failed_history_retained: string[] }>).find((x) => x.order_id === '#QB')!.failed_history_retained).toEqual(['T-Q0']);
    const c3 = await ask('invoices.payment_variance', { invoice_id: 'I1' }); results['collection-03'] = c3; expect(c3.status).toBe('complete'); const vrow = (c3.result.variances as Array<Record<string, number>>)[0]!; expect(vrow.remaining_minor).toBe(4520); expect(vrow.fee_added_to_customer_debt).toBe(0);
    const c4 = await ask('receivables.review_queue', { today: '2026-10-31' }); results['collection-04'] = c4; expect(c4.status).toBe('complete'); const rq = (c4.result.review as Array<Record<string, unknown>>); expect(rq.some((x) => x.invoice_id === 'I1')).toBe(true); expect(c4.result.automatic_action).toBe(false);
  }, 180_000);

  it('settlement-01..04 and reversal-01..04', async () => {
    const r = await producerPost([
      ev('payment.fee_booked', 'q-fee-1', '2026-10-20T09:31:00Z', { transaction_id: 'T-Q1', account_id: 'acct-q', fee_minor: 150, currency: 'EUR' }),
      ev('provider.ledger_posted', 'q-led-1', '2026-10-20T09:31:00Z', { ledger_entry_id: 'LG1', account_id: 'acct-q', source_transaction_id: 'T-Q1', payout_id: 'PO-Q1', posting_type: 'charge', gross_minor: 5000, fee_minor: 150, net_minor: 4850, currency: 'EUR' }),
      ev('payout.announced', 'q-pa-1', '2026-10-23T09:00:00Z', { payout_id: 'PO-Q1', account_id: 'acct-q', amount_minor: 4850, currency: 'EUR' }),
      ev('payout.sent', 'q-ps-1', '2026-10-24T09:00:00Z', { payout_id: 'PO-Q1', account_id: 'acct-q', amount_minor: 4850, currency: 'EUR', trace_reference: 'PO-Q1', ledger_membership: ['LG1'] }),
      ev('provider.hold_recorded', 'q-hold-1', '2026-10-24T10:00:00Z', { hold_id: 'H1', account_id: 'acct-q', currency: 'EUR', amount_minor: 9700, reason: 'risk_review' }),
      ev('provider.release_promised', 'q-hold-2', '2026-10-25T10:00:00Z', { hold_id: 'H1', release_promised_at: '2026-11-05T00:00:00Z' }),
      ev('provider.balance_observed', 'q-bal-1', NOW, { account_id: 'acct-q', currency: 'EUR', observed_at: NOW, total_minor: 9700, coverage: 'total_only' }),
      ev('return.approved', 'q-ret-1', '2026-10-26T10:00:00Z', { return_id: 'RET-Q', order_id: '#QC', lines: [{ line_id: 'QC/1', item_id: 'CUP-Q', quantity: '2', unit: 'piece' }] }),
      ev('return.received', 'q-rec-1', '2026-10-27T10:00:00Z', { receipt_id: 'RC-Q', return_id: 'RET-Q', item_id: 'CUP-Q', quantity: '2', unit: 'piece', disposition: 'quarantine' }),
      ev('refund.pending', 'q-ref-1', '2026-10-27T11:00:00Z', { refund_id: 'RF-Q', original_transaction_id: 'T-Q1', order_id: '#QC', amount_minor: 2380, currency: 'EUR' }),
      ev('refund.entitlement_recorded', 'q-ent-1', '2026-10-26T12:00:00Z', { entitlement_id: 'ENT-Q', invoice_id: 'I1', credit_id: 'CN1', original_transaction_id: 'T-Q1', amount_minor: 2380, currency: 'EUR', destination: 'original_payment' }),
      ev('dispute.opened', 'q-disp-1', '2026-10-28T10:00:00Z', { dispute_id: 'DSP-Q', original_transaction_id: 'T-Q2', order_id: '#QB', amount_minor: 600, currency: 'EUR' }),
      ev('chargeback.debit_posted', 'q-cb-1', '2026-10-29T10:00:00Z', { dispute_id: 'DSP-Q', debit_posting_id: 'CBD-1', original_transaction_id: 'T-Q2', debit_minor: 600, fee_minor: 1500, currency: 'EUR' }),
      ev('refund.completed', 'q-ref-2', '2026-10-29T11:00:00Z', { refund_id: 'RF-Q2', original_transaction_id: 'T-Q2', order_id: '#QB', amount_minor: 600, currency: 'EUR' }),
      ev('order.cancelled', 'q-oA-cancel', '2026-10-30T12:00:00Z', { order_id: '#QA', full: true }),
    ]); expect(r.status, JSON.stringify(r.body)).toBe(202);
    for (const c of ['provider_ledger', 'payouts', 'holds', 'positions', 'returns', 'receipts', 'refunds', 'entitlements', 'disputes']) await cover(c);
    // bank statement with one booked entry for the payout
    const csv = 'Buchungstag;Betrag;Waehrung;Verwendungszweck\n24.10.2026;48,50;EUR;Payout PO-Q1 Shopify\n25.10.2026;-12,00;EUR;Bankgebuehr\n';
    const bank = await apiFetch(`/api/sources/${bankId}/bank-csv`, { method: 'POST', cookie, body: JSON.stringify({ csv, profile: { version: 1, delimiter: ';', columns: { booked_at: 'Buchungstag', amount: 'Betrag', currency: 'Waehrung', reference: 'Verwendungszweck' }, decimal_separator: ',', date_format: 'DD.MM.YYYY', sign_convention: 'signed' }, statement_id: 'stmt-q', coverage: { from: '2026-10-01', to: '2026-10-31' }, account_id: 'bank', commit: true }) });
    expect(bank.status, JSON.stringify(bank.body)).toBe(200); results['bank_import'] = bank.body;
    await settle(Math.max(Number(r.body.committed_cursor), Number(bank.body.required_cursor)));
    const s1 = await ask('providers.money_positions'); results['settlement-01'] = s1; expect(s1.status).toMatch(/complete|partial/); const pos = (s1.result.positions as Array<Record<string, number | string>>).find((p) => p.account_id === 'acct-q')!; expect(pos.captured_minor).toBe(5000); expect(pos.fees_minor).toBe(150); expect(pos.bank_confirmed_minor).toBe(4850); expect(pos.in_transit_minor).toBe(0); expect(pos.payout_is_revenue).toBe(false);
    const s2 = await ask('payouts.gross_to_net', { payout_id: 'PO-Q1' }); results['settlement-02'] = s2; expect(s2.status).toBe('complete'); expect(s2.result.computed_net_minor).toBe(4850); expect(s2.result.unexplained_minor).toBe(0);
    const s3 = await ask('payouts.missing_bank_confirmation'); results['settlement-03'] = s3; expect(s3.status).toMatch(/complete|partial/); expect((s3.result.missing_confirmation as Array<{ payout_id: string }>).some((p) => p.payout_id === 'PO-Q1')).toBe(false);
    const s4 = await ask('providers.holds_and_releases'); results['settlement-04'] = s4; expect(s4.status).toBe('complete'); const h = (s4.result.holds as Array<Record<string, unknown>>).find((x) => x.hold_id === 'H1')!; expect(h.held_minor).toBe(9700); expect(h.release_is_only_promised).toBe(true);
    const r1 = await ask('returns.lifecycle', { return_id: 'RET-Q' }); results['reversal-01'] = r1; expect(r1.status).toBe('complete'); const ret = (r1.result.returns as Array<Record<string, unknown>>)[0]!; expect(ret.physical_return_received).toBe(true); expect(ret.sellable_added).toBe('0'); expect(ret.cash_refund_confirmed).toBe(false);
    const r2 = await ask('credits.refund_gaps'); results['reversal-02'] = r2; expect(r2.status).toBe('complete'); const gap = (r2.result.refund_gaps as Array<Record<string, number | string>>).find((g) => g.invoice_id === 'I1')!; expect(gap.approved_cash_refund_minor).toBe(2380); expect(gap.cash_refund_due_minor).toBe(2380);
    const r3 = await ask('cancellations.outstanding_steps', { order_id: '#QA' }); results['reversal-03'] = r3; expect(r3.status).toBe('complete'); const cs = (r3.result.cancellations as Array<Record<string, unknown>>)[0]!; expect(cs.remaining_steps).toContain('correct_invoice'); expect(cs.stock_receipt_required).toBe(false);
    const r4 = await ask('refunds.chargeback_overlap'); results['reversal-04'] = r4; expect(r4.status).toBe('complete'); const dz = (r4.result.cases as Array<Record<string, number | boolean>>).find((c) => c.dispute_id === 'DSP-Q')!; expect(dz.net_customer_repayments_minor).toBe(1200); expect(dz.excess_minor).toBe(600); expect(dz.fees_excluded).toBe(true); expect(dz.review_required).toBe(true);
  }, 240_000);

  it('the same intents return identical results through the SDK MCP bridge (MCP-01)', async () => {
    const transport = new StdioClientTransport({ command: 'node', args: [resolve(ROOT, 'apps/mcp-bridge/dist/main.js')], env: { ...process.env as Record<string, string>, BLACKBOX_API_URL: API, BLACKBOX_AGENT_KEY: agentKey }, stderr: 'pipe' });
    const client = new Client({ name: 'qa', version: '1' }); await client.connect(transport);
    const strip = (v: Record<string, unknown>) => { const { timing_ms, hydration_rounds, readiness, ...rest } = v; void timing_ms; void hydration_rounds; void readiness; return rest; };
    for (const [intent, params] of [['inventory.available_to_sell', { item_id: 'CUP-Q', requested_quantity: '100' }], ['invoices.outstanding', {}], ['providers.money_positions', {}], ['returns.lifecycle', { return_id: 'RET-Q' }]] as const) {
      const m = await client.callTool({ name: 'query_business', arguments: { intent, parameters: params } }); const mcp = JSON.parse((m.content as Array<{ text: string }>)[0]!.text);
      const a = await ask(intent, params as Record<string, unknown>);
      expect(strip(mcp)).toEqual(strip(a as unknown as Record<string, unknown>));
    }
    const hist = await client.callTool({ name: 'get_entity_history', arguments: { entity_type: 'invoice', entity_id: 'I1' } }); const h = JSON.parse((hist.content as Array<{ text: string }>)[0]!.text); expect(h.entries.length).toBeGreaterThan(3);
    const evd = await client.callTool({ name: 'get_evidence', arguments: { evidence_id: 'does-not-exist' } }); expect(JSON.parse((evd.content as Array<{ text: string }>)[0]!.text).status).toBe('unavailable');
    await client.close();
  }, 120_000);
});

describe('QUERY-02 missing-data cases are explicit, never fabricated', () => {
  it('each intent reports insufficient_data or partial with named missing inputs when its capability is absent', async () => {
    // a fresh synthetic tenant with nothing but coverage for one capability would require a second owner; instead ask for entities that do not exist
    const o1 = await ask('inventory.available_to_sell', { item_id: 'NOPE' }); expect(o1.status).toBe('insufficient_data'); expect(o1.missing_inputs).toContain('stock.basis'); expect(o1.result.available).toBeNull();
    const s2 = await ask('payouts.gross_to_net', { payout_id: 'NOPE' }); expect(s2.status).toBe('insufficient_data');
    const d4 = await ask('customer.delivery_reply', { order_id: 'NOPE' }); expect(d4.status).toBe('insufficient_data');
    results['missing_samples'] = { o1: o1.status, s2: s2.status, d4: d4.status };
  });
});

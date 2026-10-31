import { describe, it, expect } from 'vitest';
import { parseSourcePayload, entityRefsFor, JournalEntryInput } from './index.js';
describe('source payload contracts', () => {
  it('accepts a typed order and rejects unknown keys', () => {
    const p = parseSourcePayload('order.accepted', { order_id: '#1001', currency: 'EUR', gross_minor: 11900,
      lines: [{ line_id: 'L1', item_id: 'CUP-OLV', quantity: '10', unit: 'piece', line_gross_minor: 11900 }] });
    expect(p.agreed_version).toBe(1);
    expect(() => parseSourcePayload('order.accepted', { order_id: 'x', currency: 'EUR', gross_minor: 1, lines: [], email: 'a@b' })).toThrow();
  });
  it('never treats a payment marker as new cash', () => {
    expect(() => parseSourcePayload('invoice.payment_marked', { invoice_id: 'I', paid_minor: 1, currency: 'EUR', is_new_cash_movement: true })).toThrow();
  });
  it('derives scoped entity refs', () => {
    const refs = entityRefsFor('payment.captured', { transaction_id: 'TX', order_id: '#1', amount_minor: 1, currency: 'EUR' });
    expect(refs).toEqual([{ type: 'order', id: '#1' }, { type: 'transaction', id: 'TX' }]);
  });
  it('validates journal input envelope', () => {
    expect(() => JournalEntryInput.parse({ record_type: 'source', record_id: 'r', event_type: 'x', dedup_key: 'd', occurred_at: 'nope', payload: {} })).toThrow();
  });
});

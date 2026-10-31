/**
 * DOMAIN-01..05 / DOMAIN-07 / IMPORT-02 through the real pipeline: the Golden Order-to-Cash fixture is replayed
 * via the replay connection, the engine derives and folds it, and every checkpoint value is compared through the API.
 * Variants: duplicates (repeat), missing bank (stop at G18), scaled/mutated ids (scale 3, suffix), bitemporal as-of.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT, apiFetch, loginOwner, waitApplied, evidence } from '../helpers/env';

let cookie: string; let replayId: string; const ev: Record<string, unknown> = {};
const golden = JSON.parse(readFileSync(resolve(ROOT, 'GOLDEN-ORDER-TO-CASH.json'), 'utf8')) as { checkpoints: Array<{ after: string; expected: Record<string, number | string> }>; events: Array<{ id: string }> };
const state = async (type: string, id: string, extra: Record<string, unknown> = {}) => { const r = await apiFetch('/api/state', { method: 'POST', cookie, body: JSON.stringify({ entity_type: type, entity_id: id, ...extra }) }); expect(r.status).toBe(200); return r.body as { status: string; view: { state: Record<string, unknown>; computed: Record<string, unknown>; evidence_entry_ids: string[] } }; };
const q = (s: unknown) => Number(String(s)); // quantities are decimal strings

async function replay(body: Record<string, unknown>) { const r = await apiFetch(`/api/sources/${replayId}/replay`, { method: 'POST', cookie, body: JSON.stringify(body) }); expect(r.status).toBe(200); await waitApplied(cookie, Number(r.body.required_cursor), 120_000); return r.body as { accepted: number; duplicates: number; conflicts: number; required_cursor: number }; }

/** Compare one golden checkpoint against engine state for the given id suffix/scale. */
async function checkpoint(expected: Record<string, number | string>, sfx: string, scale: number) {
  const item = await state('item', 'CUP-OLV'); const av = item.view.computed as Record<string, unknown>;
  const tx = await state('transaction', `TX-1001${sfx}`); const t = tx.view.state as Record<string, number>; const tc = tx.view.computed as Record<string, number>;
  const inv = await state('invoice', `INV-1001${sfx}`); const ic = inv.view.computed as Record<string, number>; const is = inv.view.state as Record<string, number>;
  const acc = await state('account', 'default/EUR'); const ac = acc.view.computed as Record<string, number>; const as = acc.view.state as Record<string, number>;
  const actual: Record<string, unknown> = {
    physical_stock: av.physical != null ? q(av.physical) : null, reserved_stock: q(av.reserved), quarantined_stock: q(av.quantity_control ?? av.quarantined), available_stock: av.available != null ? q(av.available) : null,
    authorized_minor: t.authorized_minor, captured_minor: t.captured_minor, fees_minor: as.fees_minor, refunded_minor: tc.refunded_minor, open_receivable_minor: ic.reported_open_minor,
    invoice_original_minor: is.gross_minor, invoice_credit_minor: ic.credits_minor, invoice_net_minor: ic.net_minor, refund_payable_minor: Math.max(0, ic.refund_payable_from_credits_minor - tc.refunded_minor),
    provider_balance_minor: ac.balance_minor, provider_held_minor: ac.held_minor, provider_available_minor: ac.available_minor, payout_announced_minor: ac.announced_minor, in_transit_minor: ac.in_transit_minor, bank_confirmed_minor: ac.bank_confirmed_minor,
    customer_net_paid_minor: tc.net_collected_minor,
  };
  const scaled = (k: string, v: number | string) => (typeof v === 'number' && k.endsWith('_minor') ? v * scale : v);
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(expected)) { if (k === 'shipment_status') { const sh = await state('shipment', `SHIP-1001${sfx}`); if ((sh.view.state as { state: string }).state !== v) diffs.push(`shipment_status: ${String((sh.view.state as { state: string }).state)} != ${v}`); continue; } if (!(k in actual)) { diffs.push(`${k}: not computed`); continue; } if (actual[k] !== scaled(k, v)) diffs.push(`${k}: ${String(actual[k])} != ${String(scaled(k, v))}`); }
  return { diffs, actual };
}

beforeAll(async () => {
  cookie = await loginOwner();
  const srcs = await apiFetch('/api/sources', { cookie });
  const existing = (srcs.body.connections as Array<{ connection_id: string; provider: string }>).find((c) => c.provider === 'replay');
  if (existing) replayId = existing.connection_id; else { const r = await apiFetch('/api/sources', { method: 'POST', cookie, body: JSON.stringify({ provider: 'replay', display_name: 'Golden example', account_namespace: 'golden-order-to-cash' }) }); expect(r.status).toBe(201); replayId = r.body.connection_id as string; }
}, 60_000);
afterAll(() => evidence('golden.json', ev));

describe('DOMAIN-01 Golden Scenario through ingestion, PostgreSQL, Rust and API', () => {
  it('matches every intermediate checkpoint when replayed step by step', async () => {
    const results: Array<{ after: string; diffs: string[] }> = [];
    for (const cp of golden.checkpoints) { await replay({ stop_after: cp.after, id_suffix: '-step' }); const { diffs } = await checkpoint(cp.expected, '-step', 1); results.push({ after: cp.after, diffs }); }
    ev.stepwise = results;
    for (const r of results) expect(r.diffs, `after ${r.after}`).toEqual([]);
  }, 600_000);
  it('matches the final checkpoint after one full replay and conservation holds', async () => {
    const r = await replay({ id_suffix: '-full' }); ev.full_replay = r;
    const finalCp = golden.checkpoints.at(-1)!; const { diffs, actual } = await checkpoint(finalCp.expected, '-full', 1); ev.final_actual = actual;
    expect(diffs).toEqual([]);
    const a = actual as Record<string, number>;
    expect(a.captured_minor - a.fees_minor - a.refunded_minor).toBe(a.provider_balance_minor + a.in_transit_minor + a.bank_confirmed_minor);
    expect(a.available_stock).toBe(a.physical_stock - a.quarantined_stock - a.reserved_stock);
    const evi = await state('account', 'default/EUR'); expect(evi.view.evidence_entry_ids.length).toBeGreaterThan(0);
    const e = await apiFetch(`/api/journal/entries/${evi.view.evidence_entry_ids[0]}`, { cookie }); expect(e.status).toBe(200);
  }, 300_000);
});

describe('DOMAIN-02 replay twice and mutated values', () => {
  it('a second identical replay changes nothing (idempotent business effects)', async () => {
    const before = await checkpoint(golden.checkpoints.at(-1)!.expected, '-full', 1);
    const r = await replay({ id_suffix: '-full' }); ev.second_replay = r; expect(r.accepted).toBe(0); expect(r.duplicates).toBeGreaterThan(0);
    const after = await checkpoint(golden.checkpoints.at(-1)!.expected, '-full', 1); expect(after.actual).toEqual(before.actual);
  }, 300_000);
  it('duplicate concurrent deliveries (repeat 3) produce the same amounts', async () => {
    const r = await replay({ id_suffix: '-dup', repeat: 3 }); ev.dup_replay = r;
    const { diffs } = await checkpoint(golden.checkpoints.at(-1)!.expected, '-dup', 1); expect(diffs).toEqual([]);
  }, 300_000);
  it('scaled amounts (x3) with unique ids compute generalized values, not hardcoded ones', async () => {
    await replay({ id_suffix: '-x3', scale: 3 });
    const { diffs, actual } = await checkpoint(golden.checkpoints.at(-1)!.expected, '-x3', 3); ev.scaled_actual = actual;
    // stock quantities are shared across replays of the same item; money must scale
    expect(diffs.filter((d) => d.includes('_minor'))).toEqual([]);
    expect((actual as Record<string, number>).captured_minor).toBe(11900 * 3);
  }, 300_000);
});

describe('DOMAIN-03 / missing_bank variant / IMPORT-02 partial truth', () => {
  it('stopping at G18 leaves 9170 in transit and bank unknown rather than zero-confirmed', async () => {
    await replay({ id_suffix: '-nobank', stop_after: 'G18' });
    const acc = await state('account', 'default/EUR'); void acc; // shared account; evaluate via payout entity instead
    const payout = await state('payout', 'OUT-1001-nobank'); expect((payout.view.state as { state: string; bank_confirmed: boolean }).state).toBe('sent'); expect((payout.view.state as { bank_confirmed: boolean }).bank_confirmed).toBe(false);
    const missing = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'payouts.missing_bank_confirmation' }) });
    ev.missing_bank = missing.body;
    const rows = (missing.body.result as { missing_confirmation: Array<{ payout_id: string; conclusion: string }> }).missing_confirmation;
    expect(rows.some((r) => r.payout_id === 'OUT-1001-nobank')).toBe(true);
    expect(rows.find((r) => r.payout_id === 'OUT-1001-nobank')!.conclusion).toMatch(/no_evidence_in_imported_interval|candidate_requires_review|ambiguous/);
  }, 300_000);
  it('a payment marker is not cash and a credit note is not a refund', async () => {
    const inv = await state('invoice', 'INV-1001-full'); const ic = inv.view.computed as Record<string, number>;
    const tx = await state('transaction', 'TX-1001-full'); const tc = tx.view.computed as Record<string, number>; const ts = tx.view.state as Record<string, number>;
    expect(ts.captured_minor).toBe(11900); // marker did not add capture
    expect(ic.credits_minor).toBe(2380); expect(tc.refunded_minor).toBe(2380); // refund came from refund.completed, not from the credit note
    const r = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'credits.refund_gaps' }) }); ev.refund_gaps = r.body;
    const gaps = (r.body.result as { refund_gaps: Array<{ invoice_id: string; cash_refund_due_minor: number }> }).refund_gaps;
    const full = gaps.find((g) => g.invoice_id === 'INV-1001-full'); if (full) expect(full.cash_refund_due_minor).toBe(0);
  });
});

describe('DOMAIN-07 bitemporal cutoffs', () => {
  it('a recorded-time cutoff before the credit shows the pre-credit receivable; the credit does not erase it', async () => {
    const list = await apiFetch('/api/journal/entries', { method: 'POST', cookie, body: JSON.stringify({ entity: { type: 'invoice', id: 'INV-1001-full' }, page_size: 100 }) });
    const entries = list.body.entries as Array<{ journal_sequence: number; event_type: string; occurred_at: string }>;
    const credit = entries.find((e) => e.event_type === 'fact.credit_note')!; expect(credit).toBeDefined();
    const before = await state('invoice', 'INV-1001-full', { consistency: { mode: 'as_of', recorded_cutoff: credit.journal_sequence - 1 } });
    const after = await state('invoice', 'INV-1001-full');
    ev.bitemporal = { cutoff: credit.journal_sequence - 1, before: before.view.computed, after: after.view.computed };
    expect((before.view.computed as Record<string, number>).credits_minor).toBe(0); expect((before.view.computed as Record<string, number>).net_minor).toBe(11900);
    expect((after.view.computed as Record<string, number>).credits_minor).toBe(2380);
    const eff = await state('invoice', 'INV-1001-full', { consistency: { mode: 'as_of', effective_at: '2026-10-31T09:13:30Z' } });
    expect((eff.view.computed as Record<string, number>).credits_minor).toBe(0);
  });
});

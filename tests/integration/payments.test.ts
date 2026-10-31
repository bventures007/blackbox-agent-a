/**
 * Shopify Payments provider-shaped pipeline (shopify_payments.provider_ledger / payouts / disputes rows; settlement-01..02,
 * reversal-04 support): the finance adapter polls the fixture's Shopify Payments shapes, the worker commits ledger/payout/dispute
 * observations durably, the engine folds them and the API answers gross-to-net and money positions with values recomputed
 * independently from the fixture over HTTP (never from the adapter).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { apiFetch, loginOwner, waitFor, waitApplied, evidence } from '../helpers/env';

let cookie: string; let connectionId: string; const ev: Record<string, unknown> = {};
const FIXTURE = 'http://127.0.0.1:19079/admin/api/2025-10/graphql.json'; const TOKEN = 'shpat_fixture_token_000000000000';
async function fixture(query: string, variables: Record<string, unknown> = {}) { const r = await fetch(FIXTURE, { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': TOKEN }, body: JSON.stringify({ query, variables }) }); return (await r.json() as { data: Record<string, never> }).data; }
const minor = (m: { amount: string }) => Math.round(Number(m.amount) * 100);

beforeAll(async () => {
  cookie = await loginOwner();
  const srcs = await apiFetch('/api/sources', { cookie });
  const existing = (srcs.body.connections as Array<{ connection_id: string; provider: string }>).find((c) => c.provider === 'shopify_payments');
  if (existing) connectionId = existing.connection_id;
  else { const r = await apiFetch('/api/sources', { method: 'POST', cookie, body: JSON.stringify({ provider: 'shopify_payments', display_name: 'Fixture Payments', account_namespace: 'fixture-store.myshopify.com', secret: TOKEN, config_public: { base_url: 'http://fixture:4799' }, plan: { preset: 'last_30_days' } }) }); expect(r.status, JSON.stringify(r.body)).toBe(201); connectionId = r.body.connection_id as string; }
  ev.connection_id = connectionId;
}, 60_000);
afterAll(() => evidence('shopify-payments.json', ev));

describe('shopify_payments fixture import through worker, PostgreSQL, Rust and API', () => {
  it('commits ledger, payout and dispute observations and marks the finance capabilities ready', async () => {
    // the run that imported the finance shapes (on a reused workspace the newest run is an incremental with only duplicates)
    const run = await waitFor(async () => { const r = await apiFetch(`/api/sources/${connectionId}/runs`, { cookie }); const runs = r.body.runs as Array<Record<string, unknown>>; const failed = runs.find((x) => x.state === 'failed'); if (failed) return failed; return runs.find((x) => x.state === 'complete' && Number((x.counters as Record<string, number>).observations_committed ?? 0) > 0) ?? null; }, 150_000, 1000);
    ev.first_run = run; expect(run.state, JSON.stringify(run.errors)).toBe('complete');
    const counters = run.counters as Record<string, number>; expect(counters.observations_committed).toBeGreaterThan(0);
    const list = await apiFetch('/api/sources', { cookie }); expect(list.status).toBe(200);
    const conn = (list.body.connections as Array<Record<string, unknown>>).find((c) => c.connection_id === connectionId)!; ev.connection = conn;
    const caps = conn.capabilities as Array<{ capability: string; collection_state: string }>;
    for (const c of ['provider_ledger', 'payouts', 'disputes']) expect(caps.find((x) => x.capability === c)?.collection_state, c).toBe('ready');
    await waitApplied(cookie, Number(counters.committed_cursor), 90_000);
  }, 180_000);

  it('answers gross-to-net for the paid payout with values recomputed from the fixture ledger', async () => {
    const d = await fixture('query { shopifyPaymentsAccount { balanceTransactions(first: 50) { pageInfo { hasNextPage endCursor } nodes { id type amount { amount currencyCode } fee { amount currencyCode } net { amount currencyCode } associatedPayout { id status } } } } }', { first: 50 });
    const ledger = (d.shopifyPaymentsAccount as { balanceTransactions: { nodes: Array<{ id: string; amount: { amount: string }; fee: { amount: string }; net: { amount: string }; associatedPayout: { id: string } }> } }).balanceTransactions.nodes;
    const expectedNet = ledger.reduce((s, l) => s + minor(l.net), 0); const expectedGross = ledger.reduce((s, l) => s + minor(l.amount), 0); const expectedFees = ledger.reduce((s, l) => s + minor(l.fee), 0);
    ev.fixture_expected = { ledger_entries: ledger.length, gross: expectedGross, fees: expectedFees, net: expectedNet };
    const q = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'payouts.gross_to_net', parameters: { payout_id: '7001' } }) });
    expect(q.status).toBe(200); ev.gross_to_net = q.body; expect(q.body.status).toBe('complete');
    const r = q.body.result as Record<string, number>;
    expect(r.computed_net_minor).toBe(expectedNet); expect(r.unexplained_minor).toBe(0);
    expect((q.body.evidence_entry_ids as string[]).length).toBeGreaterThan(0);
    const e = await apiFetch(`/api/journal/entries/${(q.body.evidence_entry_ids as string[])[0]}`, { cookie }); expect(e.status).toBe(200);
  });

  it('reports the account position, the scheduled (not sent) payout and the open chargeback explicitly', async () => {
    const pos = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'providers.money_positions' }) }); ev.money_positions = pos.body;
    expect(pos.status).toBe(200); expect(pos.body.status).toMatch(/complete|partial/);
    const acct = (pos.body.result as { positions: Array<Record<string, unknown>> }).positions.find((p) => String(p.account_id).includes('fixture-store'))!; expect(acct).toBeTruthy();
    expect(Number(acct.in_transit_minor) + Number(acct.bank_confirmed_minor)).toBe((ev.fixture_expected as { net: number }).net); // paid payout is sent, no bank statement yet
    expect(acct.announced_payouts_minor).toBe(12345); // SCHEDULED payout is an announcement, never a transfer
    expect(acct.fees_minor).toBe((ev.fixture_expected as { fees: number }).fees); // provider fees come from the ledger charge postings (no gateway fee events on this path)
    // conservation: the workspace also holds the orders adapter's refunds/chargebacks for the same account, so the identity (not a bare zero) is asserted
    const expectedBalance = Number(acct.captured_minor) - Number(acct.fees_minor) - Number(acct.refunded_minor) - Number(acct.chargebacks_minor) + Number(acct.adjustments_minor) - Number(acct.in_transit_minor) - Number(acct.bank_confirmed_minor);
    expect(acct.provider_balance_minor).toBe(expectedBalance); ev.balance_identity = { balance: acct.provider_balance_minor, expected: expectedBalance };
    const cb = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'refunds.chargeback_overlap' }) }); ev.chargeback = cb.body;
    expect(cb.status).toBe(200); const cases = (cb.body.result as { cases: Array<Record<string, unknown>> }).cases; expect(cases.some((c) => String(c.dispute_id) === '5001')).toBe(true);
    const health = await apiFetch('/api/diagnostics/health', { cookie }); const sources = (health.body.cards as Array<{ area: string; detail: Record<string, unknown> }>).find((c) => c.area === 'sources')!; ev.sources_health = sources.detail;
  });
});

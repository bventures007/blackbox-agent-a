// Smoke-profile corpus seeder (PILOT-09 / OPS-05): 50 synthetic tenants, >=250k five-track entries, >=10k orders,
// largest tenant 50%, long histories (>=50 journal entries per order incl. derived), late corrections, evidence refs.
// Writes through journal_append with the api role (tenant-scoped), exactly like the ingestion boundary, with a frozen seed.
// Usage: node seed.mjs --orders 11000 --tenants 50 [--seed smoke-v1]  -> dataset manifest on stdout
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const ROOT = resolve(import.meta.dirname, '../..'); const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const ORDERS = Number(arg('--orders', 11000)), TENANTS = Number(arg('--tenants', 50)), SEED = arg('--seed', 'smoke-v1');
const pw = (n) => readFileSync(resolve(ROOT, '.secrets', n), 'utf8').trim();
const mig = postgres(`postgres://bbx_migrator:${pw('pg_migrator_password')}@127.0.0.1:19032/blackbox`, { max: 2, onnotice: () => {} });
const api = postgres(`postgres://bbx_api:${pw('pg_api_password')}@127.0.0.1:19032/blackbox`, { max: 8, onnotice: () => {} });
let rngState = Number(BigInt('0x' + createHash('sha256').update(SEED).digest('hex').slice(0, 12)));
const rnd = () => { rngState = (rngState * 1103515245 + 12345) % 2147483648; return rngState / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const base = Date.UTC(2026, 6, 1); const ts = (d) => new Date(base + d).toISOString();
const existing = await mig`SELECT tenant_id, name FROM tenants WHERE kind = 'synthetic' AND name LIKE 'perf-%' ORDER BY name`;
const tenants = [];
for (let i = 0; i < TENANTS; i++) { const name = `perf-${String(i).padStart(2, '0')}`; let t = existing.find((e) => e.name === name); if (!t) { const id = randomUUID(); await mig`INSERT INTO tenants (tenant_id, name, timezone, kind) VALUES (${id}, ${name}, 'Europe/Berlin', 'synthetic')`; await mig`INSERT INTO tenant_sequences (tenant_id) VALUES (${id})`; t = { tenant_id: id, name }; } tenants.push(t); }
const share = (i) => (i === 0 ? 0.5 : 0.5 / (TENANTS - 1));
let total = 0; const manifest = { seed: SEED, tenants: TENANTS, orders: 0, entries_source: 0, items_per_tenant: 40, generator: 'tests/perf/seed.mjs', started_at: new Date().toISOString() };
const ev = (type, id, occurred, entity, payload) => ({ record_type: 'source', record_id: `${entity.type}:${entity.id}`, event_type: type, schema_version: 1, provider_namespace: 'perf', dedup_key: `perf:${id}`, occurred_at: occurred, entity_refs: [entity], payload, evidence_refs: [`ev-${id}`], input_entry_ids: [] });
for (const [ti, t] of tenants.entries()) {
  const n = Math.round(ORDERS * share(ti)); const items = Array.from({ length: 40 }, (_, k) => `SKU-${ti}-${k}`);
  const batch = [];
  const flush = async () => { if (!batch.length) return; const copy = batch.splice(0, batch.length); await api.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${t.tenant_id}, true), set_config('app.scope', 'tenant', true)`; await tx`SELECT count(*) FROM journal_append(${t.tenant_id}::uuid, ${tx.json(copy)}::jsonb)`; }); total += copy.length; manifest.entries_source += copy.length; };
  for (const it of items) batch.push(ev('inventory.snapshot', `${ti}-snap-${it}`, ts(0), { type: 'item', id: it }, { item_id: it, unit: 'piece', physical: String(500 + Math.floor(rnd() * 500)) }));
  await flush();
  for (let o = 0; o < n; o++) {
    const oid = `#P${ti}-${o}`; const day = Math.floor(rnd() * 120) * 86400_000 + Math.floor(rnd() * 86400_000); const item = pick(items); const qty = 1 + Math.floor(rnd() * 4); const unit = 500 + Math.floor(rnd() * 9500); const gross = qty * unit; const cur = rnd() < 0.9 ? 'EUR' : 'CHF';
    const O = { type: 'order', id: oid }; const tx = `T${ti}-${o}`; const steps = 20 + Math.floor(rnd() * 8);
    batch.push(ev('order.accepted', `${oid}-acc`, ts(day), O, { order_id: oid, customer_id: `C${ti}-${o % 700}`, currency: cur, gross_minor: gross, lines: [{ line_id: `${oid}/1`, item_id: item, quantity: String(qty), unit: 'piece', unit_gross_minor: unit, line_gross_minor: gross }] }));
    batch.push(ev('inventory.reserved', `${oid}-res`, ts(day + 60_000), O, { reservation_id: `R${oid}`, order_id: oid, line_id: `${oid}/1`, item_id: item, quantity: String(qty), unit: 'piece' }));
    if (rnd() < 0.15) batch.push(ev('payment.failed', `${oid}-fail`, ts(day + 90_000), O, { transaction_id: `${tx}f`, order_id: oid, amount_minor: gross, currency: cur }));
    batch.push(ev('payment.authorized', `${oid}-auth`, ts(day + 120_000), O, { transaction_id: tx, order_id: oid, amount_minor: gross, currency: cur }));
    batch.push(ev('payment.captured', `${oid}-cap`, ts(day + 180_000), O, { transaction_id: tx, order_id: oid, amount_minor: gross, currency: cur }));
    batch.push(ev('payment.fee_booked', `${oid}-fee`, ts(day + 181_000), O, { transaction_id: tx, fee_minor: Math.round(gross * 0.029) + 25, currency: cur }));
    batch.push(ev('invoice.issued', `${oid}-inv`, ts(day + 3600_000), O, { document_id: `D${oid}`, invoice_id: `I${oid}`, order_id: oid, currency: cur, gross_minor: gross, due_date: new Date(base + day + 14 * 86400_000).toISOString().slice(0, 10) }));
    batch.push(ev('invoice.payment_marked', `${oid}-mark`, ts(day + 3700_000), O, { invoice_id: `I${oid}`, transaction_id: tx, paid_minor: gross, currency: cur, is_new_cash_movement: false }));
    if (steps > 22) {
      batch.push(ev('shipment.dispatched', `${oid}-ship`, ts(day + 86400_000), O, { shipment_id: `S${oid}`, order_id: oid, lines: [{ line_id: `${oid}/1`, item_id: item, quantity: String(qty), unit: 'piece' }], reservation_id: `R${oid}`, carrier: 'DHL', tracking_number: `TRK${oid}` }));
      for (let s = 0; s < 3; s++) batch.push(ev('carrier.scan_observed', `${oid}-scan${s}`, ts(day + 86400_000 + (s + 1) * 7200_000), O, { carrier_service: 'dhl', tracking_number: `TRK${oid}`, scan_identity: `${oid}-sc${s}`, status_code: ['in_transit', 'out_for_delivery', 'delivered'][s], effective_time: ts(day + 86400_000 + (s + 1) * 7200_000), shipment_id: `S${oid}` }));
      batch.push(ev('shipment.delivered', `${oid}-dlv`, ts(day + 2 * 86400_000), O, { shipment_id: `S${oid}`, order_id: oid }));
    }
    if (steps > 24) {
      batch.push(ev('return.approved', `${oid}-ret`, ts(day + 5 * 86400_000), O, { return_id: `RET${oid}`, order_id: oid, lines: [{ line_id: `${oid}/1`, item_id: item, quantity: '1', unit: 'piece' }], expected_credit_minor: unit, currency: cur }));
      batch.push(ev('return.received', `${oid}-rcv`, ts(day + 7 * 86400_000), O, { receipt_id: `RC${oid}`, return_id: `RET${oid}`, item_id: item, quantity: '1', unit: 'piece', disposition: 'quarantine' }));
      batch.push(ev('invoice.credit_issued', `${oid}-cred`, ts(day + 7 * 86400_000 + 3600_000), O, { document_id: `DC${oid}`, invoice_id: `I${oid}`, credit_id: `CN${oid}`, currency: cur, credit_minor: unit }));
      batch.push(ev('refund.pending', `${oid}-rfp`, ts(day + 7 * 86400_000 + 7200_000), O, { refund_id: `RF${oid}`, original_transaction_id: tx, order_id: oid, amount_minor: unit, currency: cur }));
      batch.push(ev('refund.completed', `${oid}-rfc`, ts(day + 8 * 86400_000), O, { refund_id: `RF${oid}`, original_transaction_id: tx, order_id: oid, amount_minor: unit, currency: cur }));
    }
    if (steps > 26) batch.push(ev('order.revised', `${oid}-late`, ts(day + 30_000), O, { order_id: oid, agreed_version: 2, currency: cur, gross_minor: gross, lines: [{ line_id: `${oid}/1`, item_id: item, quantity: String(qty), unit: 'piece', line_gross_minor: gross }], reason: 'late correction recorded after shipment, effective earlier' }));
    if (o % 25 === 24) { const pid = `PO${ti}-${o}`; batch.push(ev('payout.sent', `${pid}-sent`, ts(day + 9 * 86400_000), { type: 'payout', id: pid }, { payout_id: pid, amount_minor: gross * 3, currency: cur, trace_reference: pid })); if (rnd() < 0.7) batch.push(ev('bank.credit_booked', `${pid}-bank`, ts(day + 10 * 86400_000), { type: 'bank_entry', id: `B${pid}` }, { entry_id: `B${pid}`, payout_id: pid, amount_minor: gross * 3, currency: cur, reference: `payout ${pid}` })); }
    if (batch.length >= 400) await flush();
  }
  await flush(); manifest.orders += n; process.stderr.write(`tenant ${t.name}: ${n} orders, running total ${total} source entries\n`);
}
manifest.finished_at = new Date().toISOString();
const [cnt] = await mig`SELECT count(*)::int AS n FROM journal_entries`; manifest.journal_entries_total_now = Number(cnt.n);
console.log(JSON.stringify(manifest, null, 1)); await api.end(); await mig.end();

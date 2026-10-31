// Provider-shaped Shopify GraphQL Admin fixture (API 2025-10 shapes). Synthetic data only; varies ids/amounts per seed,
// includes duplicate/out-of-order pages, a failed attempt before a capture, a 429 on demand and token checks.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.FIXTURE_PORT ?? 4799);
const TOKEN = process.env.FIXTURE_TOKEN ?? 'shpat_fixture_token_000000000000';
const SEED = process.env.FIXTURE_SEED ?? 'slice-01';
const ORDER_COUNT = Number(process.env.FIXTURE_ORDERS ?? 7);
const SCOPES = (process.env.FIXTURE_SCOPES ?? 'read_orders,read_all_orders,read_inventory,read_locations,read_fulfillments,read_merchant_managed_fulfillment_orders,read_returns,read_shopify_payments_payouts,read_shopify_payments_disputes').split(',');
let throttleNext = Number(process.env.FIXTURE_THROTTLE_FIRST ?? 0); // number of initial requests that answer 429
const state = { requests: 0, pages: 0 };

function rnd(s) { const h = createHash('sha256').update(s).digest(); return (h.readUInt32BE(0) % 100000) / 100000; }
const money = (minor, cur = 'EUR') => ({ shopMoney: { amount: (minor / 100).toFixed(2), currencyCode: cur } });
const gid = (t, i) => `gid://shopify/${t}/${i}`;
const base = new Date('2026-10-20T08:00:00Z').getTime();

function makeOrder(i) {
  const n = 1000 + i; const qty = 1 + Math.floor(rnd(`${SEED}q${i}`) * 5); const unit = 900 + Math.floor(rnd(`${SEED}p${i}`) * 4000);
  const lineGross = qty * unit; const tax = Math.round(lineGross * 0.19 / 1.19); const ship = i % 3 === 0 ? 490 : 0; const total = lineGross + ship;
  const created = new Date(base + i * 3600_000 * 5).toISOString(); const updated = new Date(base + i * 3600_000 * 5 + 7200_000).toISOString();
  const txBase = 500000 + i * 10;
  const transactions = [];
  // some orders have a failed attempt first, then success (collection-02)
  if (i % 4 === 1) transactions.push({ id: gid('OrderTransaction', txBase), kind: 'SALE', status: 'FAILURE', test: true, gateway: 'shopify_payments', processedAt: created, amountSet: money(total), parentTransaction: null, errorCode: 'CARD_DECLINED' });
  if (i % 5 === 2) { transactions.push({ id: gid('OrderTransaction', txBase + 1), kind: 'AUTHORIZATION', status: 'SUCCESS', test: true, gateway: 'shopify_payments', processedAt: created, amountSet: money(total), parentTransaction: null, errorCode: null }); }
  else { transactions.push({ id: gid('OrderTransaction', txBase + 1), kind: 'AUTHORIZATION', status: 'SUCCESS', test: true, gateway: 'shopify_payments', processedAt: created, amountSet: money(total), parentTransaction: null, errorCode: null }); transactions.push({ id: gid('OrderTransaction', txBase + 2), kind: 'CAPTURE', status: 'SUCCESS', test: true, gateway: 'shopify_payments', processedAt: new Date(base + i * 3600_000 * 5 + 600_000).toISOString(), amountSet: money(total), parentTransaction: { id: gid('OrderTransaction', txBase + 1) }, errorCode: null }); }
  const fulfillments = i % 2 === 0 ? [{ id: gid('Fulfillment', 7000 + i), status: 'SUCCESS', createdAt: new Date(base + i * 3600_000 * 5 + 3600_000).toISOString(), deliveredAt: i % 4 === 0 ? new Date(base + i * 3600_000 * 5 + 86400_000).toISOString() : null, trackingInfo: [{ company: 'DHL', number: `0034${String(i).padStart(8, '0')}` }], fulfillmentLineItems: { nodes: [{ lineItem: { id: gid('LineItem', 9000 + i) }, quantity: qty }] } }] : [];
  const refunds = i % 6 === 3 ? [{ id: gid('Refund', 8000 + i), createdAt: updated, totalRefundedSet: money(unit), transactions: { nodes: [{ id: gid('OrderTransaction', txBase + 3), kind: 'REFUND', status: 'SUCCESS', amountSet: money(unit), parentTransaction: { id: gid('OrderTransaction', txBase + 2) } }] } }] : [];
  const returns = i % 6 === 3 ? { nodes: [{ id: gid('Return', 6000 + i), status: 'OPEN', returnLineItems: { nodes: [{ quantity: 1, fulfillmentLineItem: { lineItem: { id: gid('LineItem', 9000 + i), sku: `SKU-${100 + (i % 3)}` } } }] } }] } : { nodes: [] };
  return { id: gid('Order', n), name: `#${n}`, createdAt: created, updatedAt: updated, cancelledAt: i === ORDER_COUNT - 1 ? updated : null, test: true, currencyCode: 'EUR', displayFinancialStatus: 'PAID', displayFulfillmentStatus: fulfillments.length ? 'FULFILLED' : 'UNFULFILLED',
    customer: { id: gid('Customer', 300 + (i % 4)) }, totalPriceSet: money(total), totalShippingPriceSet: money(ship),
    lineItems: { nodes: [{ id: gid('LineItem', 9000 + i), sku: `SKU-${100 + (i % 3)}`, variant: { id: gid('ProductVariant', 400 + (i % 3)) }, quantity: qty, currentQuantity: qty, originalUnitPriceSet: money(unit), discountedTotalSet: money(lineGross - tax), taxLines: [{ priceSet: money(tax) }] }] },
    transactions, fulfillments, refunds, returns };
}
const ORDERS = Array.from({ length: ORDER_COUNT }, (_, i) => makeOrder(i));
const INVENTORY = [0, 1, 2].map((k) => ({ id: gid('InventoryItem', 500 + k), sku: `SKU-${100 + k}`, tracked: true, inventoryLevels: { nodes: [{ id: gid('InventoryLevel', 600 + k), updatedAt: new Date(base + 86400_000 * 9).toISOString(), location: { id: gid('Location', 1), name: 'Main warehouse' }, quantities: ['available', 'committed', 'reserved', 'damaged', 'safety_stock', 'quality_control', 'incoming', 'on_hand'].map((name) => ({ name, quantity: name === 'on_hand' ? 120 + k * 10 : name === 'available' ? 86 + k * 10 : name === 'committed' ? 34 : name === 'incoming' ? 80 : 0 })) }] } }));

function page(items, first, after, duplicateFirstPage) {
  const start = after ? Number(Buffer.from(after, 'base64').toString()) : 0;
  let nodes = items.slice(start, start + first);
  if (duplicateFirstPage && start === 0 && items.length > first) nodes = [...nodes, items[first]]; // duplicate delivery across pages
  if (start === 0 && nodes.length > 2) nodes = [nodes[1], nodes[0], ...nodes.slice(2)]; // out-of-order arrival
  const end = start + first; return { nodes, pageInfo: { hasNextPage: end < items.length, endCursor: end < items.length ? Buffer.from(String(end)).toString('base64') : null } };
}
const log = (level, event, message, extra = {}) => process.stdout.write(JSON.stringify({ schema_version: 1, level, event_name: event, message, component: 'fixture', occurred_at: new Date().toISOString(), ...extra }) + '\n');

createServer(async (req, res) => {
  state.requests++;
  if (req.method !== 'POST' || !/\/admin\/api\/2025-10\/graphql\.json$/.test(req.url ?? '')) { res.writeHead(404).end(JSON.stringify({ errors: 'Not Found' })); return; }
  if (req.headers['x-shopify-access-token'] !== TOKEN) { res.writeHead(401).end(JSON.stringify({ errors: '[API] Invalid API key or access token' })); log('WARN', 'fixture.unauthorized', 'request with wrong token'); return; }
  if (throttleNext > 0) { throttleNext--; res.writeHead(429, { 'retry-after': '1' }).end(JSON.stringify({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] })); return; }
  let body = ''; for await (const c of req) body += c; const { query, variables = {} } = JSON.parse(body || '{}');
  const cost = { requestedQueryCost: 50, actualQueryCost: 40, throttleStatus: { maximumAvailable: 1000, currentlyAvailable: 900, restoreRate: 50 } };
  let data;
  if (/currentAppInstallation/.test(query)) data = { currentAppInstallation: { accessScopes: SCOPES.map((handle) => ({ handle })) }, shop: { name: `Fixture Store ${SEED}`, id: gid('Shop', 1), currencyCode: 'EUR', ianaTimezone: 'Europe/Berlin' } };
  else if (/orders\(/.test(query)) { state.pages++; const m = /updated_at:>='([^']+)'/.exec(variables.query ?? ''); const since = m ? m[1] : null; const items = ORDERS.filter((o) => !since || o.updatedAt >= since).sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)); data = { orders: page(items, variables.first ?? 50, variables.after, true) }; }
  else if (/inventoryItems\(/.test(query)) data = { inventoryItems: { ...page(INVENTORY, variables.first ?? 100, variables.after, false) } };
  else { res.writeHead(200).end(JSON.stringify({ errors: [{ message: 'unsupported fixture query' }] })); return; }
  res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data, extensions: { cost } }));
}).listen(PORT, '0.0.0.0', () => log('INFO', 'fixture.started', `shopify-shaped fixture listening on ${PORT} with ${ORDER_COUNT} synthetic orders (seed ${SEED})`));

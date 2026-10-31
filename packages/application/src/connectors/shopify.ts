import type { Observation } from '../ingest/service.js';

export const SHOPIFY_API_VERSION = '2025-10';
export const SHOPIFY_REQUIRED_SCOPES: Record<string, string[]> = {
  orders: ['read_orders'], payments: ['read_orders'], refunds: ['read_orders'], fulfillments: ['read_orders', 'read_fulfillments'], stock: ['read_inventory', 'read_locations'],
  allocations: ['read_orders', 'read_merchant_managed_fulfillment_orders'], returns: ['read_returns'], receipts: ['read_returns'],
  provider_ledger: ['read_shopify_payments_payouts'], payouts: ['read_shopify_payments_payouts'], positions: ['read_shopify_payments_payouts'], disputes: ['read_shopify_payments_disputes'], holds: ['read_shopify_payments_payouts'],
};
/** Fields the pilot adapter cannot obtain from the pinned API; they stay missing in the capability mapping and produce partial answers. */
export const SHOPIFY_MISSING_FIELDS: Record<string, string[]> = {
  stock: ['safety_stock'], positions: ['processing_minor', 'held_minor'], holds: ['hold_id', 'reason', 'release_promised_at', 'released_at', 'evidence_id'], disputes: ['debit_posting_id', 'debit_minor', 'reversal_minor'],
  allocations: ['policy_version'], receipts: ['location_id'],
};

export interface ShopifyConfig { shopDomain: string; accessToken: string; baseUrl?: string; apiVersion?: string }
export interface GraphQlPage<T> { nodes: T[]; hasNextPage: boolean; endCursor: string | null; cost: { requested: number; actual: number; available: number; restoreRate: number } | null }

export class ShopifyHttpError extends Error { constructor(public readonly status: number, public readonly retryAfterMs: number | null, message: string) { super(message); this.name = 'ShopifyHttpError'; } }

/** Minimal GraphQL Admin client: cost-aware throttling, Retry-After, pinned API version, works against the provider-shaped fixture server. */
export class ShopifyClient {
  private availableCost = 1000;
  constructor(private readonly cfg: ShopifyConfig, private readonly fetchImpl: typeof fetch = fetch) {}
  endpoint() { return `${this.cfg.baseUrl ?? `https://${this.cfg.shopDomain}`}/admin/api/${this.cfg.apiVersion ?? SHOPIFY_API_VERSION}/graphql.json`; }
  async graphql<T>(query: string, variables: Record<string, unknown>): Promise<{ data: T; cost: GraphQlPage<never>['cost'] }> {
    if (this.availableCost < 100) await new Promise((r) => setTimeout(r, 1000));
    const res = await this.fetchImpl(this.endpoint(), { method: 'POST', headers: { 'content-type': 'application/json', 'x-shopify-access-token': this.cfg.accessToken }, body: JSON.stringify({ query, variables }) });
    if (res.status === 429 || res.status >= 500) { const ra = res.headers.get('retry-after'); throw new ShopifyHttpError(res.status, ra ? Number(ra) * 1000 : 2000, `shopify responded ${res.status}`); }
    if (res.status === 401 || res.status === 403) throw new ShopifyHttpError(res.status, null, 'shopify authorization failed');
    if (!res.ok) throw new ShopifyHttpError(res.status, null, `shopify responded ${res.status}`);
    const body = await res.json() as { data?: T; errors?: Array<{ message: string; extensions?: { code?: string } }>; extensions?: { cost?: { requestedQueryCost: number; actualQueryCost: number; throttleStatus: { currentlyAvailable: number; restoreRate: number } } } };
    const c = body.extensions?.cost; const cost = c ? { requested: c.requestedQueryCost, actual: c.actualQueryCost, available: c.throttleStatus.currentlyAvailable, restoreRate: c.throttleStatus.restoreRate } : null;
    if (cost) this.availableCost = cost.available;
    if (body.errors?.length) { const throttled = body.errors.some((e) => e.extensions?.code === 'THROTTLED'); if (throttled) throw new ShopifyHttpError(429, 1000, 'throttled'); throw new ShopifyHttpError(400, null, 'graphql error: ' + body.errors.map((e) => e.message).join('; ').slice(0, 200)); }
    return { data: body.data as T, cost };
  }
  async accessScopes(): Promise<{ scopes: string[]; shop: { name: string; id: string; currency: string; ianaTimezone: string } }> {
    const { data } = await this.graphql<{ currentAppInstallation: { accessScopes: Array<{ handle: string }> }; shop: { name: string; id: string; currencyCode: string; ianaTimezone: string } }>(`query { currentAppInstallation { accessScopes { handle } } shop { name id currencyCode ianaTimezone } }`, {});
    return { scopes: data.currentAppInstallation.accessScopes.map((s) => s.handle), shop: { name: data.shop.name, id: data.shop.id, currency: data.shop.currencyCode, ianaTimezone: data.shop.ianaTimezone } };
  }
  async orders(query: string, after: string | null, first = 50): Promise<GraphQlPage<ShopifyOrder>> {
    const { data, cost } = await this.graphql<{ orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: ShopifyOrder[] } }>(ORDERS_QUERY, { first, after, query });
    return { nodes: data.orders.nodes, hasNextPage: data.orders.pageInfo.hasNextPage, endCursor: data.orders.pageInfo.endCursor, cost };
  }
  async inventoryLevels(after: string | null, first = 100): Promise<GraphQlPage<ShopifyInventoryLevel>> {
    const { data, cost } = await this.graphql<{ inventoryItems: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ id: string; sku: string | null; tracked: boolean; inventoryLevels: { nodes: ShopifyInventoryLevel[] } }> } }>(INVENTORY_QUERY, { first, after });
    const nodes = data.inventoryItems.nodes.flatMap((it) => it.inventoryLevels.nodes.map((l) => ({ ...l, item: { id: it.id, sku: it.sku, tracked: it.tracked } })));
    return { nodes, hasNextPage: data.inventoryItems.pageInfo.hasNextPage, endCursor: data.inventoryItems.pageInfo.endCursor, cost };
  }
}

export interface ShopifyMoney { amount: string; currencyCode: string }
export interface ShopifyOrder {
  id: string; name: string; createdAt: string; updatedAt: string; cancelledAt: string | null; test: boolean; currencyCode: string; displayFinancialStatus: string; displayFulfillmentStatus: string;
  customer: { id: string } | null; totalPriceSet: { shopMoney: ShopifyMoney }; totalShippingPriceSet: { shopMoney: ShopifyMoney };
  lineItems: { nodes: Array<{ id: string; sku: string | null; variant: { id: string } | null; quantity: number; currentQuantity: number; originalUnitPriceSet: { shopMoney: ShopifyMoney }; discountedTotalSet: { shopMoney: ShopifyMoney }; taxLines: Array<{ priceSet: { shopMoney: ShopifyMoney } }> }> };
  transactions: Array<{ id: string; kind: string; status: string; test: boolean; gateway: string; processedAt: string; amountSet: { shopMoney: ShopifyMoney }; parentTransaction: { id: string } | null; errorCode: string | null }>;
  fulfillments: Array<{ id: string; status: string; createdAt: string; deliveredAt: string | null; trackingInfo: Array<{ company: string | null; number: string | null }>; fulfillmentLineItems: { nodes: Array<{ lineItem: { id: string }; quantity: number }> } }>;
  refunds: Array<{ id: string; createdAt: string; totalRefundedSet: { shopMoney: ShopifyMoney }; transactions: { nodes: Array<{ id: string; kind: string; status: string; amountSet: { shopMoney: ShopifyMoney }; parentTransaction: { id: string } | null }> } }>;
  returns: { nodes: Array<{ id: string; status: string; returnLineItems: { nodes: Array<{ quantity: number; fulfillmentLineItem: { lineItem: { id: string; sku: string | null } } }> } }> } | null;
}
export interface ShopifyInventoryLevel { id: string; location: { id: string; name: string }; quantities: Array<{ name: string; quantity: number }>; updatedAt: string; item: { id: string; sku: string | null; tracked: boolean } }

export const ORDERS_QUERY = `query Orders($first: Int!, $after: String, $query: String) {
  orders(first: $first, after: $after, query: $query, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes { id name createdAt updatedAt cancelledAt test currencyCode displayFinancialStatus displayFulfillmentStatus customer { id }
      totalPriceSet { shopMoney { amount currencyCode } } totalShippingPriceSet { shopMoney { amount currencyCode } }
      lineItems(first: 50) { nodes { id sku variant { id } quantity currentQuantity originalUnitPriceSet { shopMoney { amount currencyCode } } discountedTotalSet { shopMoney { amount currencyCode } } taxLines { priceSet { shopMoney { amount currencyCode } } } } }
      transactions(first: 50) { id kind status test gateway processedAt amountSet { shopMoney { amount currencyCode } } parentTransaction { id } errorCode }
      fulfillments(first: 20) { id status createdAt deliveredAt trackingInfo { company number } fulfillmentLineItems(first: 50) { nodes { lineItem { id } quantity } } }
      refunds(first: 20) { id createdAt totalRefundedSet { shopMoney { amount currencyCode } } transactions(first: 20) { nodes { id kind status amountSet { shopMoney { amount currencyCode } } parentTransaction { id } } } }
      returns(first: 10) { nodes { id status returnLineItems(first: 50) { nodes { quantity fulfillmentLineItem { lineItem { id sku } } } } } }
    } } }`;
export const INVENTORY_QUERY = `query Inventory($first: Int!, $after: String) {
  inventoryItems(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id sku tracked inventoryLevels(first: 10) { nodes { id updatedAt location { id name } quantities(names: ["available","committed","reserved","damaged","safety_stock","quality_control","incoming","on_hand"]) { name quantity } } } } } }`;

export function minor(m: ShopifyMoney): number { const [i, f = ''] = m.amount.split('.'); return Number(i) * 100 + Number((f + '00').slice(0, 2)) * (m.amount.startsWith('-') ? -1 : 1); }
const gid = (s: string) => s.replace(/^gid:\/\/shopify\/\w+\//, '');

/**
 * Exact field mapping from pinned GraphQL resources to canonical observations. One Shopify order yields several
 * observations (order, transactions, fulfillments, refunds, returns); every observation keeps the provider id as identity.
 */
export function mapOrder(o: ShopifyOrder, accountNamespace: string): Observation[] {
  const out: Observation[] = []; const orderId = o.name; const corr = `${accountNamespace}:${gid(o.id)}`;
  const lines = o.lineItems.nodes.map((l) => ({ line_id: gid(l.id), item_id: l.sku ?? `variant:${gid(l.variant?.id ?? 'unknown')}`, variant_id: l.variant ? gid(l.variant.id) : undefined, quantity: String(l.quantity), unit: 'piece', unit_gross_minor: minor(l.originalUnitPriceSet.shopMoney), line_tax_minor: l.taxLines.reduce((s, t) => s + minor(t.priceSet.shopMoney), 0), line_gross_minor: minor(l.discountedTotalSet.shopMoney) + l.taxLines.reduce((s, t) => s + minor(t.priceSet.shopMoney), 0) }));
  out.push({ event_type: 'order.accepted', provider_event_id: `order:${gid(o.id)}:created`, occurred_at: o.createdAt, correlation_id: corr, record_id: `order:${orderId}`, payload: { order_id: orderId, customer_id: o.customer ? `shopify:${gid(o.customer.id)}` : undefined, currency: o.currencyCode, gross_minor: minor(o.totalPriceSet.shopMoney), shipping_minor: minor(o.totalShippingPriceSet.shopMoney), lines, placed_at: o.createdAt } });
  const reduced = o.lineItems.nodes.filter((l) => l.currentQuantity < l.quantity);
  if (reduced.length && !o.cancelledAt) out.push({ event_type: 'order.cancelled', provider_event_id: `order:${gid(o.id)}:lines:${o.updatedAt}`, occurred_at: o.updatedAt, correlation_id: corr, record_id: `order:${orderId}`, payload: { order_id: orderId, full: false, lines: reduced.map((l) => ({ line_id: gid(l.id), quantity: String(l.quantity - l.currentQuantity) })) } });
  if (o.cancelledAt) out.push({ event_type: 'order.cancelled', provider_event_id: `order:${gid(o.id)}:cancelled`, occurred_at: o.cancelledAt, correlation_id: corr, record_id: `order:${orderId}`, payload: { order_id: orderId, full: true } });
  for (const t of o.transactions) {
    const base = { provider_event_id: `transaction:${gid(t.id)}`, occurred_at: t.processedAt, correlation_id: corr, record_id: `transaction:${gid(t.id)}` };
    const amount = Math.abs(minor(t.amountSet.shopMoney)); const common = { transaction_id: gid(t.id), order_id: orderId, account_id: accountNamespace, gateway: t.gateway, currency: t.amountSet.shopMoney.currencyCode, test: t.test };
    if (t.status === 'SUCCESS') {
      if (t.kind === 'AUTHORIZATION') out.push({ ...base, event_type: 'payment.authorized', payload: { ...common, amount_minor: amount } });
      else if (t.kind === 'SALE' || t.kind === 'CAPTURE') out.push({ ...base, event_type: 'payment.captured', payload: { ...common, amount_minor: amount, parent_transaction_id: t.parentTransaction ? gid(t.parentTransaction.id) : undefined, economic_effect_id: `shopify:${gid(t.id)}` } });
      else if (t.kind === 'VOID') out.push({ ...base, event_type: 'payment.voided', payload: { transaction_id: gid(t.id), parent_transaction_id: gid(t.parentTransaction?.id ?? t.id), order_id: orderId, amount_minor: amount, currency: t.amountSet.shopMoney.currencyCode } });
    } else if (t.status === 'FAILURE' || t.status === 'ERROR') out.push({ ...base, event_type: 'payment.failed', payload: { transaction_id: gid(t.id), order_id: orderId, amount_minor: amount, currency: t.amountSet.shopMoney.currencyCode, kind: t.kind === 'AUTHORIZATION' ? 'authorization' : t.kind === 'CAPTURE' ? 'capture' : 'sale', error_code: t.errorCode ?? undefined } });
  }
  for (const f of o.fulfillments) {
    const fl = f.fulfillmentLineItems.nodes.map((n) => { const li = o.lineItems.nodes.find((l) => l.id === n.lineItem.id); return { line_id: gid(n.lineItem.id), item_id: li?.sku ?? `variant:${gid(li?.variant?.id ?? 'unknown')}`, quantity: String(n.quantity), unit: 'piece' }; });
    const tr = f.trackingInfo[0];
    if (f.status === 'CANCELLED') out.push({ event_type: 'shipment.cancelled', provider_event_id: `fulfillment:${gid(f.id)}:cancelled`, occurred_at: f.createdAt, correlation_id: corr, payload: { shipment_id: gid(f.id), order_id: orderId } });
    else { out.push({ event_type: 'shipment.dispatched', provider_event_id: `fulfillment:${gid(f.id)}:dispatched`, occurred_at: f.createdAt, correlation_id: corr, payload: { shipment_id: gid(f.id), order_id: orderId, lines: fl, carrier: tr?.company ?? undefined, tracking_number: tr?.number ?? undefined, handover_at: f.createdAt } });
      if (f.deliveredAt || f.status === 'SUCCESS' && false) out.push({ event_type: 'shipment.delivered', provider_event_id: `fulfillment:${gid(f.id)}:delivered`, occurred_at: f.deliveredAt ?? f.createdAt, correlation_id: corr, payload: { shipment_id: gid(f.id), order_id: orderId, delivered_at: f.deliveredAt ?? undefined } }); }
  }
  for (const r of o.refunds) for (const rt of r.transactions.nodes) {
    if (rt.kind !== 'REFUND') continue; const parent = rt.parentTransaction ? gid(rt.parentTransaction.id) : o.transactions.find((t) => t.kind === 'SALE' || t.kind === 'CAPTURE')?.id;
    if (!parent) continue;
    const ev = rt.status === 'SUCCESS' ? 'refund.completed' : rt.status === 'PENDING' ? 'refund.pending' : 'refund.failed';
    out.push({ event_type: ev, provider_event_id: `refund:${gid(r.id)}:${gid(rt.id)}:${rt.status}`, occurred_at: r.createdAt, correlation_id: corr, payload: { refund_id: gid(rt.id), original_transaction_id: gid(parent), order_id: orderId, amount_minor: Math.abs(minor(rt.amountSet.shopMoney)), currency: rt.amountSet.shopMoney.currencyCode } });
  }
  for (const ret of o.returns?.nodes ?? []) {
    const rl = ret.returnLineItems.nodes.map((n) => ({ line_id: gid(n.fulfillmentLineItem.lineItem.id), item_id: n.fulfillmentLineItem.lineItem.sku ?? 'unknown', quantity: String(n.quantity), unit: 'piece' }));
    const ev = ret.status === 'CANCELED' || ret.status === 'DECLINED' ? 'return.cancelled' : 'return.approved';
    out.push({ event_type: ev, provider_event_id: `return:${gid(ret.id)}:${ret.status}`, occurred_at: o.updatedAt, correlation_id: corr, payload: ev === 'return.approved' ? { return_id: gid(ret.id), order_id: orderId, lines: rl } : { return_id: gid(ret.id) } });
  }
  return out;
}
export function mapInventoryLevel(l: ShopifyInventoryLevel): Observation | null {
  if (!l.item.tracked) return null;
  const q = (n: string) => l.quantities.find((x) => x.name === n)?.quantity;
  const itemId = l.item.sku ?? `inventory_item:${gid(l.item.id)}`;
  const onHand = q('on_hand'); const available = q('available');
  return { event_type: 'inventory.snapshot', provider_event_id: `inventory:${gid(l.item.id)}:${gid(l.location.id)}:${l.updatedAt}`, occurred_at: l.updatedAt, record_id: `item:${itemId}`,
    payload: { item_id: itemId, location_id: gid(l.location.id), unit: 'piece', basis: 'provider_available', physical: onHand !== undefined ? String(onHand) : undefined, available: available !== undefined ? String(available) : undefined, committed: q('committed') !== undefined ? String(q('committed')) : undefined, reserved: q('reserved') !== undefined ? String(q('reserved')) : undefined, damaged: q('damaged') !== undefined ? String(q('damaged')) : undefined, safety_stock: q('safety_stock') !== undefined ? String(q('safety_stock')) : undefined, quality_control: q('quality_control') !== undefined ? String(q('quality_control')) : undefined, incoming: q('incoming') !== undefined ? String(q('incoming')) : undefined, observed_at: l.updatedAt } };
}

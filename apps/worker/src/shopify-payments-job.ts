import { withTenant } from '@blackbox/database';
import { ShopifyClient, ShopifyHttpError, SHOPIFY_MISSING_FIELDS, minor, type AppContext, type IngestService, type SourcesService, type Observation } from '@blackbox/application';

interface Deps { ctx: AppContext; sources: SourcesService; ingest: IngestService }
class JobError extends Error { constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly retryAfterMs: number | null = null) { super(message); } }
const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());

export const LEDGER_QUERY = `query Ledger($first: Int!, $after: String, $query: String) { shopifyPaymentsAccount { id defaultCurrency balance { amount currencyCode }
  balanceTransactions(first: $first, after: $after, query: $query) { pageInfo { hasNextPage endCursor } nodes { id type transactionDate amount { amount currencyCode } fee { amount currencyCode } net { amount currencyCode } sourceId sourceType sourceOrderTransactionId associatedPayout { id status } associatedOrder { id name } } } } }`;
export const PAYOUTS_QUERY = `query Payouts($first: Int!, $after: String) { shopifyPaymentsAccount { payouts(first: $first, after: $after, sortKey: ISSUED_AT, reverse: true) { pageInfo { hasNextPage endCursor } nodes { id status transactionType issuedAt net { amount currencyCode } summary { chargesGross { amount currencyCode } chargesFee { amount currencyCode } refundsFeeGross { amount currencyCode } adjustmentsGross { amount currencyCode } } } } } }`;
export const DISPUTES_QUERY = `query Disputes($first: Int!, $after: String) { shopifyPaymentsAccount { disputes(first: $first, after: $after) { pageInfo { hasNextPage endCursor } nodes { id status type reasonDetails { reason } amount { amount currencyCode } initiatedAt finalizedOn order { id name } } } } }`;
interface Money { amount: string; currencyCode: string }
interface Ledger { id: string; type: string; transactionDate: string; amount: Money; fee: Money; net: Money; sourceId: string | null; sourceType: string | null; sourceOrderTransactionId: string | null; associatedPayout: { id: string; status: string } | null; associatedOrder: { id: string; name: string } | null }
interface Payout { id: string; status: string; transactionType: string; issuedAt: string; net: Money; summary: { chargesGross: Money; chargesFee: Money; refundsFeeGross: Money; adjustmentsGross: Money } }
interface Dispute { id: string; status: string; type: string; reasonDetails: { reason: string } | null; amount: Money; initiatedAt: string; finalizedOn: string | null; order: { id: string; name: string } | null }
const gid = (s: string) => s.replace(/^gid:\/\/shopify\/\w+\//, '');
const POSTING: Record<string, 'charge' | 'refund' | 'fee' | 'adjustment' | 'dispute' | 'dispute_reversal' | 'transfer' | 'reserve'> = { CHARGE: 'charge', REFUND: 'refund', DISPUTE: 'dispute', DISPUTE_REVERSAL: 'dispute_reversal', ADJUSTMENT: 'adjustment', TRANSFER: 'transfer', RESERVE: 'reserve', SHOPIFY_PAYMENTS_FEE: 'fee', ANOMALY_CREDIT: 'adjustment', ANOMALY_DEBIT: 'adjustment' };

/** Exact mapping of the pinned finance resources to canonical observations (ledger, payouts, disputes). Holds/balance breakdown are not available. */
export function mapLedger(l: Ledger, account: string): Observation { return { event_type: 'provider.ledger_posted', provider_event_id: `ledger:${gid(l.id)}`, occurred_at: l.transactionDate, record_id: `ledger_entry:${gid(l.id)}`, payload: { ledger_entry_id: gid(l.id), account_id: account, source_transaction_id: l.sourceOrderTransactionId ? gid(l.sourceOrderTransactionId) : undefined, order_id: l.associatedOrder?.name, payout_id: l.associatedPayout ? gid(l.associatedPayout.id) : undefined, posting_type: POSTING[l.type] ?? 'adjustment', gross_minor: minor(l.amount), fee_minor: Math.abs(minor(l.fee)), net_minor: minor(l.net), currency: l.net.currencyCode, effective_time: l.transactionDate } }; }
export function mapPayout(p: Payout, account: string): Observation[] {
  const base = { account_id: account, amount_minor: Math.abs(minor(p.net)), currency: p.net.currencyCode, trace_reference: gid(p.id) };
  const out: Observation[] = [];
  if (p.status === 'SCHEDULED' || p.status === 'IN_TRANSIT' && false) out.push({ event_type: 'payout.announced', provider_event_id: `payout:${gid(p.id)}:scheduled`, occurred_at: p.issuedAt, payload: { payout_id: gid(p.id), ...base, expected_at: p.issuedAt } });
  if (p.status === 'IN_TRANSIT' || p.status === 'PAID') out.push({ event_type: 'payout.sent', provider_event_id: `payout:${gid(p.id)}:sent`, occurred_at: p.issuedAt, payload: { payout_id: gid(p.id), ...base, issued_at: p.issuedAt } });
  if (p.status === 'FAILED' || p.status === 'CANCELED') out.push({ event_type: 'payout.failed', provider_event_id: `payout:${gid(p.id)}:${p.status}`, occurred_at: p.issuedAt, payload: { payout_id: gid(p.id), reason: p.status } });
  return out;
}
export function mapDispute(d: Dispute): Observation[] {
  const out: Observation[] = [{ event_type: 'dispute.opened', provider_event_id: `dispute:${gid(d.id)}:opened`, occurred_at: d.initiatedAt, payload: { dispute_id: gid(d.id), original_transaction_id: `dispute-source:${gid(d.id)}`, order_id: d.order?.name, amount_minor: Math.abs(minor(d.amount)), currency: d.amount.currencyCode, reason: d.reasonDetails?.reason } }];
  if (d.status === 'WON' || d.status === 'LOST' || d.status === 'ACCEPTED') out.push({ event_type: 'dispute.resolved', provider_event_id: `dispute:${gid(d.id)}:${d.status}`, occurred_at: d.finalizedOn ? `${d.finalizedOn}T00:00:00Z` : d.initiatedAt, payload: { dispute_id: gid(d.id), outcome: d.status === 'WON' ? 'won' : d.status === 'LOST' ? 'lost' : 'withdrawn' } });
  return out;
}

export async function runShopifyPaymentsImport(d: Deps, tenantId: string, connectionId: string, runKind: string, attempt: number) {
  const { ctx, sources, ingest } = d; const log = ctx.log.child({ tenant_id: tenantId, connection_id: connectionId });
  const conn = await withTenant(ctx.db, tenantId, async (tx) => (await tx`SELECT * FROM connections WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId}`)[0]);
  if (!conn || conn.status !== 'configured') return;
  const token = await sources.secret(tenantId, connectionId); if (!token) throw new JobError('token_missing', 'no access token stored', false);
  const pub = conn.config_public as Record<string, unknown>; const account = conn.account_namespace as string;
  const client = new ShopifyClient({ shopDomain: account, accessToken: token, baseUrl: typeof pub.base_url === 'string' ? pub.base_url : undefined });
  const plan = await sources.currentPlan(tenantId, connectionId);
  const kind = runKind === 'initial' ? 'initial' : runKind === 'reconciliation' ? 'reconciliation' : 'incremental';
  const runId = await sources.startRun(tenantId, connectionId, kind as 'initial', { attempt }); const rlog = log.child({ run_id: runId, attempt }); const now = ctx.now();
  const caps = ['provider_ledger', 'payouts', 'disputes', 'refunds', 'positions', 'holds'];
  const mark = async (cs: string[], patch: Record<string, unknown>) => { for (const c of cs) await sources.touchCapability(tenantId, connectionId, c, patch); };
  try {
    await sources.updateRun(tenantId, runId, { phase: 'check_connection' }); const scopes = await client.accessScopes();
    if (!scopes.scopes.includes('read_shopify_payments_payouts')) { await mark(caps, { collection_state: 'blocked', restrictions: [{ capability: 'provider_ledger', reason: 'read_shopify_payments_payouts not granted' }] }); throw new JobError('scope_missing', 'read_shopify_payments_payouts not granted', false); }
    await mark(caps, { last_attempt_at: now, collection_state: kind === 'initial' ? 'backfilling' : 'catching_up' });
    const since = kind === 'initial' ? iso(plan?.requested_from) : new Date(now.getTime() - 48 * 3600_000).toISOString();
    await sources.updateRun(tenantId, runId, { phase: 'import_records', counters: { requested_from: since } });
    let committed = 0, pages = 0; let after: string | null = null; let lastNew: Date | null = null;
    const fetchPaged = async <T>(query: string, pick: (data: Record<string, unknown>) => { nodes: T[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }, vars: Record<string, unknown>, map: (n: T) => Observation[]) => {
      after = null;
      do { let data; try { data = (await client.graphql<Record<string, unknown>>(query, { first: 50, after, ...vars })).data; } catch (err) { if (err instanceof ShopifyHttpError) throw new JobError(err.status === 429 ? 'rate_limited' : err.status === 401 || err.status === 403 ? 'authorization_expired' : 'provider_unavailable', err.message, !(err.status === 401 || err.status === 403), err.retryAfterMs); throw err; }
        const page = pick(data); pages++; const obs = page.nodes.flatMap(map); const out = await ingest.ingest({ tenantId, connectionId, providerNamespace: `shopify_payments:${account}`, runId }, obs); committed += out.accepted.length; if (out.accepted.length) lastNew = ctx.now(); after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        rlog.info('import.page_processed', 'finance page committed', { record_count: page.nodes.length, operation_id: `page:${pages}` }); } while (after);
    };
    const acct = (data: Record<string, unknown>) => data.shopifyPaymentsAccount as Record<string, unknown> | null;
    const first = await client.graphql<Record<string, unknown>>(LEDGER_QUERY, { first: 1, after: null, query: null });
    const accountNode = acct(first.data);
    if (!accountNode) { await mark(caps, { collection_state: 'blocked', restrictions: [{ capability: 'provider_ledger', reason: 'this shop has no Shopify Payments account' }] }); throw new JobError('no_payments_account', 'shop has no Shopify Payments account', false); }
    const balance = accountNode.balance as Money | null;
    if (balance) await ingest.ingest({ tenantId, connectionId, providerNamespace: `shopify_payments:${account}`, runId }, [{ event_type: 'provider.balance_observed', provider_event_id: `balance:${account}:${now.toISOString().slice(0, 13)}`, occurred_at: now.toISOString(), payload: { account_id: account, currency: balance.currencyCode, observed_at: now.toISOString(), total_minor: minor(balance), coverage: 'total_only' } }]);
    await fetchPaged<Ledger>(LEDGER_QUERY, (d) => (acct(d)!.balanceTransactions as never), { query: since ? `transaction_date:>='${since.slice(0, 10)}'` : null }, (l) => [mapLedger(l, account)]);
    await fetchPaged<Payout>(PAYOUTS_QUERY, (d) => (acct(d)!.payouts as never), {}, (p) => mapPayout(p, account));
    if (scopes.scopes.includes('read_shopify_payments_disputes')) await fetchPaged<Dispute>(DISPUTES_QUERY, (d) => (acct(d)!.disputes as never), {}, mapDispute);
    const hwm = await withTenant(ctx.db, tenantId, async (tx) => Number((await tx`SELECT next_sequence - 1 AS h FROM tenant_sequences WHERE tenant_id = ${tenantId}`)[0]?.h ?? 0));
    await mark(['provider_ledger', 'payouts', 'disputes', 'refunds'], { collection_state: 'ready', last_successful_sync_at: ctx.now(), last_import_completed_at: ctx.now(), last_import_outcome: `${kind} complete`, last_received_at: ctx.now(), last_new_record_at: lastNew ?? undefined, last_journal_commit_at: committed ? ctx.now() : undefined, next_poll_at: new Date(ctx.now().getTime() + 15 * 60_000), next_poll_reason: 'scheduled finance poll (15 min)', coverage: { requested_from: since, complete_through: now.toISOString(), history_kind: 'event_history' } });
    await mark(['positions'], { collection_state: 'ready', last_successful_sync_at: ctx.now(), coverage: { history_kind: 'snapshot_only', basis: 'total_only', missing_fields: SHOPIFY_MISSING_FIELDS.positions } });
    await mark(['holds'], { collection_state: 'blocked', restrictions: [{ capability: 'holds', reason: 'hold identity, reason and release promises are not exposed by the pinned finance API; supply them through the generic producer' }], next_poll_at: null, next_poll_reason: 'unsupported by provider' });
    const covObs = [['provider_ledger', SHOPIFY_MISSING_FIELDS.provider_ledger ?? []], ['payouts', SHOPIFY_MISSING_FIELDS.payouts ?? ['reversal_id']], ['disputes', SHOPIFY_MISSING_FIELDS.disputes ?? []], ['positions', SHOPIFY_MISSING_FIELDS.positions ?? []], ['refunds', ['destination']]].map(([cap, missing]) => ({ event_type: 'coverage.observed', provider_event_id: `coverage:${cap}:${connectionId}:${runId}`, occurred_at: ctx.now().toISOString(), payload: { capability: cap as string, entity_scope: `shopify_payments:${account}`, history_start: since, complete_through: now.toISOString(), backfill_complete: true, coverage_basis: `${kind} finance import fully paginated (${pages} pages)`, missing_fields: missing as string[] } }));
    covObs.push({ event_type: 'coverage.gap_recorded', provider_event_id: `coverage:holds:${connectionId}:gap`, occurred_at: ctx.now().toISOString(), payload: { capability: 'holds', from: since ?? now.toISOString(), to: null, reason: 'holds are not exposed by the pinned Shopify Payments resources' } as never });
    await ingest.ingest({ tenantId, connectionId, providerNamespace: 'runtime', runId }, covObs as Observation[]);
    await sources.updateRun(tenantId, runId, { state: 'complete', phase: 'ready', outcome: `${committed} finance observations committed over ${pages} pages`, counters: { pages, observations_committed: committed, committed_cursor: hwm } });
    rlog.info('import.run_completed', `${kind} finance import completed`, { record_count: committed, committed_cursor: hwm });
  } catch (err) { const e = err as Error & { code?: string; retryable?: boolean }; await sources.updateRun(tenantId, runId, { state: e.retryable === false ? 'failed' : 'running', error: { code: e.code ?? 'import_failed', message: e.message.slice(0, 200), retryable: e.retryable ?? true }, next_action: e.retryable === false ? 'owner action required (see Sources)' : 'automatic retry scheduled' }); throw err; }
}

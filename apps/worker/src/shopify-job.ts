import { withTenant } from '@blackbox/database';
import { mapInventoryLevel, mapOrder, ShopifyClient, ShopifyHttpError, SHOPIFY_MISSING_FIELDS, type AppContext, type IngestService, type SourcesService } from '@blackbox/application';

interface Deps { ctx: AppContext; sources: SourcesService; ingest: IngestService }
class JobError extends Error { constructor(public readonly code: string, message: string, public readonly retryable: boolean, public readonly retryAfterMs: number | null = null) { super(message); } }

const iso = (v: unknown): string | null => (v === null || v === undefined ? null : new Date(v as string).toISOString());
const PAGE = 50; const OVERLAP_MS = 10 * 60_000; const POLL_MS = 5 * 60_000; const MAX_PAGES_PER_RUN = 200;

/**
 * Shopify import/poll/reconciliation (local_standalone): cursor pagination over `updated_at`, overlap window,
 * per-page durable commit before advancing the checkpoint, Retry-After, 429 backoff, token-expiry detection.
 */
export async function runShopifyImport(d: Deps, tenantId: string, connectionId: string, runKind: string, attempt: number) {
  const { ctx, sources, ingest } = d; const log = ctx.log.child({ tenant_id: tenantId, connection_id: connectionId });
  const conn = await withTenant(ctx.db, tenantId, async (tx) => (await tx`SELECT * FROM connections WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId}`)[0]);
  if (!conn) throw new JobError('connection_missing', 'connection not found', false);
  if (conn.status !== 'configured') { log.info('import.skipped', `connection ${conn.status}; no import`); return; }
  const token = await sources.secret(tenantId, connectionId); if (!token) throw new JobError('token_missing', 'no access token stored', false);
  const pub = conn.config_public as Record<string, unknown>;
  const client = new ShopifyClient({ shopDomain: conn.account_namespace as string, accessToken: token, baseUrl: typeof pub.base_url === 'string' ? pub.base_url : undefined });
  const plan = await sources.currentPlan(tenantId, connectionId);
  const caps = await withTenant(ctx.db, tenantId, (tx) => tx`SELECT capability, cursor, collection_state, coverage FROM capability_state WHERE connection_id = ${connectionId} AND tenant_id = ${tenantId}`);
  const orderCap = caps.find((c) => c.capability === 'orders');
  const kind: 'initial' | 'incremental' | 'reconciliation' | 'history_expansion' = (runKind === 'initial' && orderCap?.collection_state !== 'ready') ? 'initial' : runKind === 'reconciliation' ? 'reconciliation' : runKind === 'history_expansion' ? 'history_expansion' : 'incremental';
  const runId = await sources.startRun(tenantId, connectionId, kind, { attempt });
  const rlog = log.child({ run_id: runId, attempt });
  const now = ctx.now();
  // allocations (reservations) and receipts (return receipts) are derived from the same orders/fulfillments/returns pages: one poll advances them all
  const orderCaps = ['orders', 'payments', 'refunds', 'fulfillments', 'returns', 'allocations', 'receipts'].filter((c) => caps.some((k) => k.capability === c));
  const mark = async (patch: Record<string, unknown>) => { for (const c of orderCaps) await sources.touchCapability(tenantId, connectionId, c, patch); };
  try {
    // 1) check connection: account identity + granted scopes (a successful credential check is not an import)
    await sources.updateRun(tenantId, runId, { phase: 'check_connection', attempt });
    const scopes = await client.accessScopes();
    if (pub.shop_id && scopes.shop.id !== pub.shop_id) { await sources.setStatus(tenantId, connectionId, 'blocked'); await mark({ collection_state: 'blocked' }); throw new JobError('account_identity_changed', `shop identity ${scopes.shop.id} differs from the connected account ${pub.shop_id}; a different account needs a new connection`, false); }
    await mark({ last_attempt_at: now, collection_state: kind === 'initial' ? 'backfilling' : 'catching_up' });
    rlog.info('import.run_started', `${kind} import started`, { operation_id: 'check_connection' });
    // 2) import records: window from the plan (or the capability cursor with overlap)
    const cursor = (orderCap?.cursor as { updated_since?: string; page_cursor?: string | null; complete_through?: string } | null) ?? null;
    let since: string | null;
    if (kind === 'initial' || kind === 'history_expansion') since = iso(plan?.requested_from); else if (kind === 'reconciliation') since = new Date(now.getTime() - 48 * 3600_000).toISOString(); else since = cursor?.updated_since ? new Date(new Date(cursor.updated_since).getTime() - OVERLAP_MS).toISOString() : iso(plan?.requested_from) ?? new Date(now.getTime() - 30 * 86400_000).toISOString();
    const until = kind === 'initial' || kind === 'history_expansion' ? iso(plan?.initial_cutoff) ?? now.toISOString() : now.toISOString();
    const q = [since ? `updated_at:>='${since}'` : null, `updated_at:<='${until}'`, kind === 'initial' && plan?.strict_from_now ? null : null].filter(Boolean).join(' AND ');
    await sources.updateRun(tenantId, runId, { phase: 'import_records', counters: { requested_from: since, requested_to: until } });
    let after: string | null = kind === 'initial' && cursor?.page_cursor ? cursor.page_cursor : null; // resume an interrupted initial import
    let pages = 0, orders = 0, committed = 0, duplicates = 0, conflicts = 0, lastNew: Date | null = null, maxUpdated: string | null = since;
    do {
      let page;
      try { page = await client.orders(q, after, PAGE); }
      catch (err) { if (err instanceof ShopifyHttpError) { if (err.status === 401 || err.status === 403) { await sources.setStatus(tenantId, connectionId, 'reauthorization_required'); await mark({ collection_state: 'reauthorization_required', retry_state: { error_code: 'authorization_expired', consecutive_failures: 1 }, next_poll_at: null, next_poll_reason: 'reconnect required: source authorization expired' }); throw new JobError('authorization_expired', 'Source authorization expired; reconnect required', false); } await mark({ retry_state: { error_code: err.status === 429 ? 'rate_limited' : 'provider_unavailable', consecutive_failures: attempt, next_retry_ms: err.retryAfterMs } }); rlog.warn('import.retry_scheduled', err.status === 429 ? 'Provider rate limit reached; retry scheduled' : 'Provider unavailable; retry scheduled', { error_code: err.status === 429 ? 'rate_limited' : 'provider_unavailable', retryable: true, record_count: pages }); throw new JobError(err.status === 429 ? 'rate_limited' : 'provider_unavailable', err.message, true, err.retryAfterMs); } throw err; }
      pages++;
      const observations = page.nodes.flatMap((o) => mapOrder(o, conn.account_namespace as string));
      for (const o of page.nodes) { if (o.updatedAt > (maxUpdated ?? '')) maxUpdated = o.updatedAt; }
      // commit this page durably, then advance the page checkpoint (a failed page never advances)
      const out = await ingest.ingest({ tenantId, connectionId, providerNamespace: `shopify:${conn.account_namespace}`, runId }, observations);
      orders += page.nodes.length; committed += out.accepted.length; duplicates += out.duplicates; conflicts += out.conflicts.length; if (out.accepted.length) lastNew = ctx.now();
      after = page.hasNextPage ? page.endCursor : null;
      await mark({ cursor: { updated_since: cursor?.updated_since ?? since, page_cursor: after, complete_through: cursor?.complete_through ?? null }, last_received_at: ctx.now(), last_new_record_at: lastNew ?? undefined, last_journal_commit_at: out.accepted.length ? ctx.now() : undefined, pending_count: page.hasNextPage ? 1 : 0, quarantined_count: out.rejected.length });
      await sources.updateRun(tenantId, runId, { counters: { pages, orders_fetched: orders, observations_committed: committed, duplicates, conflicts, total_known: false }, cursor: { page_cursor: after } });
      rlog.info('import.page_processed', 'provider page committed', { record_count: page.nodes.length, operation_id: `page:${pages}` });
      if (pages >= MAX_PAGES_PER_RUN && after) { rlog.warn('import.page_budget', 'page budget reached; remaining pages continue in the next run', { error_code: 'page_budget_reached', retryable: true, record_count: pages }); break; }
    } while (after);
    // inventory snapshots (stock capability)
    let inventory = 0;
    if (caps.some((c) => c.capability === 'stock')) {
      let iAfter: string | null = null;
      do { const page = await client.inventoryLevels(iAfter, 100); const obs = page.nodes.map(mapInventoryLevel).filter((x): x is NonNullable<typeof x> => x !== null); const out = await ingest.ingest({ tenantId, connectionId, providerNamespace: `shopify:${conn.account_namespace}`, runId }, obs); inventory += out.accepted.length; iAfter = page.hasNextPage ? page.endCursor : null; } while (iAfter);
      await sources.touchCapability(tenantId, connectionId, 'stock', { collection_state: 'ready', last_attempt_at: now, last_successful_sync_at: ctx.now(), last_received_at: ctx.now(), last_new_record_at: inventory ? ctx.now() : undefined, next_poll_at: new Date(ctx.now().getTime() + 15 * 60_000), next_poll_reason: 'scheduled inventory poll', coverage: { history_kind: 'snapshot_only', basis: 'provider_available', missing_fields: SHOPIFY_MISSING_FIELDS.stock } });
    }
    // 3) link and process: the engine derives/applies; we record the committed cutoff for readiness
    await sources.updateRun(tenantId, runId, { phase: 'link_and_process' });
    const hwm = await withTenant(ctx.db, tenantId, async (tx) => Number((await tx`SELECT next_sequence - 1 AS h FROM tenant_sequences WHERE tenant_id = ${tenantId}`)[0]?.h ?? 0));
    const incomplete = Boolean(after);
    const completeThrough = incomplete ? (cursor?.complete_through ?? null) : until;
    const restrictions = (await withTenant(ctx.db, tenantId, (tx) => tx`SELECT restrictions FROM capability_state WHERE connection_id = ${connectionId} AND capability = 'orders'`))[0]?.restrictions as unknown[] | undefined;
    const historyLimited = !scopes.scopes.includes('read_all_orders');
    const effectiveStart = historyLimited && since && new Date(since) < new Date(now.getTime() - 60 * 86400_000) ? new Date(now.getTime() - 60 * 86400_000).toISOString() : since;
    await mark({ collection_state: incomplete ? 'backfilling' : 'ready', last_successful_sync_at: incomplete ? undefined : ctx.now(), last_import_completed_at: incomplete ? undefined : ctx.now(), last_import_outcome: incomplete ? undefined : `${kind} complete`, last_reconciliation_at: kind === 'reconciliation' ? ctx.now() : undefined, pending_count: incomplete ? 1 : 0,
      cursor: { updated_since: incomplete ? (cursor?.updated_since ?? since) : maxUpdated ?? until, page_cursor: after, complete_through: completeThrough }, next_poll_at: new Date(ctx.now().getTime() + (incomplete ? 5_000 : POLL_MS)), next_poll_reason: incomplete ? 'continuing initial import' : 'scheduled incremental poll (5 min, 10 min overlap)',
      coverage: { requested_from: since, accessible_from: effectiveStart, complete_through: completeThrough, history_kind: 'event_history', history_limited_to_60_days: historyLimited, missing_fields: SHOPIFY_MISSING_FIELDS.allocations, provider_test_data: pub.fixture ? 'fixture (synthetic, provider-shaped)' : undefined }, restrictions: restrictions ?? [] });
    // 4) runtime coverage observation per capability (what the orders feed actually covers)
    if (!incomplete) {
      const covObs = orderCaps.map((cap) => ({ event_type: 'coverage.observed', provider_event_id: `coverage:${cap}:${connectionId}:${runId}`, occurred_at: ctx.now().toISOString(), payload: { capability: cap, entity_scope: `shopify:${conn.account_namespace}`, history_start: effectiveStart, complete_through: completeThrough, backfill_complete: true, coverage_basis: `${kind} import ${since ?? 'open'}..${until} fully paginated (${pages} pages, ${orders} orders)${historyLimited ? '; read_all_orders not granted: history limited to 60 days' : ''}`, missing_fields: SHOPIFY_MISSING_FIELDS[cap] ?? [] } }));
      if (caps.some((c) => c.capability === 'stock')) covObs.push({ event_type: 'coverage.observed', provider_event_id: `coverage:stock:${connectionId}:${runId}`, occurred_at: ctx.now().toISOString(), payload: { capability: 'stock', entity_scope: `shopify:${conn.account_namespace}`, history_start: null, complete_through: ctx.now().toISOString(), backfill_complete: true, coverage_basis: 'inventory levels snapshot (provider available basis); no movement history', missing_fields: SHOPIFY_MISSING_FIELDS.stock ?? [] } });
      await ingest.ingest({ tenantId, connectionId, providerNamespace: 'runtime', runId }, covObs);
    }
    await sources.updateRun(tenantId, runId, { state: incomplete ? 'running' : conflicts ? 'complete_with_gaps' : 'complete', phase: incomplete ? 'import_records' : 'ready', outcome: incomplete ? 'page budget reached; continuing' : `${orders} orders fetched, ${committed} observations committed, ${duplicates} duplicates, ${conflicts} conflicts, ${inventory} inventory snapshots`, counters: { pages, orders_fetched: orders, observations_committed: committed, duplicates, conflicts, inventory_snapshots: inventory, committed_cursor: hwm } });
    rlog.info('import.run_completed', `${kind} import ${incomplete ? 'paused at page budget' : 'completed'}`, { record_count: committed, committed_cursor: hwm, operation_id: kind });
  } catch (err) {
    const e = err as Error & { code?: string; retryable?: boolean };
    await sources.updateRun(tenantId, runId, { state: e.retryable === false ? 'failed' : 'running', phase: 'import_records', error: { code: e.code ?? 'import_failed', message: e.message.slice(0, 200), retryable: e.retryable ?? true }, next_action: e.retryable === false ? 'owner action required (see Sources)' : 'automatic retry scheduled' });
    throw err;
  }
}

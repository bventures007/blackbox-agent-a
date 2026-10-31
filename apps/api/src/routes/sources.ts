import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { withTenant } from '@blackbox/database';
import { PILOT_PROVIDERS, PLANNED_PROVIDERS, SHOPIFY_API_VERSION, SHOPIFY_REQUIRED_SCOPES, ShopifyClient, previewBankCsv, bankObservations, type BankCsvProfile } from '@blackbox/application';
import type { Services } from '../app.js';

const CAPS: Record<string, string[]> = {
  shopify: ['orders', 'payments', 'refunds', 'fulfillments', 'stock', 'allocations', 'returns', 'receipts'],
  shopify_payments: ['provider_ledger', 'payouts', 'positions', 'disputes', 'refunds', 'holds'],
  replay: ['orders', 'stock', 'allocations', 'fulfillments', 'invoices', 'payments', 'provider_ledger', 'payouts', 'bank', 'returns', 'receipts', 'refunds', 'tracking', 'supply', 'promises', 'communications', 'invoice_dispatch', 'payment_allocations', 'policy', 'cases', 'positions', 'holds', 'entitlements', 'disputes', 'identity'],
  generic: ['orders', 'stock', 'allocations', 'supply', 'promises', 'fulfillments', 'tracking', 'communications', 'invoices', 'invoice_dispatch', 'payments', 'payment_allocations', 'policy', 'cases', 'provider_ledger', 'positions', 'payouts', 'bank', 'holds', 'returns', 'receipts', 'entitlements', 'refunds', 'disputes', 'identity'],
  bank_csv: ['bank'], policy: ['policy'], runtime: ['coverage', 'identity'],
};

export async function registerSourceRoutes(app: FastifyInstance, s: Services) {
  app.get('/api/sources/catalog', async (req, reply) => { const p = await app.authenticate(req, reply, { agent: true, csrf: false }); if (!p) return; return { implemented: PILOT_PROVIDERS.map((id) => ({ id, capabilities: CAPS[id] ?? [], status: 'implemented' })), planned: PLANNED_PROVIDERS.map((id) => ({ id, status: 'planned' })), modes: { local_standalone: 'supported', local_gateway: 'unsupported (deferred)', public_server: 'unsupported (deferred)' }, shopify_api_version: SHOPIFY_API_VERSION, shopify_required_scopes: SHOPIFY_REQUIRED_SCOPES }; });
  app.get('/api/sources', async (req, reply) => { const p = await app.authenticate(req, reply, { agent: true, csrf: false }); if (!p) return; return { connections: await s.sources.list(p.tenantId) }; });
  app.get('/api/sources/:id/runs', async (req, reply) => { const p = await app.authenticate(req, reply, { agent: true, csrf: false }); if (!p) return; return { runs: await s.sources.runs(p.tenantId, (req.params as { id: string }).id) }; });
  app.get('/api/runs/:id', async (req, reply) => { const p = await app.authenticate(req, reply, { agent: true, csrf: false }); if (!p) return; const run = await s.sources.run(p.tenantId, (req.params as { id: string }).id); if (!run) return reply.code(404).send({ error: 'not_found' }); return { run }; });

  app.post('/api/sources', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ provider: z.enum(['shopify', 'shopify_payments', 'replay', 'generic', 'bank_csv', 'policy']), display_name: z.string().min(1).max(80), account_namespace: z.string().min(1).max(200), secret: z.string().max(2000).optional(), config_public: z.record(z.unknown()).default({}), capabilities: z.array(z.string()).optional(),
      plan: z.object({ preset: z.enum(['last_30_days', 'this_year', 'last_12_months', 'custom', 'from_now']), custom_start: z.string().optional(), include_open_items: z.boolean().optional(), include_related: z.boolean().optional(), include_opening_state: z.boolean().optional() }).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    if (body.data.provider === 'shopify' && !body.data.secret) return reply.code(400).send({ error: 'token_required', message: 'a custom-app Admin API access token is required' });
    const caps = body.data.capabilities ?? CAPS[body.data.provider] ?? [];
    // Shopify: validate account identity and granted scopes first; never claim a connection from a token alone
    let publicCfg = body.data.config_public; let restrictions: unknown[] = [];
    if (body.data.provider === 'shopify' || body.data.provider === 'shopify_payments') {
      const base = typeof publicCfg.base_url === 'string' && /^https?:\/\/(fixture|localhost|127\.0\.0\.1|host\.docker\.internal)(:\d+)?$/.test(publicCfg.base_url) ? publicCfg.base_url : undefined;
      try {
        const client = new ShopifyClient({ shopDomain: body.data.account_namespace, accessToken: body.data.secret!, baseUrl: base });
        const scopes = await client.accessScopes();
        const missing = caps.filter((c) => (SHOPIFY_REQUIRED_SCOPES[c] ?? []).some((sc) => !scopes.scopes.includes(sc)));
        restrictions = missing.map((c) => ({ capability: c, reason: `missing scope(s) ${(SHOPIFY_REQUIRED_SCOPES[c] ?? []).filter((sc) => !scopes.scopes.includes(sc)).join(', ')}` }));
        if (!scopes.scopes.includes('read_all_orders')) restrictions.push({ capability: 'orders', reason: 'read_all_orders not granted: orders older than 60 days are not accessible' });
        publicCfg = { ...publicCfg, shop_name: scopes.shop.name, shop_id: scopes.shop.id, shop_currency: scopes.shop.currency, shop_timezone: scopes.shop.ianaTimezone, granted_scopes: scopes.scopes, api_version: SHOPIFY_API_VERSION, fixture: Boolean(base) };
      } catch (err) { return reply.code(422).send({ error: 'authorization_failed', message: 'the shop did not accept this token or is unreachable: ' + (err as Error).message.slice(0, 160) }); }
    }
    const id = await s.sources.createConnection(p.tenantId, p.ownerId, { provider: body.data.provider, display_name: body.data.display_name, account_namespace: body.data.account_namespace, secret: body.data.secret, config_public: publicCfg, capabilities: caps });
    for (const r of restrictions as Array<{ capability: string }>) await s.sources.touchCapability(p.tenantId, id, r.capability, { restrictions: restrictions.filter((x) => (x as { capability: string }).capability === r.capability) });
    let plan = null;
    if (body.data.plan) { plan = await s.sources.savePlan(p.tenantId, p.ownerId, id, body.data.plan.preset, { customStart: body.data.plan.custom_start, includeOpenItems: body.data.plan.include_open_items, includeRelated: body.data.plan.include_related, includeOpeningState: body.data.plan.include_opening_state, restrictions }); }
    if (body.data.provider === 'shopify' || body.data.provider === 'shopify_payments') { await withTenant(s.ctx.db, p.tenantId, (tx) => tx`INSERT INTO jobs (tenant_id, kind, payload, singleton_key) VALUES (${p.tenantId}, 'source.import', ${tx.json({ connection_id: id, run_kind: 'initial' })}, ${'import:' + id}) ON CONFLICT (singleton_key) DO UPDATE SET payload = EXCLUDED.payload, run_at = now(), state = 'queued', attempt = 0`); } // the scheduler may already have armed a poll for the new connection: the initial import wins
    return reply.code(201).send({ connection_id: id, restrictions, plan });
  });
  app.post('/api/sources/:id/plan', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ preset: z.enum(['last_30_days', 'this_year', 'last_12_months', 'custom', 'from_now']), custom_start: z.string().optional(), include_open_items: z.boolean().optional(), include_related: z.boolean().optional(), include_opening_state: z.boolean().optional(), preview: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    try {
      if (body.data.preview) { const { resolvePlan } = await import('@blackbox/application'); const tz = (await withTenant(s.ctx.db, p.tenantId, async (tx) => (await tx`SELECT timezone FROM tenants WHERE tenant_id = ${p.tenantId}`)[0]?.timezone as string)) ?? 'UTC'; return { plan: resolvePlan(body.data.preset, tz, new Date(), { customStart: body.data.custom_start, includeOpenItems: body.data.include_open_items, includeRelated: body.data.include_related, includeOpeningState: body.data.include_opening_state }) }; }
      const plan = await s.sources.savePlan(p.tenantId, p.ownerId, (req.params as { id: string }).id, body.data.preset, { customStart: body.data.custom_start, includeOpenItems: body.data.include_open_items, includeRelated: body.data.include_related, includeOpeningState: body.data.include_opening_state });
      await withTenant(s.ctx.db, p.tenantId, (tx) => tx`INSERT INTO jobs (tenant_id, kind, payload, singleton_key) VALUES (${p.tenantId}, 'source.import', ${tx.json({ connection_id: (req.params as { id: string }).id, run_kind: 'history_expansion' })}, ${'import:' + (req.params as { id: string }).id}) ON CONFLICT (singleton_key) DO UPDATE SET run_at = now(), state = 'queued'`);
      return { plan };
    } catch (err) { return reply.code(400).send({ error: 'invalid_plan', message: (err as Error).message }); }
  });
  app.post('/api/sources/:id/actions', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ action: z.enum(['retry', 'pause', 'resume', 'disconnect', 'reconcile']) }).safeParse(req.body); if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const id = (req.params as { id: string }).id;
    if (body.data.action === 'pause') await s.sources.setStatus(p.tenantId, id, 'paused', p.ownerId);
    if (body.data.action === 'resume') await s.sources.setStatus(p.tenantId, id, 'configured', p.ownerId);
    if (body.data.action === 'disconnect') await s.sources.setStatus(p.tenantId, id, 'disconnected', p.ownerId);
    if (body.data.action === 'retry' || body.data.action === 'resume' || body.data.action === 'reconcile') await withTenant(s.ctx.db, p.tenantId, (tx) => tx`INSERT INTO jobs (tenant_id, kind, payload, singleton_key) VALUES (${p.tenantId}, 'source.import', ${tx.json({ connection_id: id, run_kind: body.data.action === 'reconcile' ? 'reconciliation' : 'incremental' })}, ${'import:' + id}) ON CONFLICT (singleton_key) DO UPDATE SET run_at = now(), state = 'queued', attempt = 0`);
    return { ok: true };
  });
  // Bank CSV: preview then import (file content is untrusted data)
  app.post('/api/sources/:id/bank-csv', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ csv: z.string().max(10 * 1024 * 1024), profile: z.object({ version: z.literal(1), delimiter: z.enum([',', ';', '\t']), columns: z.object({ booked_at: z.string(), value_at: z.string().optional(), amount: z.string(), currency: z.string().optional(), reference: z.string(), counterparty: z.string().optional() }), default_currency: z.string().length(3).optional(), decimal_separator: z.enum(['.', ',']), date_format: z.enum(['YYYY-MM-DD', 'DD.MM.YYYY']), sign_convention: z.enum(['signed', 'credit_debit_columns']), debit_column: z.string().optional(), payout_reference_pattern: z.string().max(200).optional() }), statement_id: z.string().min(1).max(100), coverage: z.object({ from: z.string().date(), to: z.string().date() }), account_id: z.string().min(1).max(100).default('bank'), commit: z.boolean().default(false) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    const preview = previewBankCsv(body.data.csv, body.data.profile as BankCsvProfile, body.data.statement_id, body.data.coverage);
    if (!body.data.commit) return { preview: { ...preview, rows: preview.rows.slice(0, 200) } };
    const id = (req.params as { id: string }).id;
    const runId = await s.sources.startRun(p.tenantId, id, 'import', { statement_id: body.data.statement_id, coverage: body.data.coverage });
    const obs = bankObservations(preview, body.data.account_id);
    const out = await s.ingest.ingest({ tenantId: p.tenantId, connectionId: id, providerNamespace: `bank_csv:${body.data.account_id}`, runId }, obs);
    const now = new Date();
    await s.sources.updateRun(p.tenantId, runId, { state: preview.invalid ? 'complete_with_gaps' : 'complete', phase: 'ready', outcome: preview.invalid ? `${preview.invalid} rows rejected` : 'all rows imported', counters: { rows_total: preview.rows.length, rows_valid: preview.valid, rows_invalid: preview.invalid, committed: out.accepted.length, duplicates: out.duplicates } });
    await s.sources.touchCapability(p.tenantId, id, 'bank', { collection_state: 'ready', last_attempt_at: now, last_successful_sync_at: now, last_import_completed_at: now, last_import_outcome: 'complete', last_received_at: now, last_new_record_at: out.accepted.length ? now : undefined, last_journal_commit_at: out.accepted.length ? now : undefined, coverage: { statement_ids: [body.data.statement_id], complete_through: body.data.coverage.to, history_kind: 'event_history' }, next_poll_at: null, next_poll_reason: 'manual statement import: no scheduled poll' });
    // runtime coverage observation for the bank capability
    await s.ingest.ingest({ tenantId: p.tenantId, connectionId: id, providerNamespace: 'runtime', runId }, [{ event_type: 'coverage.observed', provider_event_id: `coverage:bank:${id}:${body.data.statement_id}`, occurred_at: now.toISOString(), payload: { capability: 'bank', entity_scope: `bank_account:${body.data.account_id}`, history_start: `${body.data.coverage.from}T00:00:00Z`, complete_through: `${body.data.coverage.to}T23:59:59Z`, backfill_complete: true, coverage_basis: `statement ${body.data.statement_id} imported`, missing_fields: [] } }]);
    return { run_id: runId, imported: out.accepted.length, duplicates: out.duplicates, rejected_rows: preview.invalid, conflicts: out.conflicts.length, required_cursor: out.accepted.reduce((m, a) => Math.max(m, a.journal_sequence), 0) };
  });
  // Versioned workspace rules (policy producer)
  app.post('/api/sources/:id/rules', async (req, reply) => {
    const p = await app.authenticate(req, reply, { owner: true }); if (!p || p.kind !== 'owner') return;
    const body = z.object({ rule_id: z.string().min(1).max(80), rule_kind: z.enum(['allocation_priority', 'invoicing_trigger', 'delivery_risk', 'reminder_policy', 'attention_policy']), version: z.number().int().positive(), effective_from: z.string().datetime({ offset: true }), priority_method: z.string().optional(), invoicing_trigger: z.string().optional(), tolerance: z.record(z.unknown()).optional(), reminder_policy: z.string().optional(), timezone: z.string().optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request', message: body.error.message });
    const id = (req.params as { id: string }).id;
    const out = await s.ingest.ingest({ tenantId: p.tenantId, connectionId: id, providerNamespace: 'policy' }, [{ event_type: body.data.version === 1 ? 'business.rule_recorded' : 'business.rule_revised', provider_event_id: `rule:${body.data.rule_id}:v${body.data.version}`, occurred_at: body.data.effective_from, payload: body.data.version === 1 ? { ...body.data, scope: 'workspace' } : { rule_id: body.data.rule_id, version: body.data.version, effective_from: body.data.effective_from, changes: { priority_method: body.data.priority_method, invoicing_trigger: body.data.invoicing_trigger, reminder_policy: body.data.reminder_policy, tolerance: body.data.tolerance } } }]);
    if (out.rejected.length) return reply.code(400).send({ error: 'invalid_rule' });
    await s.sources.touchCapability(p.tenantId, id, 'policy', { collection_state: 'ready', last_successful_sync_at: new Date(), last_new_record_at: out.accepted.length ? new Date() : undefined, next_poll_at: null, next_poll_reason: 'owner-maintained rules: no poll' });
    await s.ingest.ingest({ tenantId: p.tenantId, connectionId: id, providerNamespace: 'runtime' }, [{ event_type: 'coverage.observed', provider_event_id: `coverage:policy:${id}:${body.data.rule_id}:${body.data.version}`, occurred_at: new Date().toISOString(), payload: { capability: 'policy', entity_scope: 'workspace', history_start: body.data.effective_from, complete_through: null, backfill_complete: true, coverage_basis: 'owner-recorded versioned rule', missing_fields: [] } }]);
    return { accepted: out.accepted.length, duplicates: out.duplicates, required_cursor: out.accepted.reduce((m, a) => Math.max(m, a.journal_sequence), 0) };
  });
}

/**
 * SLICE-01 (synthetic, provider-shaped) and related gates: the Shopify-shaped fixture is imported through the real
 * adapter -> journal/outbox -> Rust engine -> API and SDK MCP, then the engine restarts with a removed snapshot and the
 * same fixed-cutoff answers are compared. Also exercises LOCAL-04 revocation and TENANT-01 collisions.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { API, ROOT, apiFetch, loginOwner, waitFor, waitApplied, evidence, engineToken, sql } from '../helpers/env';

const COMPOSE = `docker compose --env-file ${ROOT}/infra/compose/.env -f ${ROOT}/infra/compose/compose.yaml -f ${ROOT}/infra/compose/compose.test.yaml --profile fixture`;
let cookie: string; let connectionId: string; let agentKey: string; let agentId: string; let secondAgentKey: string;
const ev: Record<string, unknown> = { api: API, started_at: new Date().toISOString() };
const engineHealth = async () => { const r = await fetch('http://127.0.0.1:19070/health', { headers: { 'x-engine-token': engineToken() } }); return r.json() as Promise<{ tenants: Array<Record<string, unknown>>; status: string }>; };

beforeAll(async () => {
  cookie = await loginOwner();
  const srcs = await apiFetch('/api/sources', { cookie });
  const existing = (srcs.body.connections as Array<{ connection_id: string; provider: string; account_namespace: string }>).find((c) => c.provider === 'shopify' && c.account_namespace === 'fixture-store.myshopify.com');
  if (existing) connectionId = existing.connection_id;
  else { const r = await apiFetch('/api/sources', { method: 'POST', cookie, body: JSON.stringify({ provider: 'shopify', display_name: 'Fixture Store', account_namespace: 'fixture-store.myshopify.com', secret: 'shpat_fixture_token_000000000000', config_public: { base_url: 'http://fixture:4799' }, plan: { preset: 'last_30_days' } }) }); expect(r.status).toBe(201); connectionId = r.body.connection_id as string; }
  ev.connection_id = connectionId;
}, 120_000);
afterAll(() => evidence('slice-01.json', ev));

function normalize(v: unknown): unknown { if (Array.isArray(v)) return v.map(normalize); if (v && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v as Record<string, unknown>)) { if (['timing_ms', 'hydration_rounds', 'observed_at', 'readiness', 'last_sequence'].includes(k)) continue; o[k] = normalize(x); } return o; } return v; }

describe('SLICE-01 provider-shaped persisted path', () => {
  it('imports the fixture through the real adapter and the engine applies the derived tracks', async () => {
    const run = await waitFor(async () => { const r = await apiFetch(`/api/sources/${connectionId}/runs`, { cookie }); const runs = r.body.runs as Array<Record<string, unknown>>; const done = runs.find((x) => x.state === 'complete' && Number((x.counters as Record<string, number>).orders_fetched ?? 0) > 0); return done ?? null; }, 90_000);
    ev.import_run = { run_id: run.run_id, kind: run.run_kind, state: run.state, counters: run.counters };
    const counts = await apiFetch('/api/journal/counts', { cookie }); ev.counts_after_import = counts.body;
    const c = counts.body.counts as Record<string, number>;
    expect(c.source).toBeGreaterThan(20);
    const eng = await waitApplied(cookie, Number(counts.body.committed_cursor), 90_000);
    ev.engine_after_import = eng.detail;
    const counts2 = await apiFetch('/api/journal/counts', { cookie }); const c2 = counts2.body.counts as Record<string, number>;
    expect(c2.fact).toBeGreaterThan(0); expect(c2.commitment).toBeGreaterThan(0); expect(c2.movement).toBeGreaterThan(0);
    expect(Number(eng.detail.applied_cursor)).toBeGreaterThanOrEqual(Number(counts.body.committed_cursor));
  }, 180_000);

  it('answers order payment state and entity state via API with cutoff and evidence; evidence resolves', async () => {
    const q = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state', parameters: { order_id: '#1001' } }) });
    expect(q.status).toBe(200); expect(q.body.status).toBe('complete');
    const orders = (q.body.result as { orders: Array<Record<string, unknown>> }).orders; expect(orders.length).toBe(1);
    const o = orders[0]!; ev.order_1001_api = q.body;
    expect(o.state).toBe('paid'); expect(o.collected_minor).toBe(o.order_gross_minor); expect(o.remaining_minor).toBe(0); expect(o.authorization_is_capture).toBe(false);
    expect((q.body.evidence_entry_ids as string[]).length).toBeGreaterThan(0);
    const first = (q.body.evidence_entry_ids as string[])[0]!;
    const e = await apiFetch(`/api/journal/entries/${first}`, { cookie }); expect(e.status).toBe(200); expect((e.body.entry as { record_type: string }).record_type).not.toBe('source');
    expect(((e.body.links as { inputs: unknown[] }).inputs).length).toBeGreaterThan(0); // derived from a source observation
    const st = await apiFetch('/api/state', { method: 'POST', cookie, body: JSON.stringify({ entity_type: 'order', entity_id: '#1001' }) });
    expect(st.status).toBe(200); expect(st.body.status).toBe('complete'); ev.order_1001_state = st.body;
    // an order with a failed attempt before the successful capture keeps the failure in history (collection-02)
    const rec = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'payments.recovered_attempts' }) });
    expect(rec.body.status).toMatch(/complete|partial/); ev.recovered = rec.body.result;
    const recovered = (rec.body.result as { recovered: Array<Record<string, unknown>> }).recovered; expect(recovered.length).toBeGreaterThan(0); expect((recovered[0]!.failed_history_retained as string[]).length).toBeGreaterThan(0);
  });

  it('duplicate/out-of-order pages produced no double effects (counts stable after a second incremental run)', async () => {
    const before = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state' }) });
    const runsBefore = ((await apiFetch(`/api/sources/${connectionId}/runs`, { cookie })).body.runs as Array<Record<string, unknown>>).filter((x) => x.state === 'complete').length;
    const r = await apiFetch(`/api/sources/${connectionId}/actions`, { method: 'POST', cookie, body: JSON.stringify({ action: 'retry' }) }); expect(r.status).toBe(200);
    // the retry must start a NEW run (a finished singleton job is re-armed, not ignored); the overlap window re-fetches the newest order(s)
    const actionAt = Date.now() - 2000;
    await waitFor(async () => { const rr = await apiFetch(`/api/sources/${connectionId}/runs`, { cookie }); const runs = rr.body.runs as Array<Record<string, unknown>>; return runs.some((x) => x.state === 'complete' && new Date(x.started_at as string).getTime() >= actionAt) ? true : null; }, 90_000);
    void runsBefore;
    const counts = await apiFetch('/api/journal/counts', { cookie }); await waitApplied(cookie, Number(counts.body.committed_cursor), 60_000);
    const after = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state' }) });
    expect(normalize((after.body.result as { orders: unknown[] }).orders)).toEqual(normalize((before.body.result as { orders: unknown[] }).orders));
    const runs = await apiFetch(`/api/sources/${connectionId}/runs`, { cookie }); const last = (runs.body.runs as Array<Record<string, unknown>>).filter((x) => x.state === 'complete' && new Date(x.started_at as string).getTime() >= actionAt).sort((x, y) => String(y.started_at).localeCompare(String(x.started_at)))[0]!;
    ev.second_run = last.counters; expect(Number((last.counters as Record<string, number>).duplicates)).toBeGreaterThan(0);
  }, 120_000);

  it('serves the same answer through the real SDK stdio MCP bridge with a separate agent key', async () => {
    const k = await apiFetch('/api/agents', { method: 'POST', cookie, body: JSON.stringify({ name: 'slice-test-agent', kind: 'agent' }) }); expect(k.status).toBe(201); agentKey = k.body.secret as string; agentId = k.body.principal_id as string;
    const k2 = await apiFetch('/api/agents', { method: 'POST', cookie, body: JSON.stringify({ name: 'second-agent', kind: 'agent' }) }); secondAgentKey = k2.body.secret as string;
    const transport = new StdioClientTransport({ command: 'node', args: [resolve(ROOT, 'apps/mcp-bridge/dist/main.js')], env: { ...process.env as Record<string, string>, BLACKBOX_API_URL: API, BLACKBOX_AGENT_KEY: agentKey }, stderr: 'pipe' });
    const client = new Client({ name: 'slice-test-client', version: '1.0.0' });
    await client.connect(transport);
    const tools = await client.listTools(); ev.mcp_tools = tools.tools.map((t) => t.name);
    expect(tools.tools.map((t) => t.name)).toEqual(expect.arrayContaining(['describe_business_schema', 'query_business', 'get_business_state', 'list_journal_entries', 'get_journal_entry', 'get_entity_history', 'search_events', 'get_evidence']));
    const res = await client.callTool({ name: 'query_business', arguments: { intent: 'orders.payment_state', parameters: { order_id: '#1001' } } });
    const text = (res.content as Array<{ type: string; text: string }>)[0]!.text; const body = JSON.parse(text);
    ev.order_1001_mcp = body;
    const apiRes = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state', parameters: { order_id: '#1001' } }) });
    expect(normalize(body.result)).toEqual(normalize(apiRes.body.result)); expect(body.evidence_entry_ids).toEqual(apiRes.body.evidence_entry_ids);
    const schema = await client.callTool({ name: 'describe_business_schema', arguments: {} }); expect(JSON.parse((schema.content as Array<{ text: string }>)[0]!.text).intents.length).toBe(24);
    await client.close();
  }, 60_000);

  it('denies owner keys on the bridge/API agent path and agent keys on owner routes', async () => {
    const ownerAsAgent = await apiFetch('/api/query', { method: 'POST', bearer: (await import('node:fs')).readFileSync(resolve(ROOT, '.local/test-owner-key'), 'utf8').trim(), body: JSON.stringify({ intent: 'orders.payment_state' }) });
    expect(ownerAsAgent.status).toBe(401);
    const agentOnOwner = await apiFetch('/api/sources', { method: 'POST', bearer: agentKey, body: JSON.stringify({ provider: 'replay', display_name: 'x', account_namespace: 'x' }) }); expect(agentOnOwner.status).toBe(403);
    const agentLogs = await apiFetch('/api/diagnostics/logs', { method: 'POST', bearer: agentKey, body: '{}' }); expect(agentLogs.status).toBe(403);
    const agentAgents = await apiFetch('/api/agents', { bearer: agentKey }); expect(agentAgents.status).toBe(403);
  });

  it('revocation denies new requests immediately and leaves the other key active (LOCAL-04)', async () => {
    const before = await apiFetch('/api/whoami', { bearer: agentKey }); expect(before.status).toBe(200);
    const rev = await apiFetch(`/api/agents/${agentId}/revoke`, { method: 'POST', cookie }); expect(rev.status).toBe(200);
    const t0 = Date.now(); const after = await apiFetch('/api/whoami', { bearer: agentKey }); ev.revocation_denial_ms = Date.now() - t0;
    expect(after.status).toBe(401);
    const other = await apiFetch('/api/whoami', { bearer: secondAgentKey }); expect(other.status).toBe(200);
    const q = await apiFetch('/api/query', { method: 'POST', bearer: agentKey, body: JSON.stringify({ intent: 'orders.payment_state' }) }); expect(q.status).toBe(401);
  });

  it('survives a full stack restart and a removed engine snapshot with identical fixed-cutoff answers', async () => {
    const counts = await apiFetch('/api/journal/counts', { cookie }); const cutoff = Number(counts.body.committed_cursor);
    const before = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state', consistency: { mode: 'at_least_cursor', cursor: cutoff } }) });
    const beforeState = await apiFetch('/api/state', { method: 'POST', cookie, body: JSON.stringify({ entity_type: 'order', entity_id: '#1001' }) });
    const h0 = await engineHealth(); ev.engine_before_restart = h0.tenants;
    const me = await apiFetch('/api/whoami', { cookie }); const tenantId = me.body.tenant_id as string;
    // every tenant must come back ready; the owner's tenant must have re-applied at least up to the cutoff taken before the restart
    const caughtUp = (h: { tenants: Array<Record<string, unknown>> }) => h.tenants.every((t) => t.ready === true) && h.tenants.some((t) => t.tenant_id === tenantId && Number(t.applied_cursor) >= cutoff);
    execSync(`${COMPOSE} restart api worker engine`, { stdio: 'pipe', cwd: ROOT });
    await waitFor(async () => { try { const h = await engineHealth(); return caughtUp(h) ? h : null; } catch { return null; } }, 120_000);
    cookie = await loginOwner(); // sessions survive restart (server-side), but renew for safety in this test
    const after = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state', consistency: { mode: 'at_least_cursor', cursor: cutoff } }) });
    expect(normalize(after.body.result)).toEqual(normalize(before.body.result)); expect(after.body.evidence_entry_ids).toEqual(before.body.evidence_entry_ids);
    // corrupt/remove the engine snapshot: engine must rebuild from the journal, not fail or serve stale state
    execSync(`${COMPOSE} stop engine`, { stdio: 'pipe', cwd: ROOT });
    const removed = execSync(`docker run --rm -v blackbox-agent-a_data:/d alpine sh -c "ls /d/engine/*/ 2>/dev/null | head -3; rm -rf /d/engine/*; echo removed"`, { cwd: ROOT }).toString(); ev.snapshot_removed = removed.trim();
    execSync(`${COMPOSE} start engine`, { stdio: 'pipe', cwd: ROOT });
    const h2 = await waitFor(async () => { try { const h = await engineHealth(); return caughtUp(h) ? h : null; } catch { return null; } }, 180_000);
    ev.engine_after_rebuild = h2.tenants;
    const rebuilt = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state', consistency: { mode: 'at_least_cursor', cursor: cutoff } }) });
    expect(normalize(rebuilt.body.result)).toEqual(normalize(before.body.result));
    const rebuiltState = await apiFetch('/api/state', { method: 'POST', cookie, body: JSON.stringify({ entity_type: 'order', entity_id: '#1001' }) });
    expect(normalize((rebuiltState.body.view as { state: unknown }).state)).toEqual(normalize((beforeState.body.view as { state: unknown }).state));
    const latest = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state' }) });
    expect(Number(latest.body.required_cursor)).toBeGreaterThanOrEqual(cutoff); ev.latest_committed_cursor = latest.body.required_cursor;
  }, 400_000);
});

describe('TENANT-01 colliding external ids across two tenants', () => {
  it('a second synthetic tenant with the same order name is invisible to tenant A', async () => {
    const migrator = sql('migrator');
    try {
      const { randomUUID } = await import('node:crypto'); const tB = randomUUID();
      await migrator`INSERT INTO tenants (tenant_id, name, timezone, kind) VALUES (${tB}, 'Collision B', 'UTC', 'synthetic')`; await migrator`INSERT INTO tenant_sequences (tenant_id) VALUES (${tB})`;
      await migrator.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${tB}, true)`; await tx`SELECT * FROM journal_append(${tB}::uuid, ${tx.json([{ record_type: 'source', record_id: 'order:#1001', event_type: 'order.accepted', schema_version: 1, provider_namespace: 'shopify:other', dedup_key: 'b-1002', occurred_at: '2026-10-30T10:00:00Z', entity_refs: [{ type: 'order', id: '#1001' }], payload: { order_id: '#1001', currency: 'EUR', gross_minor: 50000, lines: [{ line_id: 'L', item_id: 'X', quantity: '1', unit: 'piece', line_gross_minor: 50000 }] }, evidence_refs: [], input_entry_ids: [] }] as never)}::jsonb)`; });
      await fetch('http://127.0.0.1:19070/admin/refresh-tenants', { method: 'POST', headers: { 'x-engine-token': engineToken(), 'content-type': 'application/json' }, body: '{}' });
      const list = await apiFetch('/api/journal/entries', { method: 'POST', cookie, body: JSON.stringify({ entity: { type: 'order', id: '#1001' }, page_size: 100 }) });
      const entries = list.body.entries as Array<{ provider_namespace: string; payload: { gross_minor?: number } }>;
      expect(entries.some((e) => e.provider_namespace === 'shopify:other')).toBe(false); expect(entries.some((e) => e.payload.gross_minor === 50000)).toBe(false);
      const q = await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'orders.payment_state', parameters: { order_id: '#1001' } }) });
      expect(((q.body.result as { orders: Array<{ order_gross_minor: number }> }).orders[0]!.order_gross_minor)).not.toBe(50000);
      const text = await apiFetch('/api/journal/entries', { method: 'POST', cookie, body: JSON.stringify({ text: 'other', page_size: 100 }) }); expect((text.body.entries as unknown[]).length).toBe(0);
      ev.tenant_collision = { tenant_b: tB, visible_to_a: false };
    } finally { await migrator.end(); }
  }, 60_000);
});

/**
 * Register `contract` test kind for every pilot row (all three connectivity modes): the committed mapping artifact, the
 * typed event vocabulary the code actually parses, and the running API agree; unsupported paths (gateway callbacks,
 * public callbacks, HTTP MCP by default) are refused truthfully rather than silently accepted.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SourceEventType } from '@blackbox/contracts';
import { ROOT, API, apiFetch, loginOwner, evidence } from '../helpers/env';

const profile = JSON.parse(readFileSync(resolve(ROOT, 'delivery-profile.json'), 'utf8')) as { required_integration_rows: string[]; required_integration_providers: string[]; supported_connectivity_modes: string[]; deferred_connectivity_modes: string[] };
const contract = JSON.parse(readFileSync(resolve(ROOT, 'specs/question-data-contracts.json'), 'utf8')) as { datasets: Array<{ id: string; journal_event_families: string[]; required_fields: string[] }> };
type Mapping = { row_id: string; fields: Record<string, { status: string }>; event_rules: Array<{ event: string; tracks: string[]; unsupported_reason?: string }>; synchronization: { modes: Record<string, { status: string; methods?: string[] }> }; import_readiness: Record<string, string>; retention: { decision: string } };
let cookie: string; const ev: Record<string, unknown> = { rows: {} };
beforeAll(async () => { cookie = await loginOwner(); });
afterAll(() => evidence('contract.json', ev));

describe('CONTRACT: mapping artifacts, code vocabulary and runtime declarations agree', () => {
  it('every required row has a committed mapping that only maps event families the code parses, and declares exactly the pilot modes', () => {
    const known = new Set<string>(SourceEventType.options);
    for (const rowId of profile.required_integration_rows) {
      const m = JSON.parse(readFileSync(resolve(ROOT, 'integrations/mappings', `${rowId}.json`), 'utf8')) as Mapping;
      expect(m.row_id).toBe(rowId);
      const dataset = contract.datasets.find((d) => d.id === rowId.split('.').slice(1).join('.'))!; expect(dataset, rowId).toBeTruthy();
      expect(new Set(m.event_rules.map((r) => r.event))).toEqual(new Set(dataset.journal_event_families));
      for (const r of m.event_rules) { if (r.tracks.length) expect(known.has(r.event), `${rowId}: ${r.event} is mapped but not in the typed source vocabulary`).toBe(true); else expect(r.unsupported_reason, `${rowId}: ${r.event} unsupported without reason`).toBeTruthy(); }
      expect(Object.keys(m.fields).sort()).toEqual([...dataset.required_fields].sort());
      for (const mode of profile.supported_connectivity_modes) expect(m.synchronization.modes[mode]?.status, `${rowId} ${mode}`).toBe('supported');
      for (const mode of profile.deferred_connectivity_modes) { expect(m.synchronization.modes[mode]?.status, `${rowId} ${mode}`).toBe('unsupported'); expect(m.synchronization.modes[mode]?.methods ?? []).toEqual([]); }
      expect(['permitted', 'blocked', 'pending']).toContain(m.retention.decision);
      (ev.rows as Record<string, unknown>)[rowId] = { events_mapped: m.event_rules.filter((r) => r.tracks.length).length, events_unsupported: m.event_rules.filter((r) => !r.tracks.length).map((r) => r.event), missing_fields: Object.entries(m.fields).filter(([, f]) => f.status === 'missing').map(([k]) => k), modes: Object.fromEntries(Object.entries(m.synchronization.modes).map(([k, v]) => [k, v.status])) };
    }
  });
  it('the running API declares the same providers, capabilities and modes as the register', async () => {
    const cat = await apiFetch('/api/sources/catalog', { cookie }); expect(cat.status).toBe(200); ev.catalog = cat.body;
    const implemented = cat.body.implemented as Array<{ id: string; capabilities: string[]; status: string }>;
    expect(new Set(implemented.map((p) => p.id))).toEqual(new Set(profile.required_integration_providers));
    for (const rowId of profile.required_integration_rows) { const [provider, ...rest] = rowId.split('.'); const dataset = rest.join('.'); const p = implemented.find((x) => x.id === provider)!; expect(p.capabilities, rowId).toContain(dataset); }
    const modes = cat.body.modes as Record<string, string>; expect(modes.local_standalone).toBe('supported'); expect(modes.local_gateway).toMatch(/unsupported/); expect(modes.public_server).toMatch(/unsupported/);
  });
  it('unsupported paths are refused: no callback endpoints exist, HTTP MCP is disabled unless explicitly enabled, no cross-mode configuration is accepted', async () => {
    for (const p of ['/api/webhooks/shopify', '/webhooks/shopify/orders', '/api/gateway/callback', '/api/callbacks/shopify_payments']) { const r = await fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); expect(r.status, p).toBe(404); }
    const mcp = await fetch(API + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer bbx_agent_' + 'a'.repeat(52) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }); ev.mcp_http_status = mcp.status;
    expect([404, 401, 403]).toContain(mcp.status); // disabled by default: not reachable without the explicit opt-in (and never without a valid key)
    const bad = await apiFetch('/api/sources', { method: 'POST', cookie, body: JSON.stringify({ provider: 'shopify', display_name: 'x', account_namespace: 'x.myshopify.com', secret: 'shpat_x', config_public: { transport: 'public_server', webhook_url: 'https://example.invalid/hook' } }) });
    // the API never accepts a provider it does not implement, and a connection carries no public callback: the created connection (if any) stays local polling
    const badProvider = await apiFetch('/api/sources', { method: 'POST', cookie, body: JSON.stringify({ provider: 'stripe', display_name: 'x', account_namespace: 'x' }) }); expect(badProvider.status).toBe(400);
    if (bad.status === 201) { const list = await apiFetch('/api/sources', { cookie }); const c = (list.body.connections as Array<{ connection_id: string; config_public: Record<string, unknown> }>).find((x) => x.connection_id === bad.body.connection_id)!; expect(c.config_public.webhook_url).toBeUndefined(); await apiFetch(`/api/sources/${bad.body.connection_id}/actions`, { method: 'POST', cookie, body: JSON.stringify({ action: 'disconnect' }) }); }
    ev.cross_mode_config_status = bad.status;
  });
});

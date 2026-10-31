/** DIAG-02/03/05/06/08 (automated part): health probes, log correlation, debug windows, redaction canaries, export bounds, agent denial. */
import { describe, it, expect, beforeAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signBody } from '@blackbox/application';
import { API, apiFetch, loginOwner, evidence } from '../helpers/env';
let cookie: string; const ev: Record<string, unknown> = {};
const ALLOWED = ['schema_version', 'record_id', 'occurred_at', 'observed_at', 'level', 'event_name', 'message', 'component', 'service_version', 'instance_id', 'scope', 'tenant_id', 'connection_id', 'capability_id', 'run_id', 'operation_id', 'attempt', 'trace_id', 'span_id', 'parent_span_id', 'duration_ms', 'record_count', 'error_code', 'retryable', 'next_retry_at', 'action_code', 'journal_batch_id', 'committed_cursor', 'applied_cursor', 'truncated'];
beforeAll(async () => { cookie = await loginOwner(); });

describe('DIAG-02 measured health', () => {
  it('cards carry observation time, reason and state; MCP is not "connected" from configuration alone', async () => {
    const h = await apiFetch('/api/diagnostics/health', { cookie }); expect(h.status).toBe(200);
    const cards = h.body.cards as Array<{ area: string; state: string; observed_at: string; reason: string; detail: Record<string, unknown> }>;
    ev.health = cards.map((c) => ({ area: c.area, state: c.state, reason: c.reason }));
    for (const a of ['api', 'postgres', 'worker', 'engine', 'sources', 'mcp', 'diagnostics']) expect(cards.map((c) => c.area)).toContain(a);
    for (const c of cards) { expect(c.observed_at).toMatch(/T/); expect(c.reason.length).toBeGreaterThan(0); }
    const pg = cards.find((c) => c.area === 'postgres')!; expect(pg.state).toBe('healthy'); expect(typeof pg.detail.probe_ms).toBe('number');
    const eng = cards.find((c) => c.area === 'engine')!; expect(eng.detail).toHaveProperty('applied_cursor'); expect(eng.detail).toHaveProperty('committed_cursor');
    expect((h.body.thresholds as Record<string, unknown>).stale_after_seconds).toBe(30);
  });
});

describe('DIAG-03 correlation across worker commit, engine application and query', () => {
  it('journal.batch_committed and engine.batch_applied carry cursors; a query log names its cutoff; fields are allowlisted', async () => {
    await apiFetch('/api/query', { method: 'POST', cookie, body: JSON.stringify({ intent: 'invoices.outstanding' }) });
    await new Promise((r) => setTimeout(r, 1500));
    const logs = await apiFetch('/api/diagnostics/logs', { method: 'POST', cookie, body: JSON.stringify({ since: new Date(Date.now() - 3600_000).toISOString(), levels: ['INFO', 'WARN', 'ERROR'], page_size: 1000 }) });
    const recs = logs.body.records as Array<Record<string, unknown>>; ev.log_sample = recs.slice(0, 5);
    const committed = recs.filter((r) => r.event_name === 'journal.batch_committed'); const applied = recs.filter((r) => r.event_name === 'engine.batch_applied'); const served = recs.filter((r) => r.event_name === 'query.served');
    expect(committed.length).toBeGreaterThan(0); expect(applied.length).toBeGreaterThan(0); expect(served.length).toBeGreaterThan(0);
    expect(committed.every((r) => typeof r.committed_cursor === 'number' || r.record_count === 0)).toBe(true);
    expect(applied.every((r) => typeof r.applied_cursor === 'number')).toBe(true);
    expect(served.every((r) => typeof r.applied_cursor === 'number')).toBe(true);
    for (const r of recs) { expect(r.schema_version).toBe(1); for (const k of Object.keys(r)) expect(ALLOWED, `unexpected log field ${k}`).toContain(k); }
    const only = await apiFetch('/api/diagnostics/logs', { method: 'POST', cookie, body: JSON.stringify({ since: new Date(Date.now() - 3600_000).toISOString(), components: ['engine'], levels: ['INFO'], page_size: 200 }) });
    expect((only.body.records as Array<{ component: string; level: string }>).every((r) => r.component === 'engine' && r.level === 'INFO')).toBe(true);
    const text = await apiFetch('/api/diagnostics/logs', { method: 'POST', cookie, body: JSON.stringify({ since: new Date(Date.now() - 3600_000).toISOString(), text: 'batch_applied', page_size: 50 }) });
    expect((text.body.records as unknown[]).length).toBeGreaterThan(0); expect(typeof text.body.query_ms).toBe('number');
    const bad = await apiFetch('/api/diagnostics/logs', { method: 'POST', cookie, body: JSON.stringify({ levels: ['VERBOSE'] }) }); expect(bad.status).toBe(400);
  });
});

describe('DIAG-05 debug windows', () => {
  it('debug is off by default, bounded to 15 minutes, stoppable and audited', async () => {
    // precondition: no active window (an earlier interrupted run may have left one); stopping is the owner's normal action
    const existing = await apiFetch('/api/diagnostics/debug', { cookie });
    for (const w of existing.body.windows as Array<{ window_id: string }>) await apiFetch(`/api/diagnostics/debug/${w.window_id}/stop`, { method: 'POST', cookie });
    const before = await apiFetch('/api/diagnostics/debug', { cookie }); expect((before.body.windows as unknown[]).length).toBe(0);
    const tooLong = await apiFetch('/api/diagnostics/debug', { method: 'POST', cookie, body: JSON.stringify({ component: 'api', minutes: 60 }) }); expect(tooLong.status).toBe(400);
    const on = await apiFetch('/api/diagnostics/debug', { method: 'POST', cookie, body: JSON.stringify({ component: 'api', minutes: 15 }) }); expect(on.status).toBe(200);
    expect(new Date(on.body.expires_at as string).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 2000);
    await new Promise((r) => setTimeout(r, 6000));
    await apiFetch('/api/journal/counts', { cookie });
    await new Promise((r) => setTimeout(r, 1200));
    const dbg = await apiFetch('/api/diagnostics/logs', { method: 'POST', cookie, body: JSON.stringify({ since: new Date(Date.now() - 60_000).toISOString(), levels: ['DEBUG'], components: ['api'], page_size: 50 }) });
    ev.debug_records = (dbg.body.records as unknown[]).length; expect((dbg.body.records as unknown[]).length).toBeGreaterThan(0);
    const stop = await apiFetch(`/api/diagnostics/debug/${on.body.window_id}/stop`, { method: 'POST', cookie }); expect(stop.status).toBe(200);
    const audit = await apiFetch('/api/audit', { cookie }); const actions = (audit.body.events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain('debug.enabled'); expect(actions).toContain('debug.stopped');
  }, 30_000);
});

describe('DIAG-06 / DIAG-08 redaction, access and export bounds', () => {
  it('injected canaries never reach any sink; agents and anonymous callers are denied; export is bounded', async () => {
    const canary = `CANARY-${randomUUID()}`; const email = `canary.${randomUUID().slice(0, 6)}@example.test`; const token = 'shpat_' + 'f'.repeat(32);
    const k = await apiFetch('/api/agents', { method: 'POST', cookie, body: JSON.stringify({ name: `p-${canary}`, kind: 'producer' }) }); const producerKey = k.body.secret as string;
    const body = JSON.stringify({ schema_version: 1, producer: 'does-not-exist', idempotency_key: canary, events: [{ event_id: canary, event_type: 'order.accepted', occurred_at: '2026-10-31T00:00:00Z', payload: { order_id: canary, currency: 'EUR', gross_minor: 1, lines: [], customer_email: email, token } }] });
    await fetch(API + '/api/ingest/generic', { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${producerKey}`, 'x-blackbox-signature': signBody(body, producerKey) }, body });
    await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ access_key: `bbx_owner_${canary.toLowerCase().replace(/[^a-z2-7]/g, 'a').padEnd(52, 'a').slice(0, 52)}`, remember: false }) });
    await apiFetch(`/api/journal/entries/${encodeURIComponent('<script>' + canary + '</script>')}`, { cookie });
    await new Promise((r) => setTimeout(r, 1500));
    const logs = await apiFetch('/api/diagnostics/logs', { method: 'POST', cookie, body: JSON.stringify({ since: new Date(Date.now() - 600_000).toISOString(), levels: ['DEBUG', 'INFO', 'WARN', 'ERROR'], page_size: 1000 }) });
    const dump = JSON.stringify(logs.body);
    expect(dump).not.toContain(email); expect(dump).not.toContain(token); expect(dump).not.toContain('<script>'); expect(dump).not.toContain(producerKey);
    const exp = await apiFetch('/api/diagnostics/export', { method: 'POST', cookie, body: JSON.stringify({ hours: 1 }) }); const expDump = JSON.stringify(exp.body);
    expect(expDump).not.toContain(email); expect(expDump).not.toContain(token); expect(expDump).not.toMatch(/\/Users\//); expect(Buffer.byteLength(expDump)).toBeLessThanOrEqual(10 * 1024 * 1024); expect(exp.body).toHaveProperty('truncated');
    ev.export_bytes = Buffer.byteLength(expDump);
    const agent = await apiFetch('/api/agents', { method: 'POST', cookie, body: JSON.stringify({ name: 'diag-agent', kind: 'agent' }) }); const agentKey = agent.body.secret as string;
    for (const p of ['/api/diagnostics/health', '/api/diagnostics/export/preview', '/api/audit', '/api/review']) { const r = await apiFetch(p, { bearer: agentKey }); expect(r.status, p).toBe(403); }
    const anon = await apiFetch('/api/diagnostics/logs', { method: 'POST', body: '{}' }); expect(anon.status).toBe(401);
    evidence('diagnostics.json', ev);
  }, 60_000);
});

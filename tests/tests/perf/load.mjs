// Smoke load driver: 20 closed-loop clients + fixed-arrival 40 req/s over the query mix, through API and (optionally) MCP,
// while ingestion continues at 20 entries/s. Reports p50/p95/p99, success fraction, scheduled-arrival latency, memory.
// Usage: node load.mjs --duration 600 --mode api|mcp --tenants 50 [--rate 40]
import postgres from 'postgres';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const ROOT = resolve(import.meta.dirname, '../..'); const arg = (k, d) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : d; };
const API = process.env.BBX_API ?? 'http://127.0.0.1:19080'; const DURATION = Number(arg('--duration', 600)) * 1000; const MODE = arg('--mode', 'api'); const RATE = Number(arg('--rate', 40)); const CLIENTS = Number(arg('--clients', 20)); const INGEST = Number(arg('--ingest', 20));
const pw = (n) => readFileSync(resolve(ROOT, '.secrets', n), 'utf8').trim();
const mig = postgres(`postgres://bbx_migrator:${pw('pg_migrator_password')}@127.0.0.1:19032/blackbox`, { max: 2, onnotice: () => {} });
const api = postgres(`postgres://bbx_api:${pw('pg_api_password')}@127.0.0.1:19032/blackbox`, { max: 4, onnotice: () => {} });
const tenants = await mig`SELECT tenant_id, name FROM tenants WHERE kind = 'synthetic' AND name LIKE 'perf-%' ORDER BY name`;
if (!tenants.length) { console.error('seed first: node tests/perf/seed.mjs'); process.exit(2); }
// one agent principal per tenant (legitimate spread across tenants/principals)
const keys = new Map();
for (const t of tenants) { const [p] = await mig`SELECT principal_id FROM principals WHERE tenant_id = ${t.tenant_id} AND kind = 'agent' AND status = 'active' AND name = 'perf-agent' LIMIT 1`; let secret;
  if (!p) { const { generateKey } = await import('@blackbox/application'); const k = generateKey('agent'); const pid = randomUUID(); await mig`INSERT INTO principals (principal_id, tenant_id, kind, name) VALUES (${pid}, ${t.tenant_id}, 'agent', 'perf-agent')`; await mig`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${pid}, ${t.tenant_id}, 'agent_key', ${k.keyId}, ${k.verifier})`; secret = k.secret; await mig`INSERT INTO settings (tenant_id, scope, key, value) VALUES (${t.tenant_id}, 'workspace', 'perf_agent_key', ${mig.json({ secret })}) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value`; }
  else { const [s] = await mig`SELECT value FROM settings WHERE tenant_id = ${t.tenant_id} AND key = 'perf_agent_key'`; secret = s?.value?.secret; if (!secret) { const { generateKey } = await import('@blackbox/application'); const k = generateKey('agent'); await mig`UPDATE credentials SET status='revoked' WHERE principal_id = ${p.principal_id}`; await mig`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${p.principal_id}, ${t.tenant_id}, 'agent_key', ${k.keyId}, ${k.verifier})`; secret = k.secret; await mig`INSERT INTO settings (tenant_id, scope, key, value) VALUES (${t.tenant_id}, 'workspace', 'perf_agent_key', ${mig.json({ secret })}) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value`; } }
  keys.set(t.tenant_id, secret); }
// hot set: 2000 active orders of the largest tenant; cold pool: orders of small tenants evicted before the run
const big = tenants[0]; const hot = (await api.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${big.tenant_id}, true)`; return tx`SELECT DISTINCT record_id FROM journal_entries WHERE tenant_id = ${big.tenant_id} AND record_type = 'source' AND event_type = 'order.accepted' ORDER BY record_id LIMIT 2000`; })).map((r) => r.record_id.slice('order:'.length));
const coldTenants = tenants.slice(1, 11); const cold = [];
for (const t of coldTenants) { const rows = await api.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${t.tenant_id}, true)`; return tx`SELECT DISTINCT record_id FROM journal_entries WHERE tenant_id = ${t.tenant_id} AND record_type = 'source' AND event_type = 'order.accepted' LIMIT 100`; }); for (const r of rows) cold.push({ tenant: t.tenant_id, order: r.record_id.slice('order:'.length) }); }
const engineToken = pw('engine_token');
for (const t of coldTenants) await fetch('http://127.0.0.1:19070/admin/evict', { method: 'POST', headers: { 'x-engine-token': engineToken, 'content-type': 'application/json' }, body: JSON.stringify({ tenant_id: t.tenant_id, all: true }) });
const mcpClients = new Map();
async function mcpFor(tenant) { if (mcpClients.has(tenant)) return mcpClients.get(tenant); const transport = new StdioClientTransport({ command: 'node', args: [resolve(ROOT, 'apps/mcp-bridge/dist/main.js')], env: { ...process.env, BLACKBOX_API_URL: API, BLACKBOX_AGENT_KEY: keys.get(tenant) }, stderr: 'ignore' }); const c = new Client({ name: 'perf', version: '1' }); await c.connect(transport); mcpClients.set(tenant, c); return c; }
const classes = [['hot_current_state', 50], ['cold_order_state', 20], ['entity_history_first_100', 20], ['bounded_30_day_summary', 10]];
const pickClass = () => { let r = Math.random() * 100; for (const [c, w] of classes) { if ((r -= w) < 0) return c; } return 'hot_current_state'; };
const samples = { api: {}, mcp: {} }; for (const c of classes) { samples.api[c[0]] = []; samples.mcp[c[0]] = []; }
const errors = { api: 0, mcp: 0, stale: 0, timeout: 0 }; let completed = 0;
async function runOne(cls, tenant, viaMcp) {
  const key = keys.get(tenant); let body, path = '/api/query', tool = 'query_business', args;
  if (cls === 'hot_current_state') { const o = hot[Math.floor(Math.random() * hot.length)]; tenant = big.tenant_id; body = { intent: 'orders.payment_state', parameters: { order_id: o } }; }
  else if (cls === 'cold_order_state') { const c = cold[Math.floor(Math.random() * cold.length)]; tenant = c.tenant; path = '/api/state'; body = { entity_type: 'order', entity_id: c.order }; tool = 'get_business_state'; args = { entity_type: 'order', entity_id: c.order }; }
  else if (cls === 'entity_history_first_100') { const o = hot[Math.floor(Math.random() * hot.length)]; tenant = big.tenant_id; path = '/api/journal/entries'; body = { entity: { type: 'order', id: o }, page_size: 100 }; tool = 'get_entity_history'; args = { entity_type: 'order', entity_id: o, page_size: 100 }; }
  else { body = { intent: 'invoices.outstanding', pagination: { page_size: 100 } }; tenant = tenants[Math.floor(Math.random() * tenants.length)].tenant_id; }
  const k = keys.get(tenant) ?? key; const t0 = performance.now();
  try {
    if (viaMcp) { const c = await mcpFor(tenant); const r = await c.callTool({ name: tool, arguments: args ?? { intent: body.intent, parameters: body.parameters ?? {}, page_size: body.pagination?.page_size } }); const out = JSON.parse(r.content[0].text); if (r.isError || out.status === 'projection_behind') { errors.stale++; return false; } }
    else { const ctrl = new AbortController(); const tm = setTimeout(() => ctrl.abort(), 5000); const r = await fetch(API + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${k}` }, body: JSON.stringify(body), signal: ctrl.signal }); clearTimeout(tm); if (!r.ok) { errors.api++; return false; } const out = await r.json(); if (out.status === 'projection_behind') { errors.stale++; return false; } }
    samples[viaMcp ? 'mcp' : 'api'][cls].push(performance.now() - t0); completed++; return true;
  } catch (e) { if (String(e).includes('abort')) errors.timeout++; else errors[viaMcp ? 'mcp' : 'api']++; return false; }
}
// ingestion at INGEST entries/s into the largest tenant (continuous new orders)
let ingested = 0; const ingestTimer = setInterval(async () => { const oid = `#L${Date.now()}-${Math.floor(Math.random() * 1e6)}`; const batch = [{ record_type: 'source', record_id: `order:${oid}`, event_type: 'order.accepted', schema_version: 1, provider_namespace: 'perf-live', dedup_key: `live:${oid}`, occurred_at: new Date().toISOString(), entity_refs: [{ type: 'order', id: oid }], payload: { order_id: oid, currency: 'EUR', gross_minor: 1900, lines: [{ line_id: `${oid}/1`, item_id: `SKU-0-${Math.floor(Math.random() * 40)}`, quantity: '1', unit: 'piece', line_gross_minor: 1900 }] }, evidence_refs: [], input_entry_ids: [] }]; try { await api.begin(async (tx) => { await tx`SELECT set_config('app.tenant_id', ${big.tenant_id}, true), set_config('app.scope','tenant',true)`; await tx`SELECT count(*) FROM journal_append(${big.tenant_id}::uuid, ${tx.json(batch)}::jsonb)`; }); ingested++; } catch {} }, 1000 / INGEST);
const start = Date.now(); const viaMcp = MODE === 'mcp';
// warm-up (<= 60 s): touch the hot set only
const warm = Date.now(); while (Date.now() - warm < 20000) { await runOne('hot_current_state', big.tenant_id, viaMcp); }
for (const c of classes) { samples.api[c[0]] = []; samples.mcp[c[0]] = []; } completed = 0;
const measureStart = Date.now();
// closed-loop clients
const loops = Array.from({ length: CLIENTS }, async () => { while (Date.now() - measureStart < DURATION) await runOne(pickClass(), tenants[Math.floor(Math.random() * tenants.length)].tenant_id, viaMcp); });
// fixed-arrival schedule: RATE req/s, latency includes queueing from the scheduled arrival
const arrivals = []; let scheduled = 0; const arrivalTimer = setInterval(() => { const sched = performance.now(); scheduled++; const cls = pickClass(); (async () => { const ok = await runOne(cls, tenants[Math.floor(Math.random() * tenants.length)].tenant_id, viaMcp); if (ok) arrivals.push(performance.now() - sched); })(); }, 1000 / RATE);
await Promise.all(loops); clearInterval(arrivalTimer); clearInterval(ingestTimer);
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))] * 10) / 10; };
const health = await fetch('http://127.0.0.1:19070/health', { headers: { 'x-engine-token': engineToken } }).then((r) => r.json());
const stats = await fetch('http://127.0.0.1:19070/metrics', { headers: { 'x-engine-token': engineToken } }).then((r) => r.json());
const { execSync } = await import('node:child_process'); const dockerStats = execSync('docker stats --no-stream --format "{{.Name}} {{.MemUsage}} {{.CPUPerc}}" $(docker ps --filter name=blackbox-agent-a -q)').toString().trim();
const report = { mode: MODE, duration_s: DURATION / 1000, clients: CLIENTS, fixed_arrival_rate: RATE, ingest_rate_target: INGEST, ingested_entries: ingested, completed, errors, success_fraction: completed / (completed + errors.api + errors.mcp + errors.stale + errors.timeout), scheduled_arrivals: scheduled, scheduled_arrival_latency_ms: { p50: pct(arrivals, 0.5), p95: pct(arrivals, 0.95), p99: pct(arrivals, 0.99), n: arrivals.length },
  classes: Object.fromEntries(classes.map(([c]) => [c, { n: samples[viaMcp ? 'mcp' : 'api'][c].length, p50: pct(samples[viaMcp ? 'mcp' : 'api'][c], 0.5), p95: pct(samples[viaMcp ? 'mcp' : 'api'][c], 0.95), p99: pct(samples[viaMcp ? 'mcp' : 'api'][c], 0.99) }])),
  engine: { rss_bytes: health.rss_bytes, tenants: health.tenants.length, max_lag_entries: Math.max(...health.tenants.map((t) => t.lag_entries)), max_lag_ms: Math.max(...health.tenants.map((t) => t.lag_ms ?? 0)), resident_bytes_total: health.resident_bytes_total, metrics: stats }, container_stats: dockerStats.split('\n'), finished_at: new Date().toISOString() };
console.log(JSON.stringify(report, null, 1)); for (const c of mcpClients.values()) await c.close(); await api.end(); await mig.end(); process.exit(0);

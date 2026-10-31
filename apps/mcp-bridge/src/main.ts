#!/usr/bin/env node
/**
 * Blackbox local MCP bridge (stdio). Reads BLACKBOX_AGENT_KEY from the environment (never an argument) and calls the
 * real persisted backend over loopback with that agent principal. stdout is protocol-only; diagnostics go to stderr.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'node:fs';
import { IntentId } from '@blackbox/contracts';

const API = (process.env.BLACKBOX_API_URL ?? 'http://127.0.0.1:19080').replace(/\/$/, '');
const KEY = process.env.BLACKBOX_AGENT_KEY ?? (process.env.BLACKBOX_AGENT_KEY_FILE ? readFileSync(process.env.BLACKBOX_AGENT_KEY_FILE, 'utf8').trim() : '');
if (!KEY) { process.stderr.write(JSON.stringify({ level: 'ERROR', component: 'mcp', event_name: 'mcp.key_missing', message: 'set BLACKBOX_AGENT_KEY (environment or key file); owner keys are refused' }) + '\n'); process.exit(2); }
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API) && !/^https:\/\//.test(API)) { process.stderr.write(JSON.stringify({ level: 'ERROR', component: 'mcp', event_name: 'mcp.bad_api_url', message: 'BLACKBOX_API_URL must be the local loopback origin' }) + '\n'); process.exit(2); }
const slog = (level: string, event: string, message: string, extra: Record<string, unknown> = {}) => process.stderr.write(JSON.stringify({ schema_version: 1, level, component: 'mcp', event_name: event, message, occurred_at: new Date().toISOString(), ...extra }) + '\n');

async function api(path: string, method: 'GET' | 'POST', body?: unknown) {
  const res = await fetch(API + path, { method, headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json', host: new URL(API).host }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text(); let json: unknown; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
  if (!res.ok) { const err = new Error(`${res.status}`); (err as Error & { payload: unknown; status: number }).payload = json; (err as Error & { status: number }).status = res.status; throw err; }
  return json;
}
const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(v, null, 2) }] });
const failure = (err: unknown) => { const e = err as Error & { status?: number; payload?: unknown }; const code = e.status === 401 ? 'unauthorized' : e.status === 403 ? 'forbidden' : e.status === 429 ? 'rate_limited' : e.status === 503 ? 'engine_unavailable' : 'error'; return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify({ error: code, status: e.status ?? null, detail: e.payload ?? e.message }) }] }; };

const server = new Server({ name: 'blackbox-local', version: process.env.SERVICE_VERSION ?? '0.1.0' }, { capabilities: { tools: {} } });
const TOOLS = [
  { name: 'describe_business_schema', description: 'Record/event types, entity types, intents, units, time semantics, filters, limits and this workspace\'s connector coverage.', inputSchema: { type: 'object', properties: {} } },
  { name: 'query_business', description: 'Answer one of the 24 supported Order-to-Cash intents with calculation, evidence ids, cutoffs, coverage, missing inputs and conflicts. Results come from the deterministic engine, never from text matching.', inputSchema: { type: 'object', properties: { intent: { type: 'string', enum: IntentId.options }, parameters: { type: 'object' }, consistency: { type: 'object', properties: { mode: { type: 'string', enum: ['latest_committed', 'at_least_cursor', 'stale_allowed'] }, cursor: { type: 'integer' } } }, page_size: { type: 'integer', minimum: 1, maximum: 500 }, cursor: { type: 'string' } }, required: ['intent'] } },
  { name: 'get_business_state', description: 'Current or historical (as_of) state of one entity with computed values and evidence entry ids.', inputSchema: { type: 'object', properties: { entity_type: { type: 'string' }, entity_id: { type: 'string' }, recorded_cutoff: { type: 'integer' }, effective_at: { type: 'string' } }, required: ['entity_type', 'entity_id'] } },
  { name: 'list_journal_entries', description: 'Cursor-paginated committed journal entries across all five tracks at a stable snapshot boundary.', inputSchema: { type: 'object', properties: { record_types: { type: 'array', items: { type: 'string' } }, event_types: { type: 'array', items: { type: 'string' } }, entity: { type: 'object', properties: { type: { type: 'string' }, id: { type: 'string' } } }, connection_id: { type: 'string' }, occurred_from: { type: 'string' }, occurred_to: { type: 'string' }, recorded_from: { type: 'string' }, recorded_to: { type: 'string' }, snapshot_cursor: { type: 'integer' }, after_sequence: { type: 'integer' }, page_size: { type: 'integer' } } } },
  { name: 'get_journal_entry', description: 'One permitted entry with typed payload, provenance and correction/derivation links.', inputSchema: { type: 'object', properties: { entry_id: { type: 'string' } }, required: ['entry_id'] } },
  { name: 'get_entity_history', description: 'Complete paginated history of an entity (all tracks), superseded entries included.', inputSchema: { type: 'object', properties: { entity_type: { type: 'string' }, entity_id: { type: 'string' }, after_sequence: { type: 'integer' }, snapshot_cursor: { type: 'integer' }, page_size: { type: 'integer' } }, required: ['entity_type', 'entity_id'] } },
  { name: 'search_events', description: 'Literal search over permitted recorded business events with structured filters and explicit truncation status.', inputSchema: { type: 'object', properties: { text: { type: 'string' }, record_types: { type: 'array', items: { type: 'string' } }, event_types: { type: 'array', items: { type: 'string' } }, occurred_from: { type: 'string' }, occurred_to: { type: 'string' }, page_size: { type: 'integer' }, after_sequence: { type: 'integer' }, snapshot_cursor: { type: 'integer' } } } },
  { name: 'get_evidence', description: 'Evidence metadata for an evidence id; returns an explicit unavailable/redacted state instead of broken links.', inputSchema: { type: 'object', properties: { evidence_id: { type: 'string' } }, required: ['evidence_id'] } },
  { name: 'list_sources', description: 'Connected sources, capability health, coverage and limitations as the UI shows them (no secrets).', inputSchema: { type: 'object', properties: {} } },
];
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const a = (req.params.arguments ?? {}) as Record<string, unknown>; const started = Date.now();
  try {
    let out: unknown;
    switch (req.params.name) {
      case 'describe_business_schema': out = await api('/api/schema', 'GET'); break;
      case 'query_business': out = await api('/api/query', 'POST', { intent: a.intent, parameters: a.parameters ?? {}, consistency: a.consistency ?? { mode: 'latest_committed' }, pagination: { page_size: a.page_size ?? 100, cursor: a.cursor } }); break;
      case 'get_business_state': out = await api('/api/state', 'POST', { entity_type: a.entity_type, entity_id: a.entity_id, consistency: a.recorded_cutoff !== undefined || a.effective_at ? { mode: 'as_of', recorded_cutoff: a.recorded_cutoff, effective_at: a.effective_at } : { mode: 'latest_committed' } }); break;
      case 'list_journal_entries': out = await api('/api/journal/entries', 'POST', { ...a, page_size: a.page_size ?? 100 }); break;
      case 'get_journal_entry': out = await api(`/api/journal/entries/${encodeURIComponent(String(a.entry_id))}`, 'GET'); break;
      case 'get_entity_history': out = await api('/api/journal/entries', 'POST', { entity: { type: a.entity_type, id: a.entity_id }, after_sequence: a.after_sequence, snapshot_cursor: a.snapshot_cursor, page_size: a.page_size ?? 100 }); break;
      case 'search_events': out = await api('/api/journal/entries', 'POST', { text: a.text, record_types: a.record_types, event_types: a.event_types, occurred_from: a.occurred_from, occurred_to: a.occurred_to, after_sequence: a.after_sequence, snapshot_cursor: a.snapshot_cursor, page_size: a.page_size ?? 100 }); break;
      case 'get_evidence': out = await api(`/api/evidence/${encodeURIComponent(String(a.evidence_id))}`, 'GET'); break;
      case 'list_sources': out = await api('/api/sources', 'GET'); break;
      default: return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: 'unknown_tool' }) }] };
    }
    slog('INFO', 'mcp.tool_called', 'tool served through the local bridge', { operation_id: req.params.name, duration_ms: Date.now() - started });
    return text(out);
  } catch (err) { slog('WARN', 'mcp.tool_failed', 'tool call failed', { operation_id: req.params.name, error_code: String((err as { status?: number }).status ?? 'error'), duration_ms: Date.now() - started }); return failure(err); }
});
const transport = new StdioServerTransport();
await server.connect(transport);
slog('INFO', 'mcp.started', 'blackbox local MCP bridge connected over stdio', { operation_id: API });

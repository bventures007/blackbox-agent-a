import type { Principal } from '@blackbox/application';
import type { Services } from './app.js';
/** Minimal JSON-RPC dispatcher for the optional HTTP transport; the stdio bridge implements the full SDK server. */
export async function handleMcpRequest(s: Services, p: Principal, body: Record<string, unknown>) {
  const id = body.id ?? null; const method = String(body.method ?? ''); const params = (body.params as Record<string, unknown>) ?? {};
  try {
    if (method === 'initialize') return { jsonrpc: '2.0', id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'blackbox-local', version: s.config.version } } };
    if (method === 'tools/list') return { jsonrpc: '2.0', id, result: { tools: [{ name: 'query_business', description: 'Run one of the 24 supported intents', inputSchema: { type: 'object', properties: { intent: { type: 'string' }, parameters: { type: 'object' } }, required: ['intent'] } }] } };
    if (method === 'tools/call') { const name = String((params.name as string) ?? ''); const args = (params.arguments as Record<string, unknown>) ?? {}; if (name === 'query_business') { const r = await s.query.answer(p, { intent: args.intent, parameters: args.parameters ?? {} }); return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(r) }] } }; } return { jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } }; }
    return { jsonrpc: '2.0', id, error: { code: -32601, message: 'method not found' } };
  } catch (err) { return { jsonrpc: '2.0', id, error: { code: -32000, message: (err as Error).message } }; }
}

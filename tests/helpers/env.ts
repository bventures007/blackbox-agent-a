import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postgres from 'postgres';
export const ROOT = resolve(import.meta.dirname, '../..');
export const API = process.env.BBX_API ?? 'http://127.0.0.1:19080';
const secret = (n: string) => readFileSync(resolve(ROOT, '.secrets', n), 'utf8').trim();
const url = (role: string) => `postgres://${role}:${secret(`pg_${role.replace('bbx_', '')}_password`)}@127.0.0.1:19032/blackbox`;
export const dbUrls = { migrator: url('bbx_migrator'), api: url('bbx_api'), worker: url('bbx_worker'), engine: url('bbx_engine') };
export function sql(role: keyof typeof dbUrls) { return postgres(dbUrls[role], { max: 3, onnotice: () => undefined, transform: { undefined: null } }); }
export const ownerKey = () => process.env.BBX_OWNER_KEY ?? readFileSync(resolve(ROOT, '.local', 'test-owner-key'), 'utf8').trim();
export const engineToken = () => secret('engine_token');
export async function apiFetch(path: string, init: RequestInit & { cookie?: string; bearer?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'x-blackbox-request': '1', origin: API, ...(init.headers as Record<string, string> ?? {}) };
  if (init.cookie) headers.cookie = `bbx_session=${init.cookie}`; if (init.bearer) headers.authorization = `Bearer ${init.bearer}`;
  const res = await fetch(API + path, { ...init, headers, redirect: 'manual' });
  const text = await res.text(); let body: unknown = null; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body: body as Record<string, unknown>, headers: res.headers };
}
export async function loginOwner(key = ownerKey()): Promise<string> {
  const res = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ access_key: key, remember: false }) });
  if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = res.headers.get('set-cookie') ?? ''; const m = /bbx_session=([a-z2-7]+)/.exec(cookie); if (!m) throw new Error('no session cookie'); return m[1]!;
}
export async function waitFor<T>(fn: () => Promise<T | null | false>, timeoutMs = 60_000, every = 500): Promise<T> { const until = Date.now() + timeoutMs; for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() > until) throw new Error('timeout waiting'); await new Promise((r) => setTimeout(r, every)); } }
export async function waitApplied(cookie: string, required: number, timeoutMs = 60_000) { return waitFor(async () => { const h = await apiFetch('/api/diagnostics/health', { cookie }); const eng = (h.body.cards as Array<{ area: string; detail: Record<string, unknown> }>).find((c) => c.area === 'engine'); return Number(eng?.detail.applied_cursor ?? -1) >= required ? eng : null; }, timeoutMs); }
export function evidence(name: string, data: unknown) { const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs'); const dir = resolve(ROOT, 'tests/evidence/current'); mkdirSync(dir, { recursive: true }); writeFileSync(resolve(dir, name), typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n'); }

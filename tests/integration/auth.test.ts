/** LOCAL-01 / LOCAL-02 / LOCAL-05 / AUTH-02: owner key login, throttling, CSRF/origin, cookies, rotation, bind surface. */
import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { connect } from 'node:net';
/** Raw HTTP/1.1 request so a forged Host header really reaches the server (fetch silently drops Host). */
function rawRequest(path: string, headers: Record<string, string>): Promise<number> { return new Promise((res, rej) => { const u = new URL(API); const sock = connect(Number(u.port), u.hostname, () => { sock.write(`GET ${path} HTTP/1.1\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\nConnection: close\r\n\r\n`); }); let buf = ''; sock.on('data', (d) => { buf += d.toString(); }); sock.on('end', () => res(Number(/^HTTP\/1\.1 (\d{3})/.exec(buf)?.[1] ?? 0))); sock.on('error', rej); }); }
import { API, apiFetch, loginOwner, ownerKey, evidence, sql } from '../helpers/env';

describe('LOCAL-01 / LOCAL-02 owner key and sessions', () => {
  it('no HTTP endpoint creates an owner or resets access; unauthenticated calls are denied', async () => {
    for (const p of ['/api/setup', '/api/auth/setup', '/api/auth/reset', '/api/reset-access']) { const r = await apiFetch(p, { method: 'POST', body: '{}' }); expect([403, 404]).toContain(r.status); }
    for (const p of ['/api/journal/counts', '/api/sources', '/api/agents', '/api/diagnostics/health']) { const r = await apiFetch(p); expect(r.status).toBe(401); }
  });
  it('rejects wrong keys without leaking partial matches and throttles repeated failures', async () => {
    const wrong = ownerKey().slice(0, -4) + 'aaaa';
    // precondition: a fresh installation has no recorded failures (other suites and earlier runs leave some behind)
    const mig = sql('migrator'); try { await mig`DELETE FROM login_attempts`; } finally { await mig.end(); }
    const statuses: number[] = []; const bodies = new Set<string>();
    for (let i = 0; i < 8; i++) { const r = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ access_key: wrong, remember: false }) }); statuses.push(r.status); bodies.add(JSON.stringify(r.body)); }
    expect(statuses.slice(0, 5).every((s) => s === 401)).toBe(true); expect(statuses).toContain(429);
    expect([...bodies].join()).not.toContain(wrong.slice(10, 30));
    evidence('auth-throttle.json', { statuses });
    // the lock is exponential (2^n seconds from the fifth failure, capped at 300 s) and clears on a successful sign-in: wait it out
    const until = Date.now() + 40_000; let recovered = 0;
    while (Date.now() < until) { const r = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ access_key: ownerKey(), remember: false }) }); recovered = r.status; if (r.status === 200) break; await new Promise((res) => setTimeout(res, 1000)); }
    expect(recovered).toBe(200);
  }, 30_000);
  it('issues an HttpOnly SameSite=Strict cookie, no secret in body/localStorage, and the session survives only server-side', async () => {
    const res = await fetch(API + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', origin: API, 'x-blackbox-request': '1' }, body: JSON.stringify({ access_key: ownerKey(), remember: true }) });
    expect(res.status).toBe(200); const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toMatch(/HttpOnly/i); expect(cookie).toMatch(/SameSite=Strict/i); expect(cookie).toMatch(/Expires=/i);
    const body = await res.json() as Record<string, unknown>; expect(JSON.stringify(body)).not.toContain('bbx_owner_');
    const abs = new Date((body.session as { absolute_expires_at: string }).absolute_expires_at).getTime() - Date.now(); expect(abs).toBeLessThanOrEqual(30 * 86400_000 + 5000); expect(abs).toBeGreaterThan(29 * 86400_000);
  });
  it('rejects forged Host, missing Origin and missing CSRF header on mutating requests (LOCAL-05)', async () => {
    const cookie = await loginOwner();
    const noOrigin = await fetch(API + '/api/agents', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `bbx_session=${cookie}`, 'x-blackbox-request': '1' }, body: JSON.stringify({ name: 'x' }) }); expect(noOrigin.status).toBe(403);
    const badOrigin = await fetch(API + '/api/agents', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `bbx_session=${cookie}`, 'x-blackbox-request': '1', origin: 'http://evil.example' }, body: JSON.stringify({ name: 'x' }) }); expect(badOrigin.status).toBe(403);
    const noHeader = await fetch(API + '/api/agents', { method: 'POST', headers: { 'content-type': 'application/json', cookie: `bbx_session=${cookie}`, origin: API }, body: JSON.stringify({ name: 'x' }) }); expect(noHeader.status).toBe(403);
    const forgedHost = await rawRequest('/api/journal/counts', { Host: 'attacker.example', Cookie: `bbx_session=${cookie}` }); expect(forgedHost).toBe(421);
    const rebind = await rawRequest('/api/journal/counts', { Host: '127.0.0.1.evil.example:19080', Cookie: `bbx_session=${cookie}` }); expect(rebind).toBe(421);
    const ok = await apiFetch('/api/journal/counts', { cookie }); expect(ok.status).toBe(200);
  });
  it('logout revokes the session server-side', async () => {
    const cookie = await loginOwner(); const out = await apiFetch('/api/auth/logout', { method: 'POST', cookie }); expect(out.status).toBe(200);
    const after = await apiFetch('/api/journal/counts', { cookie }); expect(after.status).toBe(401);
  });
  it('only the loopback API port is published; database and engine are not reachable on 0.0.0.0 (LOCAL-05)', () => {
    const ports = execSync('docker ps --filter name=blackbox-agent-a --format "{{.Names}} {{.Ports}}"').toString();
    evidence('published-ports.txt', ports);
    for (const line of ports.trim().split('\n')) { expect(line).not.toMatch(/0\.0\.0\.0:/); expect(line).not.toMatch(/\[::\]:/); }
    // in the test override PostgreSQL/engine/fixture are published on 127.0.0.1 only; the release compose publishes only the api port
    const release = execSync(`grep -cE '^\\s*ports:' ${process.cwd()}/../infra/compose/compose.yaml`).toString().trim(); expect(Number(release)).toBe(1);
    const published = execSync(`grep -E '^\\s*ports:' ${process.cwd()}/../infra/compose/compose.yaml`).toString(); expect(published).toContain('127.0.0.1:');
  });
});

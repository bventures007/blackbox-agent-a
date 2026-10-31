import { randomUUID } from 'node:crypto';
import { withScope, withTenant, type Db, type Tx } from '@blackbox/database';
import { REMEMBERED_ABSOLUTE_DAYS, REMEMBERED_IDLE_DAYS, SESSION_ABSOLUTE_HOURS } from '@blackbox/contracts';
import { generateKey, generateSessionToken, hashSessionToken, keyIdOf, kindOf, looksLikeKey, verifyKey } from './keys.js';

export interface OwnerSession { kind: 'owner'; sessionId: string; ownerId: string; tenantId: string; remembered: boolean; absoluteExpiresAt: Date; idleExpiresAt: Date }
export interface AgentPrincipal { kind: 'agent'; principalId: string; credentialId: string; tenantId: string; name: string }
export interface ProducerPrincipal { kind: 'producer'; principalId: string; credentialId: string; tenantId: string; name: string; connectionId: string | null }
export type Principal = OwnerSession | AgentPrincipal | ProducerPrincipal;

export class AuthError extends Error { constructor(public readonly code: 'invalid_key' | 'throttled' | 'revoked' | 'expired' | 'wrong_kind' | 'no_session', message: string) { super(message); this.name = 'AuthError'; } }

const MAX_FAILURES_BEFORE_DELAY = 5;

/**
 * Authentication adapter boundary (ADR-003). Owner key -> session; agent/producer key -> principal.
 * Revocation is committed before acknowledgement; a 2-second cache keeps streams within the 5-second stop bound.
 */
export class AuthService {
  private readonly cache = new Map<string, { until: number; value: Principal | null }>();
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  private cached(key: string): { hit: boolean; value: Principal | null } { const c = this.cache.get(key); if (c && c.until > Date.now()) return { hit: true, value: c.value }; return { hit: false, value: null }; }
  private remember(key: string, value: Principal | null) { this.cache.set(key, { until: Date.now() + 2000, value }); if (this.cache.size > 5000) this.cache.clear(); }
  invalidateCache() { this.cache.clear(); }

  async throttleCheck(source: string): Promise<void> {
    await withScope(this.db, 'identity', async (tx) => {
      const [row] = await tx`SELECT failures, locked_until FROM login_attempts WHERE source = ${source}`;
      if (row?.locked_until && new Date(row.locked_until as string) > this.now()) throw new AuthError('throttled', 'too many failed attempts; wait before retrying');
    });
  }
  private async recordFailure(source: string) {
    await withScope(this.db, 'identity', async (tx) => {
      const [row] = await tx`INSERT INTO login_attempts (source, failures, updated_at) VALUES (${source}, 1, now()) ON CONFLICT (source) DO UPDATE SET failures = login_attempts.failures + 1, updated_at = now() RETURNING failures`;
      const failures = Number(row?.failures ?? 1);
      if (failures >= MAX_FAILURES_BEFORE_DELAY) { const delay = Math.min(300, 2 ** (failures - MAX_FAILURES_BEFORE_DELAY + 1)); await tx`UPDATE login_attempts SET locked_until = now() + make_interval(secs => ${delay}) WHERE source = ${source}`; }
    });
  }
  private async clearFailures(source: string) { await withScope(this.db, 'identity', (tx) => tx`DELETE FROM login_attempts WHERE source = ${source}`); }

  /** Owner key login -> new session. Throttled per source; no partial match information is revealed. */
  async loginWithOwnerKey(secret: string, source: string, remembered: boolean): Promise<{ token: string; session: OwnerSession }> {
    await this.throttleCheck(source);
    if (!looksLikeKey(secret) || kindOf(secret) !== 'owner') { await this.recordFailure(source); throw new AuthError('invalid_key', 'invalid access key'); }
    const cred = await withScope(this.db, 'identity', async (tx) => { const [c] = await tx`SELECT c.credential_id, c.verifier, c.status, c.tenant_id, p.principal_id FROM credentials c JOIN principals p ON p.principal_id = c.principal_id WHERE c.key_id = ${keyIdOf(secret)} AND c.purpose = 'owner_login'`; return c; });
    if (!cred || cred.status !== 'active' || !verifyKey(secret, Buffer.from(cred.verifier as Uint8Array))) { await this.recordFailure(source); throw new AuthError('invalid_key', 'invalid access key'); }
    await this.clearFailures(source);
    const tenantId = cred.tenant_id as string;
    return withScope(this.db, 'identity', async (tx) => {
      const [owner] = await tx`SELECT owner_id FROM owners WHERE tenant_id = ${tenantId} ORDER BY created_at LIMIT 1`;
      if (!owner) throw new AuthError('invalid_key', 'owner record missing');
      const { token, hash } = generateSessionToken();
      const now = this.now();
      const absolute = new Date(now.getTime() + (remembered ? REMEMBERED_ABSOLUTE_DAYS * 86400_000 : SESSION_ABSOLUTE_HOURS * 3600_000));
      const idle = new Date(now.getTime() + (remembered ? REMEMBERED_IDLE_DAYS * 86400_000 : SESSION_ABSOLUTE_HOURS * 3600_000));
      const sessionId = randomUUID();
      await tx`INSERT INTO sessions (session_id, tenant_id, owner_id, token_hash, remembered, created_at, last_seen_at, absolute_expires_at, idle_expires_at) VALUES (${sessionId}, ${tenantId}, ${owner.owner_id as string}, ${hash}, ${remembered}, ${now}, ${now}, ${absolute}, ${idle})`;
      await tx`UPDATE credentials SET last_used_at = ${now} WHERE credential_id = ${cred.credential_id as string}`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${owner.owner_id as string}, 'session.created', ${tx.json({ remembered, session_id: sessionId })})`;
      return { token, session: { kind: 'owner' as const, sessionId, ownerId: owner.owner_id as string, tenantId, remembered, absoluteExpiresAt: absolute, idleExpiresAt: idle } };
    });
  }

  async authenticateSession(token: string | undefined): Promise<OwnerSession | null> {
    if (!token || !/^[a-z2-7]{52}$/.test(token)) return null;
    const c = this.cached('s:' + token); if (c.hit) return c.value as OwnerSession | null;
    const hash = hashSessionToken(token); const now = this.now();
    const result = await withScope(this.db, 'identity', async (tx) => {
      const [s] = await tx`SELECT session_id, tenant_id, owner_id, remembered, absolute_expires_at, idle_expires_at, revoked_at FROM sessions WHERE token_hash = ${hash}`;
      if (!s || s.revoked_at || new Date(s.absolute_expires_at as string) <= now || new Date(s.idle_expires_at as string) <= now) return null;
      const idle = new Date(now.getTime() + ((s.remembered as boolean) ? REMEMBERED_IDLE_DAYS * 86400_000 : SESSION_ABSOLUTE_HOURS * 3600_000));
      const newIdle = idle < new Date(s.absolute_expires_at as string) ? idle : new Date(s.absolute_expires_at as string);
      await tx`UPDATE sessions SET last_seen_at = ${now}, idle_expires_at = ${newIdle} WHERE session_id = ${s.session_id as string}`;
      return { kind: 'owner' as const, sessionId: s.session_id as string, ownerId: s.owner_id as string, tenantId: s.tenant_id as string, remembered: s.remembered as boolean, absoluteExpiresAt: new Date(s.absolute_expires_at as string), idleExpiresAt: newIdle };
    });
    this.remember('s:' + token, result);
    return result;
  }

  async logout(token: string): Promise<void> {
    const hash = hashSessionToken(token);
    await withScope(this.db, 'identity', (tx) => tx`UPDATE sessions SET revoked_at = now() WHERE token_hash = ${hash} AND revoked_at IS NULL`);
    this.invalidateCache();
  }

  /** Agent or producer key -> principal. Owner keys are refused here by design (never a shared credential for MCP). */
  async authenticateKey(secret: string | undefined, expected: 'agent' | 'producer'): Promise<AgentPrincipal | ProducerPrincipal | null> {
    if (!secret || !looksLikeKey(secret)) return null;
    const kind = kindOf(secret); if (kind !== expected) return null;
    const c = this.cached('k:' + secret); if (c.hit) return c.value as AgentPrincipal | ProducerPrincipal | null;
    const now = this.now();
    const result = await withScope(this.db, 'identity', async (tx) => {
      const [row] = await tx`SELECT c.credential_id, c.verifier, c.status, c.expires_at, c.tenant_id, p.principal_id, p.name, p.kind, p.status AS pstatus FROM credentials c JOIN principals p ON p.principal_id = c.principal_id WHERE c.key_id = ${keyIdOf(secret)} AND c.purpose = ${expected === 'agent' ? 'agent_key' : 'producer_key'}`;
      if (!row || row.status !== 'active' || row.pstatus !== 'active' || row.kind !== expected) return null;
      if (row.expires_at && new Date(row.expires_at as string) <= now) return null;
      if (!verifyKey(secret, Buffer.from(row.verifier as Uint8Array))) return null;
      await tx`UPDATE credentials SET last_used_at = ${now} WHERE credential_id = ${row.credential_id as string}`;
      await tx`UPDATE principals SET last_used_at = ${now} WHERE principal_id = ${row.principal_id as string}`;
      if (expected === 'agent') return { kind: 'agent' as const, principalId: row.principal_id as string, credentialId: row.credential_id as string, tenantId: row.tenant_id as string, name: row.name as string };
      return { kind: 'producer' as const, principalId: row.principal_id as string, credentialId: row.credential_id as string, tenantId: row.tenant_id as string, name: row.name as string, connectionId: null };
    });
    this.remember('k:' + secret, result);
    return result;
  }

  /** Create a named read-only agent principal with its own key; the secret is returned once. */
  async createAgentKey(tenantId: string, ownerId: string, name: string, expiresAt: Date | null): Promise<{ secret: string; principalId: string; credentialId: string }> {
    const key = generateKey('agent'); const principalId = randomUUID(); const credentialId = randomUUID();
    await withTenant(this.db, tenantId, async (tx) => {
      await tx`INSERT INTO principals (principal_id, tenant_id, kind, name, created_by, expires_at) VALUES (${principalId}, ${tenantId}, 'agent', ${name.slice(0, 80)}, ${ownerId}, ${expiresAt})`;
      await tx`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier, expires_at) VALUES (${credentialId}, ${principalId}, ${tenantId}, 'agent_key', ${key.keyId}, ${key.verifier}, ${expiresAt})`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'agent_key.created', ${tx.json({ principal_id: principalId, name })})`;
    });
    return { secret: key.secret, principalId, credentialId };
  }
  async createProducerKey(tenantId: string, ownerId: string, name: string): Promise<{ secret: string; principalId: string }> {
    const key = generateKey('producer'); const principalId = randomUUID();
    await withTenant(this.db, tenantId, async (tx) => {
      await tx`INSERT INTO principals (principal_id, tenant_id, kind, name, created_by) VALUES (${principalId}, ${tenantId}, 'producer', ${name.slice(0, 80)}, ${ownerId})`;
      await tx`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${principalId}, ${tenantId}, 'producer_key', ${key.keyId}, ${key.verifier})`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'producer_key.created', ${tx.json({ principal_id: principalId, name })})`;
    });
    return { secret: key.secret, principalId };
  }
  async revokePrincipal(tenantId: string, ownerId: string, principalId: string): Promise<boolean> {
    const ok = await withTenant(this.db, tenantId, async (tx) => {
      const rows = await tx`UPDATE principals SET status = 'revoked', revoked_at = now() WHERE principal_id = ${principalId} AND tenant_id = ${tenantId} AND status = 'active' RETURNING principal_id`;
      if (rows.length === 0) return false;
      await tx`UPDATE credentials SET status = 'revoked', revoked_at = now() WHERE principal_id = ${principalId} AND tenant_id = ${tenantId}`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'principal.revoked', ${tx.json({ principal_id: principalId })})`;
      return true;
    });
    this.invalidateCache(); // committed before acknowledgement; streams recheck within 2 s
    return ok;
  }
  async listPrincipals(tenantId: string) {
    return withTenant(this.db, tenantId, (tx) => tx`SELECT p.principal_id, p.kind, p.name, p.status, p.created_at, p.expires_at, p.revoked_at, p.last_used_at, c.key_id FROM principals p LEFT JOIN credentials c ON c.principal_id = p.principal_id WHERE p.tenant_id = ${tenantId} AND p.kind IN ('agent','producer') ORDER BY p.created_at DESC`);
  }
  /** Authenticated owner key rotation: re-entry of the current key, new key displayed once, all owner sessions invalidated. */
  async rotateOwnerKey(tenantId: string, ownerId: string, currentSecret: string): Promise<string> {
    if (!looksLikeKey(currentSecret) || kindOf(currentSecret) !== 'owner') throw new AuthError('invalid_key', 'current key does not match');
    const key = generateKey('owner');
    await withScope(this.db, 'identity', async (tx) => {
      const [cred] = await tx`SELECT credential_id, verifier, principal_id FROM credentials WHERE key_id = ${keyIdOf(currentSecret)} AND purpose = 'owner_login' AND status = 'active' AND tenant_id = ${tenantId}`;
      if (!cred || !verifyKey(currentSecret, Buffer.from(cred.verifier as Uint8Array))) throw new AuthError('invalid_key', 'current key does not match');
      await tx`UPDATE credentials SET status = 'revoked', revoked_at = now() WHERE credential_id = ${cred.credential_id as string}`;
      await tx`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${cred.principal_id as string}, ${tenantId}, 'owner_login', ${key.keyId}, ${key.verifier})`;
      await tx`UPDATE sessions SET revoked_at = now() WHERE tenant_id = ${tenantId} AND revoked_at IS NULL`;
      await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'owner', ${ownerId}, 'owner_key.rotated', ${tx.json({ key_id: key.keyId })})`;
    });
    this.invalidateCache();
    return key.secret;
  }
  /** Host-only reset (invoked by the wrapper with migrator credentials, never via HTTP). */
  static async resetAccess(tx: Tx, tenantId: string): Promise<string> {
    const key = generateKey('owner');
    const [cred] = await tx`SELECT principal_id FROM credentials WHERE tenant_id = ${tenantId} AND purpose = 'owner_login' ORDER BY created_at LIMIT 1`;
    if (!cred) throw new Error('no owner credential to reset');
    await tx`UPDATE credentials SET status = 'revoked', revoked_at = now() WHERE tenant_id = ${tenantId} AND status = 'active'`;
    await tx`UPDATE principals SET status = 'revoked', revoked_at = now() WHERE tenant_id = ${tenantId} AND kind IN ('agent','producer') AND status = 'active'`;
    await tx`INSERT INTO credentials (credential_id, principal_id, tenant_id, purpose, key_id, verifier) VALUES (${randomUUID()}, ${cred.principal_id as string}, ${tenantId}, 'owner_login', ${key.keyId}, ${key.verifier})`;
    await tx`UPDATE sessions SET revoked_at = now() WHERE tenant_id = ${tenantId} AND revoked_at IS NULL`;
    await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${tenantId}, 'host', 'wrapper', 'access.reset', ${tx.json({ key_id: key.keyId, agents_revoked: true })})`;
    return key.secret;
  }
}

/** Exact Origin/Host allowlist for mutating requests (CSRF). CORS is never enabled. */
export function originAllowed(headers: Record<string, string | string[] | undefined>, allowedOrigin: string): boolean {
  const host = String(headers.host ?? '');
  const allowedHost = new URL(allowedOrigin).host;
  if (host !== allowedHost && host !== allowedHost.replace('127.0.0.1', 'localhost') && host !== allowedHost.replace('localhost', '127.0.0.1')) return false;
  const origin = headers.origin ? String(headers.origin) : undefined;
  const referer = headers.referer ? String(headers.referer) : undefined;
  const candidates = [allowedOrigin, allowedOrigin.replace('127.0.0.1', 'localhost'), allowedOrigin.replace('localhost', '127.0.0.1')];
  if (origin) return candidates.includes(origin);
  if (referer) { try { return candidates.includes(new URL(referer).origin); } catch { return false; } }
  return false;
}

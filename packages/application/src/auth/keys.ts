import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { AGENT_KEY_PREFIX, OWNER_KEY_PREFIX, PRODUCER_KEY_PREFIX, RECOVERY_KEY_PREFIX } from '@blackbox/contracts';

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567'; // RFC 4648 base32 lowercase, no padding

export function base32(bytes: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const b of bytes) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export type KeyKind = 'owner' | 'agent' | 'producer' | 'recovery';
const PREFIX: Record<KeyKind, string> = { owner: OWNER_KEY_PREFIX, agent: AGENT_KEY_PREFIX, producer: PRODUCER_KEY_PREFIX, recovery: RECOVERY_KEY_PREFIX };

/** 256 random bits -> prefix + 52 base32 chars. The first 8 chars after the prefix are the public key id used for lookup. */
export function generateKey(kind: KeyKind): { secret: string; keyId: string; verifier: Buffer } {
  const secret = PREFIX[kind] + base32(randomBytes(32));
  return { secret, keyId: keyIdOf(secret), verifier: verifierOf(secret) };
}
export function keyIdOf(secret: string): string { const body = secret.slice(secret.indexOf('_', 4) + 1); return body.slice(0, 8); }
export function verifierOf(secret: string): Buffer { return createHash('sha256').update(secret, 'utf8').digest(); }
export function verifyKey(secret: string, verifier: Buffer): boolean { const v = verifierOf(secret); return v.length === verifier.length && timingSafeEqual(v, verifier); }
export function kindOf(secret: string): KeyKind | null { for (const [k, p] of Object.entries(PREFIX)) if (secret.startsWith(p)) return k as KeyKind; return null; }
export function looksLikeKey(s: string): boolean { return /^bbx_(owner|agent|producer|recovery)_[a-z2-7]{52}$/.test(s); }

export function generateSessionToken(): { token: string; hash: Buffer } { const token = base32(randomBytes(32)); return { token, hash: createHash('sha256').update(token).digest() }; }
export function hashSessionToken(token: string): Buffer { return createHash('sha256').update(token).digest(); }

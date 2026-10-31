import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';

/**
 * Installation data keyring: AES-256-GCM with AAD = tenant|purpose|key_version, versioned for rotation.
 * Format: v1:<key_version>:<nonce b64>:<ciphertext+tag b64>. Never falls back to plaintext.
 */
export class DataKeyring {
  private readonly keys = new Map<number, Buffer>();
  constructor(keys: Array<{ version: number; key: Buffer }>, public readonly current: number) {
    for (const k of keys) { if (k.key.length !== 32) throw new Error(`data key v${k.version} must be 32 bytes`); this.keys.set(k.version, k.key); }
    if (!this.keys.has(current)) throw new Error('current data key version missing');
  }
  static fromFiles(paths: Array<{ version: number; path: string }>, current: number): DataKeyring {
    const keys = paths.map((p) => {
      const st = statSync(p.path);
      if ((st.mode & 0o077) !== 0) throw new Error(`data key ${p.path} must not be group/world accessible`);
      const raw = readFileSync(p.path);
      const key = raw.length === 32 ? raw : Buffer.from(raw.toString('utf8').trim(), 'hex');
      return { version: p.version, key };
    });
    return new DataKeyring(keys, current);
  }
  encrypt(plaintext: string, tenantId: string, purpose: string): string {
    const key = this.keys.get(this.current)!; const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce); cipher.setAAD(Buffer.from(`${tenantId}|${purpose}|${this.current}`, 'utf8'));
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return `v1:${this.current}:${nonce.toString('base64')}:${ct.toString('base64')}`;
  }
  decrypt(envelope: string, tenantId: string, purpose: string): string {
    const [fmt, ver, nonceB64, ctB64] = envelope.split(':');
    if (fmt !== 'v1' || !ver || !nonceB64 || !ctB64) throw new Error('unknown envelope format');
    const key = this.keys.get(Number(ver)); if (!key) throw new Error(`data key version ${ver} is not available (missing or retired); cannot decrypt`);
    const ct = Buffer.from(ctB64, 'base64'); const tag = ct.subarray(ct.length - 16); const body = ct.subarray(0, ct.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonceB64, 'base64')); decipher.setAAD(Buffer.from(`${tenantId}|${purpose}|${ver}`, 'utf8')); decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  }
  versions(): number[] { return [...this.keys.keys()].sort(); }
}

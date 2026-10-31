// Backup envelope (ADR-008): X25519 recipient + ephemeral key -> HKDF-SHA256 -> AES-256-GCM over 1 MiB chunks.
// Runs inside the node image; the recovery secret arrives on fd 3 or BBX_RECOVERY_KEY, never as an argument.
// Usage: encrypt <recipient-pub-hex>  (stdin plaintext -> stdout ciphertext)
//        decrypt                       (stdin ciphertext -> stdout plaintext; recovery key from env/fd3)
//        keygen                        (stdout JSON {public_hex, recovery_key})
//        pubkey                        (recovery key from env -> stdout public hex)
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
const MAGIC = Buffer.from('BBXBK1'); const CHUNK = 1 << 20;
const b32 = (b) => { const A = 'abcdefghijklmnopqrstuvwxyz234567'; let bits = 0, v = 0, o = ''; for (const x of b) { v = (v << 8) | x; bits += 8; while (bits >= 5) { o += A[(v >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) o += A[(v << (5 - bits)) & 31]; return o; };
const unb32 = (s) => { const A = 'abcdefghijklmnopqrstuvwxyz234567'; let bits = 0, v = 0; const out = []; for (const c of s) { v = (v << 5) | A.indexOf(c); bits += 5; if (bits >= 8) { out.push((v >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const rawPub = (key) => (key.type === 'public' ? key : createPublicKey(key)).export({ type: 'spki', format: 'der' }).subarray(-32);
const privFromRaw = (raw) => createPrivateKey({ key: Buffer.concat([Buffer.from('302e020100300506032b656e04220420', 'hex'), raw]), format: 'der', type: 'pkcs8' });
const pubFromRaw = (raw) => createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw]), format: 'der', type: 'spki' });
function recoveryKey() { const k = process.env.BBX_RECOVERY_KEY || (() => { try { return readFileSync('/dev/fd/3', 'utf8').trim(); } catch { return ''; } })(); if (!/^bbx_recovery_[a-z2-7]{52}$/.test(k)) { process.stderr.write('recovery key missing or malformed\n'); process.exit(2); } return unb32(k.slice('bbx_recovery_'.length)).subarray(0, 32); }
async function readAll(stream) { const chunks = []; for await (const c of stream) chunks.push(c); return Buffer.concat(chunks); }
const cmd = process.argv[2];
if (cmd === 'keygen') { const { privateKey, publicKey } = generateKeyPairSync('x25519'); const raw = privateKey.export({ type: 'pkcs8', format: 'der' }).subarray(-32); process.stdout.write(JSON.stringify({ public_hex: rawPub(publicKey).toString('hex'), recovery_key: 'bbx_recovery_' + b32(raw) }) + '\n'); }
else if (cmd === 'pubkey') { process.stdout.write(rawPub(privFromRaw(recoveryKey())).toString('hex') + '\n'); }
else if (cmd === 'encrypt') {
  const recipient = pubFromRaw(Buffer.from(process.argv[3], 'hex')); const eph = generateKeyPairSync('x25519');
  const shared = diffieHellman({ privateKey: eph.privateKey, publicKey: recipient }); const salt = randomBytes(16);
  const key = Buffer.from(hkdfSync('sha256', shared, salt, 'blackbox-backup-v1', 32));
  process.stdout.write(Buffer.concat([MAGIC, rawPub(eph.publicKey), salt]));
  let counter = 0; let buf = Buffer.alloc(0); const hash = createHash('sha256');
  const emit = (plain, last) => { const nonce = Buffer.alloc(12); nonce.writeUInt32BE(last ? 1 : 0, 0); nonce.writeBigUInt64BE(BigInt(counter++), 4); const c = createCipheriv('aes-256-gcm', key, nonce); c.setAAD(MAGIC); const ct = Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]); const len = Buffer.alloc(4); len.writeUInt32BE(ct.length); process.stdout.write(Buffer.concat([len, ct])); hash.update(plain); };
  for await (const chunk of process.stdin) { buf = Buffer.concat([buf, chunk]); while (buf.length >= CHUNK) { emit(buf.subarray(0, CHUNK), false); buf = buf.subarray(CHUNK); } }
  emit(buf, true); process.stderr.write(JSON.stringify({ plaintext_sha256: hash.digest('hex'), chunks: counter }) + '\n');
} else if (cmd === 'decrypt') {
  const priv = privFromRaw(recoveryKey()); const data = await readAll(process.stdin);
  if (!data.subarray(0, 6).equals(MAGIC)) { process.stderr.write('not a blackbox backup\n'); process.exit(3); }
  const eph = pubFromRaw(data.subarray(6, 38)); const salt = data.subarray(38, 54); const key = Buffer.from(hkdfSync('sha256', diffieHellman({ privateKey: priv, publicKey: eph }), salt, 'blackbox-backup-v1', 32));
  let off = 54, counter = 0, last = false;
  while (off < data.length) { const len = data.readUInt32BE(off); off += 4; const ct = data.subarray(off, off + len); off += len; let ok = false;
    for (const flag of [0, 1]) { const nonce = Buffer.alloc(12); nonce.writeUInt32BE(flag, 0); nonce.writeBigUInt64BE(BigInt(counter), 4); try { const d = createDecipheriv('aes-256-gcm', key, nonce); d.setAAD(MAGIC); d.setAuthTag(ct.subarray(ct.length - 16)); process.stdout.write(Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()])); ok = true; last = flag === 1; break; } catch { /* try other flag */ } }
    if (!ok) { process.stderr.write('integrity check failed (wrong key or corrupted backup)\n'); process.exit(4); } counter++; if (last) break; }
  if (!last) { process.stderr.write('backup truncated: final chunk missing\n'); process.exit(5); }
} else { process.stderr.write('usage: keygen | pubkey | encrypt <pub-hex> | decrypt\n'); process.exit(2); }

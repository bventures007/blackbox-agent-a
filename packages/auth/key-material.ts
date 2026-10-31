/** Maintained Node AES-256-GCM; bounded versioned material, no plaintext fallback. */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { constants } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";
export const keyId = z.string().regex(/^(?:data-v1|data-[a-f0-9]{32})$/);
export const keyringSchema = z
  .object({
    version: z.literal(1),
    active: keyId,
    keys: z.array(keyId).min(1).max(2),
    identity: z.literal("independent-v1"),
  })
  .strict()
  .refine(
    (v) => new Set(v.keys).size === v.keys.length && v.keys.includes(v.active),
  );
export type Keyring = z.infer<typeof keyringSchema>;
export function materialDirectory() {
  if (!process.env.DATA_KEY_FILE) throw Error("data_key_unavailable");
  return dirname(process.env.DATA_KEY_FILE);
}
export function keyFilename(id: string) {
  keyId.parse(id);
  return id === "data-v1" ? "data" : id;
}
export async function protectedBytes(path: string, limit: number) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (info.mode & 0o177) !== 0 ||
      info.size > limit ||
      (process.getuid?.() !== 0 && info.uid !== process.getuid?.())
    )
      throw Error("protected_material_unsafe");
    const bytes = Buffer.alloc(limit + 1);
    let length = 0;
    while (length <= limit) {
      const { bytesRead } = await file.read(
        bytes,
        length,
        bytes.length - length,
        null,
      );
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > limit) throw Error("protected_material_oversized");
    return bytes.subarray(0, length);
  } finally {
    await file.close();
  }
}
export async function readKeyring(): Promise<Keyring | null> {
  let bytes: Buffer;
  try {
    bytes = await protectedBytes(
      join(materialDirectory(), "keyring.json"),
      1024,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await protectedBytes(join(materialDirectory(), "identity"), 32);
    } catch (identityError) {
      if ((identityError as NodeJS.ErrnoException).code === "ENOENT")
        return null;
      throw identityError;
    }
    throw Error("data_key_metadata_missing");
  }
  return keyringSchema.parse(JSON.parse(bytes.toString()));
}
export async function dataKey(id?: string) {
  const ring = await readKeyring();
  const selected = keyId.parse(id ?? ring?.active ?? "data-v1");
  if (ring ? !ring.keys.includes(selected) : selected !== "data-v1")
    throw Error("data_key_version_unavailable");
  const bytes = await protectedBytes(
    join(materialDirectory(), keyFilename(selected)),
    32,
  );
  if (bytes.length !== 32) throw Error("data_key_unavailable");
  return { id: selected, bytes };
}
export async function identityKey() {
  // Explicit test adapters may supply an isolated identity file without a runtime.
  if (process.env.IDENTITY_KEY_FILE) {
    const bytes = await protectedBytes(process.env.IDENTITY_KEY_FILE, 32);
    if (bytes.length !== 32) throw Error("identity_key_unavailable");
    return bytes;
  }
  if (await readKeyring()) {
    const bytes = await protectedBytes(
      join(materialDirectory(), "identity"),
      32,
    );
    if (bytes.length !== 32) throw Error("identity_key_unavailable");
    return bytes;
  }
  // Pre-keyring development installations preserve the historical derivation.
  // Host rotation refuses this coupling; never silently generate an identity key.
  return (await dataKey("data-v1")).bytes;
}
const magic = Buffer.from("BBEVID02");
const maxPlaintext = 2 * 1024 * 1024;
export const maxEvidenceCiphertext = maxPlaintext + 128;
export function evidenceKeyId(bytes: Buffer) {
  if (!bytes.subarray(0, magic.length).equals(magic)) return "data-v1";
  const length = bytes[magic.length];
  if (!length || length > 64 || bytes.length < magic.length + 1 + length + 28)
    throw Error("evidence_envelope_invalid");
  return keyId.parse(
    bytes
      .subarray(magic.length + 1, magic.length + 1 + length)
      .toString("utf8"),
  );
}
export async function encryptEvidence(
  tenant: string,
  evidence: string,
  plain: Buffer,
  target?: string,
) {
  if (plain.length > maxPlaintext) throw Error("evidence_too_large");
  const key = await dataKey(target),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
  cipher.setAAD(
    Buffer.from(`blackbox-evidence-v2:${tenant}:${evidence}:${key.id}`),
  );
  return Buffer.concat([
    magic,
    Buffer.from([key.id.length]),
    Buffer.from(key.id),
    nonce,
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export async function decryptEvidence(
  tenant: string,
  evidence: string,
  bytes: Buffer,
) {
  if (bytes.length < 28 || bytes.length > maxEvidenceCiphertext)
    throw Error("evidence_envelope_invalid");
  const id = evidenceKeyId(bytes),
    key = await dataKey(id),
    v2 = bytes.subarray(0, magic.length).equals(magic);
  const offset = v2 ? magic.length + 1 + bytes[magic.length] : 0;
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key.bytes,
    bytes.subarray(offset, offset + 12),
  );
  decipher.setAAD(
    Buffer.from(
      v2
        ? `blackbox-evidence-v2:${tenant}:${evidence}:${id}`
        : `v1:${tenant}:${evidence}`,
    ),
  );
  decipher.setAuthTag(bytes.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(bytes.subarray(offset + 12, -16)),
    decipher.final(),
  ]);
  if (plain.length > maxPlaintext) throw Error("evidence_too_large");
  return plain;
}
export async function durableReplace(path: string, bytes: Buffer) {
  const temporary = path + "." + randomBytes(16).toString("hex") + ".tmp";
  const file = await open(
    temporary,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    await rename(temporary, path);
    const directory = await open(
      dirname(path),
      constants.O_RDONLY | constants.O_DIRECTORY,
    );
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    await file.close();
    await unlink(temporary).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}

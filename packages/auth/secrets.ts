import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
} from "node:crypto";
import { dataKey, identityKey, keyId } from "./key-material.js";
import { z } from "zod";
const envelope = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    key_version: keyId,
    nonce: z.string().max(32),
    ciphertext: z.string().max(128 * 1024),
    tag: z.string().max(32),
  })
  .strict();
export async function sealSecret(
  tenant: string,
  purpose: string,
  value: unknown,
  target?: string,
) {
  const key = await dataKey(target),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key.bytes, nonce);
  cipher.setAAD(
    Buffer.from(`blackbox-secret-v2:${tenant}:${purpose}:${key.id}`),
  );
  const plaintext = JSON.stringify(value);
  if (Buffer.byteLength(plaintext) > 64 * 1024)
    throw Error("secret_material_oversized");
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    version: 2 as const,
    key_version: key.id,
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}
export async function openSecret(
  tenant: string,
  purpose: string,
  value: unknown,
) {
  const box = envelope.parse(value),
    key = await dataKey(box.key_version),
    decipher = createDecipheriv(
      "aes-256-gcm",
      key.bytes,
      Buffer.from(box.nonce, "base64"),
    );
  if (box.version === 1 && box.key_version !== "data-v1")
    throw Error("secret_envelope_invalid");
  const nonce = Buffer.from(box.nonce, "base64"),
    tag = Buffer.from(box.tag, "base64"),
    ciphertext = Buffer.from(box.ciphertext, "base64");
  if (
    nonce.length !== 12 ||
    tag.length !== 16 ||
    nonce.toString("base64") !== box.nonce ||
    tag.toString("base64") !== box.tag ||
    ciphertext.toString("base64") !== box.ciphertext ||
    ciphertext.length > 64 * 1024
  )
    throw Error("secret_envelope_invalid");
  decipher.setAAD(
    Buffer.from(
      box.version === 1
        ? `blackbox-secret-v1:${tenant}:${purpose}`
        : `blackbox-secret-v2:${tenant}:${purpose}:${box.key_version}`,
    ),
  );
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString(),
  );
}
export function secretKeyVersion(value: unknown) {
  return envelope.parse(value).key_version;
}

export async function opaqueIdentity(scope: string, value: string) {
  const key = await identityKey(),
    bytes = createHmac("sha256", key)
      .update(`${scope}:${value}`)
      .digest()
      .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

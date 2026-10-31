import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
const envelope = z
  .object({
    version: z.literal(1),
    key_version: z.literal("data-v1"),
    nonce: z.string(),
    ciphertext: z.string(),
    tag: z.string(),
  })
  .strict();
export async function sealSecret(
  tenant: string,
  purpose: string,
  value: unknown,
) {
  const key = await readFile(process.env.DATA_KEY_FILE!),
    nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`blackbox-secret-v1:${tenant}:${purpose}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    key_version: "data-v1",
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
    key = await readFile(process.env.DATA_KEY_FILE!),
    decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(box.nonce, "base64"),
    );
  decipher.setAAD(Buffer.from(`blackbox-secret-v1:${tenant}:${purpose}`));
  decipher.setAuthTag(Buffer.from(box.tag, "base64"));
  return JSON.parse(
    Buffer.concat([
      decipher.update(Buffer.from(box.ciphertext, "base64")),
      decipher.final(),
    ]).toString(),
  );
}
export async function opaqueIdentity(scope: string, value: string) {
  const key = await readFile(
      process.env.IDENTITY_KEY_FILE ?? process.env.DATA_KEY_FILE!,
    ),
    bytes = createHmac("sha256", key)
      .update(`${scope}:${value}`)
      .digest()
      .subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 80;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = bytes.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

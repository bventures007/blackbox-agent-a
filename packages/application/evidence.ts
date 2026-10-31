import { readFile } from "node:fs/promises";
import { createDecipheriv, createHash } from "node:crypto";
import { join } from "node:path";
import { scoped } from "../database/index.js";
export async function readEvidence(tenant: string, id: string) {
  const metadata = await scoped(
    tenant,
    async (c) =>
      (
        await c.query(
          "SELECT sha256 FROM bb.evidence WHERE evidence_id=$1 AND expires_at>now()",
          [id],
        )
      ).rows[0],
  );
  if (!metadata) return null;
  let bytes: Buffer;
  try {
    bytes = await readFile(join(process.env.EVIDENCE_DIR!, tenant, id));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  const key = await readFile(process.env.DATA_KEY_FILE!);
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`v1:${tenant}:${id}`));
  decipher.setAuthTag(bytes.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(bytes.subarray(12, -16)),
    decipher.final(),
  ]);
  if (createHash("sha256").update(plain).digest("hex") !== metadata.sha256)
    throw Error("evidence_integrity_failed");
  return JSON.parse(plain.toString());
}

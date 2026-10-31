import {
  decryptEvidence,
  protectedBytes,
  maxEvidenceCiphertext,
} from "../auth/key-material.js";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { scoped } from "../database/index.js";
export async function readEvidence(tenant: string, id: string) {
  return scoped(tenant, async (c) => {
    // Policy/restriction writers take this same workspace lock exclusively.
    await c.query("SELECT tenant_id FROM bb.heads FOR SHARE");
    const metadata = (
      await c.query(
        "SELECT sha256 FROM bb.evidence_retention WHERE evidence_id=$1 AND accessible",
        [id],
      )
    ).rows[0];
    if (!metadata) return null;
    let bytes: Buffer;
    try {
      bytes = await protectedBytes(
        join(process.env.EVIDENCE_DIR!, tenant, id),
        maxEvidenceCiphertext,
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    const plain = await decryptEvidence(tenant, id, bytes);
    if (createHash("sha256").update(plain).digest("hex") !== metadata.sha256)
      throw Error("evidence_integrity_failed");
    return JSON.parse(plain.toString());
  });
}

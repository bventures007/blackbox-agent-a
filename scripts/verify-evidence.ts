import {
  dataKey,
  decryptEvidence,
  maxEvidenceCiphertext,
} from "../packages/auth/key-material.js";
/** Host-only maintenance verifier. Never emits keys, raw content, or provider identifiers. */
import pg from "pg";
import { open } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
const pool = new pg.Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  options: "-c statement_timeout=5000",
  max: 1,
});
async function bounded(path: string, limit: number) {
  const file = await open(
    path,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const info = await file.stat();
    if (
      !info.isFile() ||
      info.nlink !== 1 ||
      (info.mode & 0o077) !== 0 ||
      info.size > limit
    )
      throw Error("evidence_material_unsafe");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
try {
  await dataKey();
  let tenant = "00000000-0000-0000-0000-000000000000",
    id = tenant,
    count = 0;
  while (true) {
    const { rows } = await pool.query(
      "SELECT tenant_id,evidence_id,sha256 FROM bb.evidence WHERE expires_at>now() AND (tenant_id,evidence_id)>($1::uuid,$2::uuid) ORDER BY tenant_id,evidence_id LIMIT 256",
      [tenant, id],
    );
    if (!rows.length) break;
    for (const row of rows) {
      if (++count > 100000)
        throw Error("evidence_verification_budget_exceeded");
      const bytes = await bounded(
        join(process.env.EVIDENCE_DIR!, row.tenant_id, row.evidence_id),
        maxEvidenceCiphertext,
      );
      const plain = await decryptEvidence(
        row.tenant_id,
        row.evidence_id,
        bytes,
      );
      if (createHash("sha256").update(plain).digest("hex") !== row.sha256)
        throw Error("evidence_integrity_failed");
      tenant = row.tenant_id;
      id = row.evidence_id;
    }
  }
  console.log(
    JSON.stringify({
      status: "passed",
      checked_retained_evidence: count,
      key_binding: "tenant_and_evidence_AAD",
      content_exposed: false,
    }),
  );
} catch {
  console.error("evidence_material_verification_failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}

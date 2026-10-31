import { maintainCheckpoints } from "../packages/application/checkpoint-maintenance.js";
/** Fenced host maintenance only. No provider credentials, raw content or key bytes in output. */
import pg from "pg";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  readKeyring,
  keyId,
  protectedBytes,
  decryptEvidence,
  encryptEvidence,
  evidenceKeyId,
  maxEvidenceCiphertext,
  durableReplace,
} from "../packages/auth/key-material.js";
import {
  openSecret,
  sealSecret,
  secretKeyVersion,
} from "../packages/auth/secrets.js";
const pool = new pg.Pool({
  connectionString: process.env.ADMIN_DATABASE_URL,
  options: "-c statement_timeout=5000 -c lock_timeout=5000",
  max: 1,
});
const mode = process.argv[2],
  target = keyId.parse(process.argv[3]);
const started = Date.now(),
  counts = {
    evidence_checked: 0,
    evidence_reencrypted: 0,
    expired_already_absent: 0,
    credentials_checked: 0,
    credentials_reencrypted: 0,
  };
function budget(count: number) {
  if (count > 100000 || Date.now() - started > 300000)
    throw Error("rotation_budget_exceeded");
}
try {
  if (
    !["transform", "verify"].includes(mode) ||
    !process.env.ADMIN_DATABASE_URL
  )
    throw Error("invalid_host_rotation_command");
  const ring = await readKeyring();
  if (!ring || !ring.keys.includes(target))
    throw Error("rotation_key_unavailable");
  let tenant = "00000000-0000-0000-0000-000000000000",
    id = tenant;
  while (true) {
    const { rows } = await pool.query(
      "SELECT tenant_id,evidence_id,sha256,retained FROM bb.evidence_retention WHERE (tenant_id,evidence_id)>($1::uuid,$2::uuid) ORDER BY tenant_id,evidence_id LIMIT 256",
      [tenant, id],
    );
    if (!rows.length) break;
    for (const row of rows) {
      budget(++counts.evidence_checked);
      tenant = row.tenant_id;
      id = row.evidence_id;
      const path = join(process.env.EVIDENCE_DIR!, tenant, id);
      let bytes: Buffer;
      try {
        bytes = await protectedBytes(path, maxEvidenceCiphertext);
      } catch (error) {
        if (
          !row.retained &&
          (error as NodeJS.ErrnoException).code === "ENOENT"
        ) {
          counts.expired_already_absent++;
          continue;
        }
        throw error;
      }
      const plain = await decryptEvidence(tenant, id, bytes);
      if (createHash("sha256").update(plain).digest("hex") !== row.sha256)
        throw Error("evidence_integrity_failed");
      if (evidenceKeyId(bytes) !== target) {
        if (mode === "verify") throw Error("evidence_old_key_remaining");
        const next = await encryptEvidence(tenant, id, plain, target);
        if (!plain.equals(await decryptEvidence(tenant, id, next)))
          throw Error("evidence_reencryption_mismatch");
        await durableReplace(path, next);
        counts.evidence_reencrypted++;
      }
    }
  }
  tenant = "00000000-0000-0000-0000-000000000000";
  id = tenant;
  while (true) {
    const { rows } = await pool.query(
      "SELECT tenant_id,connection_id,key_version,sealed FROM bb.source_secrets WHERE (tenant_id,connection_id)>($1::uuid,$2::uuid) ORDER BY tenant_id,connection_id LIMIT 256",
      [tenant, id],
    );
    if (!rows.length) break;
    for (const row of rows) {
      budget(++counts.credentials_checked);
      tenant = row.tenant_id;
      id = row.connection_id;
      if (secretKeyVersion(row.sealed) !== row.key_version)
        throw Error("credential_key_metadata_mismatch");
      const plain = await openSecret(tenant, id, row.sealed);
      if (row.key_version !== target) {
        if (mode === "verify") throw Error("credential_old_key_remaining");
        const sealed = await sealSecret(tenant, id, plain, target);
        if (
          JSON.stringify(await openSecret(tenant, id, sealed)) !==
          JSON.stringify(plain)
        )
          throw Error("credential_reencryption_mismatch");
        const result = await pool.query(
          "UPDATE bb.source_secrets SET sealed=$3,key_version=$4,updated_at=now() WHERE tenant_id=$1 AND connection_id=$2 AND sealed=$5::jsonb",
          [tenant, id, sealed, target, row.sealed],
        );
        if (result.rowCount !== 1)
          throw Error("credential_changed_during_rotation");
        counts.credentials_reencrypted++;
      }
    }
  }
  const cursorCounts = await maintainCheckpoints(
    pool,
    target,
    mode === "transform",
  );
  console.log(
    JSON.stringify({
      ...cursorCounts,
      status: "passed",
      mode,
      target,
      ...counts,
      content_exposed: false,
    }),
  );
} catch {
  console.error(
    "data_key_rotation_verification_failed; runtime remains fenced; restore original material or resume the host operation",
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}

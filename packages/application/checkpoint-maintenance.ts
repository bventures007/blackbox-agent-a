/** Host-fenced verification/rotation shared by backup, restore and key retirement. */
import type { Pool } from "pg";
import { secretKeyVersion } from "../auth/secrets.js";
import { openCheckpoint, sealCheckpoint } from "./source-checkpoint.js";
export async function maintainCheckpoints(
  pool: Pool,
  target?: string,
  transform = false,
) {
  let tenant = "00000000-0000-0000-0000-000000000000",
    id = tenant;
  const started = Date.now(),
    counts = { cursors_checked: 0, cursors_reencrypted: 0 };
  while (true) {
    const { rows } = await pool.query(
      "SELECT tenant_id,connection_id,job_id,checkpoint FROM bb.source_jobs WHERE (checkpoint ? 'sealed_after' OR checkpoint->>'after' IS NOT NULL) AND (tenant_id,job_id)>($1::uuid,$2::uuid) ORDER BY tenant_id,job_id LIMIT 256",
      [tenant, id],
    );
    if (!rows.length) return counts;
    for (const row of rows) {
      if (++counts.cursors_checked > 100000 || Date.now() - started > 300000)
        throw Error("cursor_verification_budget_exceeded");
      tenant = row.tenant_id;
      id = row.job_id;
      const plain = await openCheckpoint(
        tenant,
        row.connection_id,
        id,
        row.checkpoint,
      );
      if (target && secretKeyVersion(row.checkpoint.sealed_after) !== target) {
        if (!transform) throw Error("cursor_old_key_remaining");
        const next = await sealCheckpoint(
          tenant,
          row.connection_id,
          id,
          plain,
          target,
        );
        if (
          JSON.stringify(
            await openCheckpoint(tenant, row.connection_id, id, next),
          ) !== JSON.stringify(plain)
        )
          throw Error("cursor_reencryption_mismatch");
        const result = await pool.query(
          "UPDATE bb.source_jobs SET checkpoint=$3 WHERE tenant_id=$1 AND job_id=$2 AND checkpoint=$4::jsonb",
          [tenant, id, next, row.checkpoint],
        );
        if (result.rowCount !== 1)
          throw Error("cursor_changed_during_rotation");
        counts.cursors_reencrypted++;
      }
    }
  }
}

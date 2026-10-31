import { randomUUID } from "node:crypto";
import { scoped } from "../database/index.js";

const terminal = new Set([
  "unsupported_event",
  "unsupported_event_version",
  "reducer_conflict",
  "entity_history_too_large",
]);
export const AUTOMATIC_ATTEMPTS = 8;

/** Private engine failures carry only a closed code and optional immutable entry identity. */
export function derivationFailure(value: unknown): {
  code: string;
  entry?: string;
} {
  const failure = value as { error?: unknown; entry_id?: unknown } | null;
  return {
    code:
      typeof failure?.error === "string" && terminal.has(failure.error)
        ? failure.error
        : "derivation_retry_exhausted",
    ...(typeof failure?.entry_id === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(failure.entry_id)
      ? { entry: failure.entry_id }
      : {}),
  };
}
export async function recordDerivationFailure(tenant: string, value?: unknown) {
  const failure = derivationFailure(value);
  return scoped(tenant, async (c) => {
    // Same lock as the engine: an already committed apply must never be quarantined.
    await c.query("SELECT tenant_id FROM bb.heads FOR UPDATE");
    const row = (
      await c.query(
        `SELECT o.*,j.entry_id,j.connection_id,j.evidence_id FROM bb.outbox o JOIN bb.journal j USING(tenant_id,sequence)
       WHERE o.state='pending' AND o.next_at<=now()
       ORDER BY (j.entry_id=$1::uuid) DESC NULLS LAST,o.sequence LIMIT 1 FOR UPDATE OF o`,
        [failure.entry ?? null],
      )
    ).rows[0];
    if (!row) return { state: "unchanged" };
    const attempts = row.attempts + 1;
    const quarantined =
      terminal.has(failure.code) || attempts >= AUTOMATIC_ATTEMPTS;
    await c.query(
      `UPDATE bb.outbox SET attempts=$2,state=$3,error_code=$4,failed_at=CASE WHEN $4::text IS NULL THEN NULL ELSE now() END,
       next_at=now()+make_interval(secs=>$5) WHERE sequence=$1`,
      [
        row.sequence,
        attempts,
        quarantined ? "quarantined" : "pending",
        quarantined ? failure.code : null,
        2 ** attempts,
      ],
    );
    if (quarantined) {
      await c.query(
        `INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,entry_id,evidence_id,kind)
         VALUES($1,$2,$3,$4,$5,'derivation_failed')
         ON CONFLICT(tenant_id,entry_id) WHERE kind='derivation_failed'
         DO UPDATE SET state='open',revision=bb.review_cases.revision+1,updated_at=now(),resolved_at=NULL`,
        [
          tenant,
          randomUUID(),
          row.connection_id,
          row.entry_id,
          row.evidence_id,
        ],
      );
    }
    return {
      state: quarantined ? "quarantined" : "pending",
      attempts,
      error_code: quarantined ? failure.code : null,
    };
  });
}

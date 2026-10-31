import { createHash, randomUUID, createCipheriv } from "node:crypto";
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { scoped } from "../database/index.js";
import type { PoolClient } from "pg";
import { observation, type IngestObservation } from "../contracts/index.js";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export type IngestResult = {
  committed_cursor: number;
  added: number;
  duplicates: number;
  conflicts: number;
  evidence_id: string;
  review_case_ids: string[];
  reviewed_conflicts: number;
};
export type IngestTransaction = {
  providerSnapshot?: boolean;
  origin?: "owner_decision";
  before?: (c: PoolClient) => Promise<void>;
  committed?: (c: PoolClient, result: IngestResult) => Promise<void>;
};
export async function ingest(
  tenant: string,
  connection: string,
  inputs: IngestObservation[],
  raw: unknown,
  transaction: IngestTransaction = {},
) {
  if (inputs.length > 250) throw new Error("batch_too_large");
  const parsed = inputs.map((x) => observation.parse(x));
  const evidence = randomUUID();
  const bytes = Buffer.from(JSON.stringify(raw));
  if (bytes.length > 2 * 1024 * 1024) throw new Error("evidence_too_large");
  const key = await readFile(process.env.DATA_KEY_FILE!);
  if (key.length !== 32) throw new Error("data_key_unavailable");
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(12)));
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`v1:${tenant}:${evidence}`));
  const encrypted = Buffer.concat([
    nonce,
    cipher.update(bytes),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const dir = join(process.env.EVIDENCE_DIR!, tenant);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await writeFile(join(dir, `${evidence}.tmp`), encrypted, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(join(dir, `${evidence}.tmp`), join(dir, evidence));
  return scoped(tenant, async (c) => {
    await transaction.before?.(c);
    const conn = await c.query(
      "SELECT 1 FROM bb.connections WHERE connection_id=$1",
      [connection],
    );
    if (!conn.rowCount) throw new Error("connection_unavailable");
    let cursor = Number(
      (
        await c.query(
          "SELECT committed FROM bb.heads WHERE tenant_id=$1 FOR UPDATE",
          [tenant],
        )
      ).rows[0].committed,
    );
    await c.query(
      "INSERT INTO bb.evidence(tenant_id,evidence_id,sha256) VALUES($1,$2,$3)",
      [tenant, evidence, hash(bytes.toString())],
    );
    const reviewCases: string[] = [];
    let reviewedConflicts = 0;
    let added = 0,
      duplicates = 0,
      conflicts = 0;
    for (const e of parsed) {
      // Preserve identities written by the earlier content-addressed synthetic adapter.
      // A provider revision identifies a claim; its content must not change that identity.
      if (
        transaction.providerSnapshot &&
        "record" in e &&
        e.record.dataset !== "coverage"
      ) {
        const prior = (
          await c.query(
            "SELECT provider_identity FROM bb.journal WHERE connection_id=$1 AND record_type='source' AND record_id=$2 AND occurred_at=$3 AND ($4='orders' OR event_type=$5) ORDER BY sequence LIMIT 1",
            [
              connection,
              e.economic_id,
              e.occurred_at,
              e.record.dataset,
              e.kind,
            ],
          )
        ).rows[0];
        if (prior) e.id = prior.provider_identity;
      }
      const payload = JSON.stringify(e),
        digest = hash(payload);
      const old = await c.query(
        "SELECT entry_id,payload_hash FROM bb.journal WHERE connection_id=$1 AND provider_identity=$2 AND record_type='source'",
        [connection, e.id],
      );
      if (
        !old.rows[0] &&
        transaction.providerSnapshot &&
        "record" in e &&
        e.record.dataset === "fulfillments"
      ) {
        // A later administrative snapshot cannot silently remove recorded physical evidence.
        // The journal head lock serializes this check with ingestion and owner corrections.
        const prior = (
          await c.query(
            "SELECT entry_id,payload_hash,payload->'record' AS record FROM bb.journal j WHERE connection_id=$1 AND record_type='source' AND record_id=$2 AND occurred_at<$3 AND NOT EXISTS(SELECT 1 FROM bb.journal s WHERE s.supersedes_entry_id=j.entry_id) ORDER BY occurred_at DESC,sequence DESC LIMIT 1",
            [connection, e.economic_id, e.occurred_at],
          )
        ).rows[0];
        if (
          prior &&
          ["handed_over", "delivered"].includes(prior.record.state)
        ) {
          const next = e.record;
          const changedMilestone = ["handover_at", "delivered_at"].some(
            (k) => prior.record[k] && prior.record[k] !== (next as any)[k],
          );
          const physicalRegression =
            prior.record.state === "delivered"
              ? next.state !== "delivered"
              : !["handed_over", "delivered"].includes(next.state);
          const quantities = (lines: any[]) =>
            JSON.stringify(
              [...lines]
                .sort((a, b) => a.line_id.localeCompare(b.line_id))
                .map((l) => [l.line_id, l.quantity, l.unit]),
            );
          if (
            changedMilestone ||
            physicalRegression ||
            quantities(prior.record.lines) !== quantities(next.lines)
          )
            old.rows.push(prior);
        }
      }
      if (old.rows[0]) {
        if (old.rows[0].payload_hash === digest) {
          duplicates++;
          continue;
        }
        const priorCase = (
          await c.query(
            "SELECT case_id,state FROM bb.review_cases WHERE connection_id=$1 AND entry_id=$2 AND claim_hash=$3",
            [connection, old.rows[0].entry_id, digest],
          )
        ).rows[0];
        if (priorCase?.state === "resolved") {
          duplicates++;
          reviewedConflicts++;
          continue;
        }
        const caseId = priorCase?.case_id ?? randomUUID();
        if (!priorCase) {
          await c.query(
            "INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,entry_id,kind,evidence_id,claim_hash) VALUES($1,$2,$3,$4,'provider_content_conflict',$5,$6)",
            [
              tenant,
              caseId,
              connection,
              old.rows[0].entry_id,
              evidence,
              digest,
            ],
          );
          await c.query(
            "INSERT INTO bb.review_claims(tenant_id,case_id,claim,evidence_id)VALUES($1,$2,$3,$4)",
            [tenant, caseId, e, evidence],
          );
          if ("record" in e && e.record.dataset !== "coverage") {
            parsed.push(
              observation.parse({
                id: randomUUID(),
                economic_id: caseId,
                entity_id: e.entity_id,
                kind: "coverage.observed",
                occurred_at: e.occurred_at,
                test: e.test,
                record: {
                  dataset: "coverage",
                  capability: e.record.dataset,
                  entity_scope: e.entity_id,
                  history_start: e.occurred_at,
                  complete_through: e.occurred_at,
                  backfill_complete: false,
                  missing_fields: ["source_conflict"],
                  failure_state: "error",
                  basis: "declared",
                  history_kind: "mixed",
                },
              }),
            );
          }
        }
        reviewCases.push(caseId);
        conflicts++;
        continue;
      }
      if (e.supersedes_entry_id) {
        const original = await c.query(
          "SELECT record_id,entity_id,record_type FROM bb.journal WHERE entry_id=$1",
          [e.supersedes_entry_id],
        );
        if (
          original.rows[0]?.record_id !== e.economic_id ||
          original.rows[0]?.entity_id !== e.entity_id ||
          original.rows[0]?.record_type !== "source"
        )
          throw Error("invalid_supersession_scope");
      }
      if ("record" in e) {
        const prior = await c.query(
          "SELECT connection_id,payload->'record'->>'dataset' AS dataset FROM bb.journal WHERE record_id=$1 AND record_type='source' AND payload ? 'record' LIMIT 1",
          [e.economic_id],
        );
        if (
          prior.rows[0] &&
          (prior.rows[0].connection_id !== connection ||
            prior.rows[0].dataset !== e.record.dataset)
        )
          throw Error("record_identity_conflict");
      }
      cursor++;
      const entry = randomUUID();
      await c.query(
        `INSERT INTO bb.journal(tenant_id,sequence,entry_id,record_type,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,supersedes_entry_id,rule_version,correlation_id) VALUES($1,$2,$3,'source',$4,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,$15,$14)`,
        [
          tenant,
          cursor,
          entry,
          e.economic_id,
          e.kind,
          connection,
          e.entity_id,
          e.id,
          e.occurred_at,
          payload,
          digest,
          evidence,
          e.supersedes_entry_id ?? null,
          randomUUID(),
          transaction.origin === "owner_decision"
            ? "owner-decision-v1"
            : "source-v1",
        ],
      );
      if (
        "record" in e &&
        transaction.origin !== "owner_decision" &&
        (("confidence" in e.record && e.record.confidence === "ambiguous") ||
          ("match_confidence" in e.record &&
            ["ambiguous", "unmatched"].includes(e.record.match_confidence)))
      ) {
        const caseId = randomUUID();
        await c.query(
          "INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,entry_id,kind,evidence_id)VALUES($1,$2,$3,$4,'unresolved_link',$5)",
          [tenant, caseId, connection, entry, evidence],
        );
        reviewCases.push(caseId);
      }
      await c.query(
        "INSERT INTO bb.outbox(tenant_id,sequence,entity_id) VALUES($1,$2,$3)",
        [tenant, cursor, e.entity_id],
      );
      added++;
    }
    await c.query("UPDATE bb.heads SET committed=$2 WHERE tenant_id=$1", [
      tenant,
      cursor,
    ]);
    const result = {
      committed_cursor: cursor,
      added,
      duplicates,
      conflicts,
      evidence_id: evidence,
      review_case_ids: reviewCases,
      reviewed_conflicts: reviewedConflicts,
    };
    await transaction.committed?.(c, result);
    return result;
  });
}

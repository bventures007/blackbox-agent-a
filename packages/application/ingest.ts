import { createHash, randomUUID, createCipheriv } from "node:crypto";
import { mkdir, writeFile, rename, readFile } from "node:fs/promises";
import { join } from "node:path";
import { scoped } from "../database/index.js";
import { observation, type Observation } from "../contracts/index.js";
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export async function ingest(
  tenant: string,
  connection: string,
  inputs: Observation[],
  raw: unknown,
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
    let added = 0,
      duplicates = 0,
      conflicts = 0;
    for (const e of parsed) {
      const payload = JSON.stringify(e),
        digest = hash(payload);
      const old = await c.query(
        "SELECT entry_id,payload_hash FROM bb.journal WHERE connection_id=$1 AND provider_identity=$2 AND record_type='source'",
        [connection, e.id],
      );
      if (old.rows[0]) {
        if (old.rows[0].payload_hash === digest) {
          duplicates++;
          continue;
        }
        await c.query(
          "INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,entry_id,kind) VALUES($1,$2,$3,$4,$5)",
          [
            tenant,
            randomUUID(),
            connection,
            old.rows[0].entry_id,
            "provider_content_conflict",
          ],
        );
        conflicts++;
        continue;
      }
      cursor++;
      const entry = randomUUID();
      await c.query(
        `INSERT INTO bb.journal(tenant_id,sequence,entry_id,record_type,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,supersedes_entry_id,rule_version,correlation_id) VALUES($1,$2,$3,'source',$4,$5,1,$6,$7,$8,$9,$10,$11,$12,$13,'source-v1',$14)`,
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
        ],
      );
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
    return {
      committed_cursor: cursor,
      added,
      duplicates,
      conflicts,
      evidence_id: evidence,
    };
  });
}

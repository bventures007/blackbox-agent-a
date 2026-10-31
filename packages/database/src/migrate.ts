import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import type { Db } from './client.js';

export interface MigrationResult { applied: string[]; skipped: string[] }

/** Apply reviewed SQL migrations in version order using the migrator connection. Serialized by an advisory lock. */
export async function migrate(db: Db, dir: string): Promise<MigrationResult> {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const result: MigrationResult = { applied: [], skipped: [] };
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(730011)`;
    await tx`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`;
    const done = new Map<string, string>((await tx`SELECT version, checksum FROM schema_migrations`).map((r) => [r.version as string, r.checksum as string]));
    for (const file of files) {
      const version = file.slice(0, 4);
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const existing = done.get(version);
      if (existing) {
        if (existing !== checksum) throw new Error(`migration ${file} changed after it was applied (checksum mismatch); write a new migration instead`);
        result.skipped.push(file);
        continue;
      }
      await tx.unsafe(sql);
      await tx`INSERT INTO schema_migrations (version, checksum) VALUES (${version}, ${checksum})`;
      result.applied.push(file);
    }
  });
  return result;
}

export function latestMigrationVersion(dir: string): number {
  const files = readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  return Number(files.at(-1)?.slice(0, 4) ?? 0);
}

/**
 * Host-only administrative commands executed by the wrapper inside the API image with the migrator connection:
 *   migrate | setup | reset-access | status
 * The owner key is printed to the terminal only; it never enters logs.
 */
import { createDb, migrate, latestMigrationVersion } from '@blackbox/database';
import { AuthService, setupWorkspace } from '@blackbox/application';
import { readFileSync } from 'node:fs';

const cmd = process.argv[2];
const migrationsDir = process.env.MIGRATIONS_DIR ?? new URL('../../../packages/database/migrations', import.meta.url).pathname;
function secret(fileEnv: string, inlineEnv: string): string { const f = process.env[fileEnv]; if (f) return readFileSync(f, 'utf8').trim(); const v = process.env[inlineEnv]; if (!v) throw new Error(`missing ${fileEnv}/${inlineEnv}`); return v; }
const url = secret('MIGRATOR_DATABASE_URL_FILE', 'MIGRATOR_DATABASE_URL');
const db = createDb({ url, max: 2, applicationName: 'blackbox-admin' });
const version = process.env.SERVICE_VERSION ?? '0.1.0-dev';
try {
  if (cmd === 'migrate') {
    const r = await migrate(db, migrationsDir);
    console.log(JSON.stringify({ ok: true, applied: r.applied, skipped: r.skipped.length }));
  } else if (cmd === 'setup') {
    await migrate(db, migrationsDir);
    const r = await setupWorkspace(db, { workspaceName: process.env.WORKSPACE_NAME ?? 'My workspace', timezone: process.env.WORKSPACE_TIMEZONE ?? 'Europe/Berlin', appVersion: version, schemaVersion: latestMigrationVersion(migrationsDir), reducerVersion: 'r1' });
    if (r.created) { console.log(`BLACKBOX_SETUP_RESULT created`); console.log(`BLACKBOX_OWNER_KEY ${r.ownerKey}`); }
    else console.log(`BLACKBOX_SETUP_RESULT existing`);
  } else if (cmd === 'reset-access') {
    const key = await db.begin(async (tx) => { const [t] = await tx`SELECT tenant_id FROM tenants WHERE kind = 'workspace' ORDER BY created_at LIMIT 1`; if (!t) throw new Error('no workspace'); return AuthService.resetAccess(tx, t.tenant_id as string); });
    console.log(`BLACKBOX_OWNER_KEY ${key}`);
  } else if (cmd === 'status') {
    const [info] = await db`SELECT app_version, schema_version, reducer_version, installed_at FROM release_info WHERE info_id = 1`;
    const [t] = await db`SELECT count(*)::int AS tenants FROM tenants`; const [j] = await db`SELECT count(*)::int AS entries FROM journal_entries`;
    console.log(JSON.stringify({ release: info ?? null, tenants: t?.tenants ?? 0, journal_entries: j?.entries ?? 0, migrations: latestMigrationVersion(migrationsDir) }));
  } else { console.error('usage: cli <migrate|setup|reset-access|status>'); process.exitCode = 2; }
} catch (err) { console.error('ERROR ' + (err as Error).message); process.exitCode = 1; } finally { await db.end({ timeout: 2 }); }

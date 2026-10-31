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
  } else if (cmd === 'fence') {
    const action = process.argv[3] ?? ''; const holder = process.argv[4] ?? 'unknown'; const ttl = process.argv[5] ?? '1800';
    if (action === 'acquire') { const rows = await db`UPDATE maintenance_fence SET holder = ${holder}, phase = 'held', acquired_at = now(), expires_at = now() + make_interval(secs => ${Number(ttl ?? 1800)}) WHERE fence_id = 1 AND (holder IS NULL OR expires_at < now() OR holder = ${holder}) RETURNING holder`; if (!rows.length) { console.error('fence held'); process.exitCode = 1; } else console.log(JSON.stringify({ fence: 'acquired', holder })); }
    else if (action === 'release') { await db`UPDATE maintenance_fence SET holder = NULL, phase = NULL, acquired_at = NULL, expires_at = NULL WHERE fence_id = 1 AND holder = ${holder}`; console.log(JSON.stringify({ fence: 'released' })); }
    else { const [f] = await db`SELECT holder, phase, acquired_at, expires_at FROM maintenance_fence WHERE fence_id = 1`; console.log(JSON.stringify(f)); }
  } else if (cmd === 'cutoffs') {
    const rows = await db`SELECT t.tenant_id, s.next_sequence - 1 AS committed, c.applied_sequence AS applied FROM tenants t JOIN tenant_sequences s ON s.tenant_id = t.tenant_id LEFT JOIN engine_checkpoints c ON c.tenant_id = t.tenant_id`;
    console.log(JSON.stringify(rows.map((r) => ({ tenant_id: r.tenant_id, committed: Number(r.committed), applied_checkpoint: r.applied === null ? null : Number(r.applied) }))));
  } else if (cmd === 'backup-config') {
    const dest = process.argv[process.argv.indexOf('--destination') + 1] ?? ''; const same = process.argv[process.argv.indexOf('--same-device') + 1] === 'true';
    const [t] = await db`SELECT tenant_id FROM tenants WHERE kind = 'workspace' ORDER BY created_at LIMIT 1`;
    await db`INSERT INTO settings (tenant_id, scope, key, value, updated_by) VALUES (${t!.tenant_id as string}, 'workspace', 'backup', ${db.json({ configured: true, destination_label: dest.split('/').slice(-2).join('/'), same_device: same, interval_hours: 24, keep_daily: 7, keep_weekly: 4, configured_at: new Date().toISOString() })}, 'wrapper') ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    await db`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${t!.tenant_id as string}, 'host', 'wrapper', 'backup.configured', ${db.json({ same_device: same })})`;
    console.log(JSON.stringify({ ok: true }));
  } else if (cmd === 'backup-record') {
    const action = process.argv[3] ?? ''; const a = (i: number) => process.argv[i] ?? '';
    if (action === 'start') { const kind = a(4), dest = a(5), file = a(6), cutoffs = a(7) || '[]'; const [g] = await db`INSERT INTO backup_generations (kind, state, destination, file_name, cutoffs) VALUES (${kind}, 'running', ${dest.split('/').slice(-2).join('/')}, ${file}, ${db.json(JSON.parse(cutoffs))}) RETURNING generation_id`; console.log(g!.generation_id as string); }
    else if (action === 'complete') { const id = a(4), sha = a(5), bytes = a(6); await db`UPDATE backup_generations SET state = 'complete', completed_at = now(), sha256 = ${sha}, size_bytes = ${Number(bytes)} WHERE generation_id = ${id}`; console.log(JSON.stringify({ ok: true })); }
    else if (action === 'fail') { const id = a(4), code = a(5); await db`UPDATE backup_generations SET state = 'failed', completed_at = now(), error_code = ${code} WHERE generation_id = ${id}`; console.log(JSON.stringify({ ok: true })); }
  } else if (cmd === 'backup-status') {
    const gens = await db`SELECT generation_id, kind, state, started_at, completed_at, size_bytes, sha256, file_name, destination, cutoffs FROM backup_generations ORDER BY started_at DESC LIMIT 20`;
    const [cfg] = await db`SELECT value FROM settings WHERE scope = 'workspace' AND key = 'backup' LIMIT 1`;
    console.log(JSON.stringify({ config: cfg?.value ?? { configured: false }, generations: gens }, null, 1));
  } else if (cmd === 'restore-fence') {
    // after an isolated restore: rotate owner key, revoke agents (resetAccess), pause provider connections, record audit
    const key = await db.begin(async (tx) => { const [t] = await tx`SELECT tenant_id FROM tenants WHERE kind = 'workspace' ORDER BY created_at LIMIT 1`; if (!t) throw new Error('no workspace in backup'); const k = await AuthService.resetAccess(tx, t.tenant_id as string); await tx`UPDATE connections SET status = 'paused', updated_at = now() WHERE provider IN ('shopify','shopify_payments') AND status = 'configured'`; await tx`INSERT INTO audit_events (tenant_id, actor_kind, actor_id, action, metadata) VALUES (${t.tenant_id as string}, 'host', 'wrapper', 'restore.fenced', ${tx.json({ providers_paused: true, agents_revoked: true })})`; await tx`UPDATE engine_checkpoints SET snapshot_path = NULL, snapshot_sha256 = NULL`; return k; });
    console.log(`BLACKBOX_OWNER_KEY ${key}`);
  } else if (cmd === 'verify-upgrade') {
    const [bad] = await db`SELECT count(*)::int AS n FROM journal_entries je WHERE NOT EXISTS (SELECT 1 FROM tenant_sequences s WHERE s.tenant_id = je.tenant_id AND s.next_sequence > je.journal_sequence)`;
    const [gaps] = await db`SELECT count(*)::int AS n FROM (SELECT tenant_id, journal_sequence, lag(journal_sequence) OVER (PARTITION BY tenant_id ORDER BY journal_sequence) AS prev FROM journal_entries) x WHERE prev IS NOT NULL AND journal_sequence <> prev + 1`;
    const [info] = await db`SELECT app_version, schema_version, reducer_version FROM release_info WHERE info_id = 1`;
    const ok = Number(bad!.n) === 0 && Number(gaps!.n) === 0;
    console.log(JSON.stringify({ ok, entries_beyond_hwm: Number(bad!.n), sequence_gaps: Number(gaps!.n), release: info }));
    if (!ok) process.exitCode = 1;
  } else { console.error('usage: cli <migrate|setup|reset-access|status|fence|cutoffs|backup-config|backup-record|backup-status|restore-fence|verify-upgrade>'); process.exitCode = 2; }
} catch (err) { console.error('ERROR ' + (err as Error).message); process.exitCode = 1; } finally { await db.end({ timeout: 2 }); }

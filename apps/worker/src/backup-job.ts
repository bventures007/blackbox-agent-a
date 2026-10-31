import { withScope } from '@blackbox/database';
import type { AppContext } from '@blackbox/application';
/**
 * The scheduler checks whether a backup is configured and due; actual creation runs through the host wrapper
 * (./blackbox backup) because it needs pg_dump and the host destination. The worker records the due state so the
 * UI shows "overdue" truthfully instead of pretending a backup ran.
 */
export async function runScheduledBackupCheck(ctx: AppContext): Promise<Date> {
  const cfg = await withScope(ctx.db, 'scheduler', async (tx) => (await tx`SELECT value FROM settings WHERE scope = 'workspace' AND key = 'backup' LIMIT 1`)[0]?.value as { configured?: boolean; interval_hours?: number } | undefined);
  if (!cfg?.configured) return new Date(Date.now() + 30 * 60_000);
  const last = await withScope(ctx.db, 'scheduler', async (tx) => (await tx`SELECT completed_at FROM backup_generations WHERE state = 'complete' ORDER BY completed_at DESC LIMIT 1`)[0]?.completed_at as string | undefined);
  const ageH = last ? (Date.now() - new Date(last).getTime()) / 3600_000 : Infinity;
  const interval = cfg.interval_hours ?? 24;
  if (ageH > interval) {
    // request one backup (coalesced): the wrapper's supervisor picks this request up; never a burst of missed intervals
    await withScope(ctx.db, 'scheduler', (tx) => tx`INSERT INTO settings (tenant_id, scope, key, value) VALUES ('00000000-0000-0000-0000-000000000000', 'installation', 'backup:request', ${tx.json({ requested_at: new Date().toISOString(), reason: ageH === Infinity ? 'no complete generation yet' : `last generation ${ageH.toFixed(1)} h old` })}) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
    ctx.log.warn('backup.overdue', 'scheduled backup is due and has not completed', { error_code: 'backup_overdue', retryable: true, action_code: 'run ./blackbox backup or start the backup supervisor' });
  }
  return new Date(Date.now() + 10 * 60_000);
}

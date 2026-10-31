import { randomUUID } from 'node:crypto';
import { withScope, type Db } from '@blackbox/database';

export interface Job { job_id: string; tenant_id: string | null; kind: string; payload: Record<string, unknown>; attempt: number; max_attempts: number; singleton_key: string | null }

/** PostgreSQL-backed leased job queue (ADR-006). Claims use SKIP LOCKED; retries back off with jitter. */
export class JobQueue {
  constructor(private readonly db: Db, private readonly owner: string = `worker-${randomUUID().slice(0, 8)}`) {}
  async enqueue(kind: string, payload: Record<string, unknown>, opts: { tenantId?: string | null; runAt?: Date; singletonKey?: string; maxAttempts?: number } = {}): Promise<string | null> {
    return withScope(this.db, 'scheduler', async (tx) => {
      const rows = await tx`INSERT INTO jobs (tenant_id, kind, singleton_key, payload, run_at, max_attempts) VALUES (${opts.tenantId ?? null}, ${kind}, ${opts.singletonKey ?? null}, ${tx.json(payload as never)}, ${opts.runAt ?? new Date()}, ${opts.maxAttempts ?? 10})
        ON CONFLICT (singleton_key) DO UPDATE SET run_at = LEAST(jobs.run_at, EXCLUDED.run_at), updated_at = now() WHERE jobs.state IN ('queued','running') RETURNING job_id`;
      return (rows[0]?.job_id as string | undefined) ?? null;
    });
  }
  async claim(kinds: string[], leaseSeconds = 120): Promise<Job | null> {
    return withScope(this.db, 'scheduler', async (tx) => {
      const rows = await tx`UPDATE jobs SET state = 'running', lease_until = now() + make_interval(secs => ${leaseSeconds}), lease_owner = ${this.owner}, attempt = attempt + 1, updated_at = now()
        WHERE job_id = (SELECT job_id FROM jobs WHERE kind = ANY(${kinds}) AND state IN ('queued','running') AND run_at <= now() AND (lease_until IS NULL OR lease_until < now()) ORDER BY run_at LIMIT 1 FOR UPDATE SKIP LOCKED)
        RETURNING job_id, tenant_id, kind, payload, attempt, max_attempts, singleton_key`;
      const r = rows[0]; if (!r) return null;
      return { job_id: r.job_id as string, tenant_id: (r.tenant_id as string | null) ?? null, kind: r.kind as string, payload: r.payload as Record<string, unknown>, attempt: Number(r.attempt), max_attempts: Number(r.max_attempts), singleton_key: (r.singleton_key as string | null) ?? null };
    });
  }
  async complete(jobId: string, rescheduleAt?: Date): Promise<void> {
    await withScope(this.db, 'scheduler', (tx) => rescheduleAt
      ? tx`UPDATE jobs SET state = 'queued', run_at = ${rescheduleAt}, lease_until = NULL, lease_owner = NULL, attempt = 0, last_error_code = NULL, updated_at = now() WHERE job_id = ${jobId}`
      : tx`UPDATE jobs SET state = 'done', lease_until = NULL, lease_owner = NULL, updated_at = now() WHERE job_id = ${jobId}`);
  }
  async fail(job: Job, errorCode: string, retryAfterMs?: number): Promise<{ dead: boolean; nextRunAt: Date | null }> {
    const dead = job.attempt >= job.max_attempts;
    const backoff = retryAfterMs ?? Math.min(3600_000, 1000 * 2 ** Math.min(job.attempt, 12)) * (0.8 + Math.random() * 0.4);
    const next = dead ? null : new Date(Date.now() + backoff);
    await withScope(this.db, 'scheduler', (tx) => dead
      ? tx`UPDATE jobs SET state = 'dead', last_error_code = ${errorCode}, lease_until = NULL, lease_owner = NULL, updated_at = now() WHERE job_id = ${job.job_id}`
      : tx`UPDATE jobs SET state = 'queued', run_at = ${next!}, last_error_code = ${errorCode}, lease_until = NULL, lease_owner = NULL, updated_at = now() WHERE job_id = ${job.job_id}`);
    return { dead, nextRunAt: next };
  }
  async heartbeat(component: string, detail: Record<string, unknown>): Promise<void> {
    await withScope(this.db, 'scheduler', (tx) => tx`INSERT INTO settings (tenant_id, scope, key, value, updated_at) VALUES ('00000000-0000-0000-0000-000000000000', 'installation', ${'heartbeat:' + component}, ${tx.json({ ...detail, at: new Date().toISOString(), owner: this.owner } as never)}, now()) ON CONFLICT (scope, key, tenant_id) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`);
  }
  async stats(): Promise<Record<string, unknown>> {
    return withScope(this.db, 'scheduler', async (tx) => {
      const rows = await tx`SELECT state, count(*)::int AS n, min(run_at) FILTER (WHERE state IN ('queued','running')) AS oldest FROM jobs GROUP BY state`;
      const out: Record<string, unknown> = { queued: 0, running: 0, done: 0, failed: 0, dead: 0, oldest_pending_at: null };
      for (const r of rows) { out[r.state as string] = Number(r.n); if (r.oldest && (r.state === 'queued' || r.state === 'running')) out.oldest_pending_at = new Date(r.oldest as string).toISOString(); }
      return out;
    });
  }
}

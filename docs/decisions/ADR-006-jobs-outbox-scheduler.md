# ADR-006 PostgreSQL-backed leased jobs instead of pg-boss

**Status:** accepted 2026-10-31 (P0).

The worker uses a small `jobs` table (`job_id`, `tenant_id`, `kind`, `payload`, `run_at`, `lease_until`, `lease_owner`, `attempt`, `max_attempts`, `state`, `last_error_code`) claimed with `UPDATE ... WHERE lease_until < now() ... FOR UPDATE SKIP LOCKED`. Retries use exponential backoff with jitter and honour `Retry-After`. The same table drives import runs, polls, reconciliation, backups and retention.

pg-boss was preferred by the brief; it adds its own schema, maintenance jobs and a large dependency surface, while the pilot needs explicit per-connection leases/fencing (SOURCE-SYNCHRONIZATION step 7) and tenant fairness that are easier to prove in ~200 lines of reviewed SQL. The outbox for engine dispatch is the journal itself plus `tenant_sequences` (ADR-002): the engine's applied cursor is the durable dispatch state, so no separate outbox dispatcher can double-apply.

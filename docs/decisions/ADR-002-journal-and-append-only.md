# ADR-002 Journal layout, ordering and database-enforced append-only

**Status:** accepted 2026-10-31 (P0); validated by JOURNAL-01/02 and MCP-05 tests.

## Layout

- `journal_entries`: `entry_id uuid`, `tenant_id uuid`, `journal_sequence bigint` (tenant-scoped, gap-free), `record_type` (source|fact|commitment|movement|reservation), `record_id`, `event_type`, `schema_version`, `connection_id`, `provider_namespace`, `dedup_key` (unique per tenant), `occurred_at`, `recorded_at` (server clock at commit), `payload jsonb` (typed, integer minor units, explicit quantity units), `evidence_refs jsonb`, `input_entry_ids uuid[]`, `rule_version`, `supersedes_entry_id`, `correlation_id`, `causation_id`, `payload_hash`.
- `journal_entity_links`: `(tenant_id, entity_type, entity_id, journal_sequence, entry_id)` — the entity-to-history locator used for cold hydration. Immutable.
- `journal_evidence`: opaque evidence references (`evidence_id`, object key, sha256, size, media type, retention class, redaction state is kept in a separate mutable ledger table).
- Mutable operational tables (`tenants`, `owners`, `credentials`, `sessions`, `connections`, `import_plans`, `import_runs`, `jobs`, `engine_checkpoints`, `review_cases`, `redaction_ledger`, `audit_events`) are separate and never hold the only copy of a business change.

## Ordering

`journal_sequence` is allocated inside the append transaction after `SELECT ... FOR UPDATE` on the tenant's `tenant_sequences` row. This serializes appends per tenant, so a lower sequence can never commit after a higher one has been observed: a reader's committed high-water mark is a true snapshot boundary. Throughput is bounded per tenant, which is acceptable for the pilot (measured in PILOT-09); cross-tenant appends do not contend.

## Append-only enforcement

- Tables are owned by `bbx_migrator`. Runtime roles `bbx_api`, `bbx_worker`, `bbx_engine` are `NOSUPERUSER NOBYPASSRLS`, receive `SELECT, INSERT` only on journal tables and have no `UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER`.
- Defensive triggers `journal_reject_mutation` raise on UPDATE/DELETE (row) and TRUNCATE (statement) regardless of role. No foreign key points into journal tables with `ON DELETE CASCADE`; journal rows reference tenants with `ON DELETE RESTRICT`.
- RLS: `tenant_id = current_setting('app.tenant_id')::uuid` for `bbx_api` and `bbx_worker` on every tenant-scoped table (SELECT and INSERT with CHECK). The engine role may read all tenants' journal rows (it is the internal projection builder) but cannot mutate them; its appends (derived entries) are checked against the same tenant policy. Connection pools reset `app.tenant_id` via `SET LOCAL` inside each transaction so pooled sessions cannot leak scope.
- Same `dedup_key` with a different `payload_hash` is rejected by the append service and recorded as a `conflict` review case instead of replacing the original.

The host administrator and `bbx_migrator` remain outside this boundary; no WORM/tamper-proof claim is made.

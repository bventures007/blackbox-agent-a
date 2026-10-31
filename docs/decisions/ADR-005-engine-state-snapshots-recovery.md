# ADR-005 Reducers, derivation, bounded RAM, snapshots and recovery

**Status:** accepted 2026-10-31 (P0); validated by DOMAIN-*, INGEST-03, LOCAL-09, SLICE-01.

## Flow

1. Workers/API append **Source** entries only (provider observations, replay/generic/bank/policy inputs) through the tenant-validated append service, with the outbox row written in the same transaction.
2. The engine polls each tenant's journal from its applied cursor (NOTIFY is a wake-up hint only). For a Source entry it runs the versioned **derivation rules** (`crates/domain::derive`) producing Fact/Commitment/Movement/Reservation entries, appended in one transaction with `input_entry_ids`, `rule_version` and `dedup_key = derived:<source_entry_id>:<rule_version>:<ordinal>`. Idempotent: a repeated derivation hits the unique key and is skipped.
3. Derived entries are folded into per-entity projections (`crates/projections`) and tenant indexes. Each processed batch publishes a new immutable state snapshot (`Arc` swap) together with its applied cursor; readers never see a cursor ahead of the balances it belongs to.
4. Every N entries or T seconds the engine writes a versioned snapshot file (`/data/engine/<tenant>/<cursor>.snap`, serde + sha256) and the `engine_checkpoints` row. Snapshots are rebuildable acceleration, never the only copy of state.

Derived entries are applied but never re-derived, so there are no derivation loops; superseding derivations (new `rule_version`) are appended explicitly during a fenced rebuild (PILOT-03).

## Bounded RAM and cold reads

Entity states are kept in a per-tenant LRU bounded by configured bytes (`ENGINE_TENANT_BUDGET_MIB`, default 64) and a global budget. Index keys (open orders, unpaid invoices, unmatched payouts, active holds, …) stay resident. An evicted entity is rehydrated by replaying its own derived history from `journal_entity_links` (indexed by `(tenant_id, entity_type, entity_id, journal_sequence)`), never by scanning the journal. Hydration is bounded per query and measured as `cold_hydrations`.

## Recovery

On start the engine loads the newest compatible snapshot (same `reducer_version`, `schema_version`, sha256 match) and applies the committed tail; an incompatible, missing or corrupt snapshot triggers a rebuild from sequence 0 for that tenant while other tenants serve. Readiness is per tenant and reports `rebuilding`/`catching_up`/`current`.

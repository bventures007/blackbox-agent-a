# Architecture (as implemented)

See `docs/decisions/` for the ADRs. This page follows the running code.

```
browser (React/Vite, EN/DE) ──┐                      ┌─ apps/worker (TS): Shopify polling/import, jobs, coverage, heartbeat
                              ├─ apps/api (Fastify) ─┤
MCP client ─ apps/mcp-bridge ─┘   auth · ingest ·    └─ apps/engine (Rust/axum): derive → fold → publish, snapshots, queries
                                  query · diagnostics          │
                                      │                        │
                                      └──── PostgreSQL 17 ─────┘   append-only journal, RLS roles, jobs, identity, checkpoints
```

## Write path

1. Adapter (TS) validates a typed observation (`packages/contracts` zod payloads), computes entity refs and a provider-scoped dedup key.
2. `IngestService` appends Source entries through `journal_append(tenant, entries)` inside a tenant-scoped transaction. The function serializes per tenant (`tenant_sequences` row lock), rejects same-identity/different-content with `BBX02` (→ review case), and NOTIFYs.
3. The engine polls `journal_entries` past its applied cursor, derives Fact/Commitment/Movement/Reservation entries (`crates/domain::derive`, rule `r1`), appends them through the same function with `input_entry_ids`, folds derived entries into per-entity projections (`crates/domain::state`) and tenant indexes (`crates/projections`), then publishes the applied cursor.
4. Every N entries / T seconds the engine writes a sha256-verified snapshot and an `engine_checkpoints` row. Recovery loads a compatible snapshot and applies the tail; otherwise it rebuilds from sequence 0.

## Read path

API/MCP → `QueryService` resolves consistency (`latest_committed` reads the tenant high-water mark) → engine `/query` waits for `applied ≥ required` (else `projection_behind`) → `crates/query` runs the intent over resident projections, hydrating evicted entities from `journal_entity_links` on demand → envelope with status, calculation, evidence ids, coverage (from `coverage.observed` runtime facts), missing inputs, cursors → API overlays source readiness.

Journal traversal (`list/get/history/search/evidence`) is served from PostgreSQL with a stable snapshot cursor; evidence access checks the redaction ledger first.

## Boundaries

- Roles: `bbx_migrator` owns tables; `bbx_api`/`bbx_worker`/`bbx_engine` have SELECT/INSERT on journal tables only, RLS by `app.tenant_id` set with `SET LOCAL`. Triggers reject UPDATE/DELETE/TRUNCATE for everyone.
- Authentication: owner key → session cookie; agent/producer keys → principals; the engine is reachable only on the Compose network with a shared token.
- Logs: one JSON record schema across wrapper/api/worker/engine/mcp, hour-segmented files on the `logs` volume, bounded buffers, 7 days / 100 MiB retention; the CLI reads the same files without the API.

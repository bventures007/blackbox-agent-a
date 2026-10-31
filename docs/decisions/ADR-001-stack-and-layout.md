# ADR-001 Stack, workspace layout and dependency direction

**Status:** accepted 2026-10-31 (P0).

## Decision

- TypeScript (pnpm workspace, Node 22 LTS in containers) for UI, API/auth, connector worker and MCP bridge. React 18 + Vite for `apps/web`; a separately servable static landing in `apps/landing`; Fastify 5 for `apps/api`; `@modelcontextprotocol/sdk` stdio server in `apps/mcp-bridge`.
- Rust (Cargo workspace) for the canonical business engine: `crates/domain` (pure deterministic reducers and money/quantity rules), `crates/projections` (per-entity projections, indexes, bounded summaries), `crates/query` (the 24 intents and composable business queries), `crates/storage` (PostgreSQL journal reader/appender, checkpoints, snapshots), `apps/engine` (axum service).
- PostgreSQL 17 is the only durable store: append-only journal, outbox/jobs, identity/session/operational state, checkpoints and indexed cold history. Evidence objects live on a local persistent volume behind an `ObjectStore` interface.
- Shared packages: `packages/contracts` (zod schemas and generated JSON fixtures shared with Rust conformance tests), `packages/database` (reviewed SQL migrations, roles, migration runner, typed query helpers), `packages/logging` (shared log record), `packages/i18n` (EN/DE resources), `packages/application` (authorization, services, connectors, diagnostics, import plans).
- Dependency direction: `crates/domain` and `packages/contracts` depend on nothing internal; `packages/application` depends on contracts/database/logging; `apps/*` depend on packages. React components and Fastify routes contain no money/stock calculations.

## Deviations from the brief

- Drizzle ORM is not used. Reviewed, versioned SQL migrations (`packages/database/migrations/*.sql`) plus a small typed query layer over `postgres` (postgres.js) give exact control over roles, RLS policies and triggers, which the journal contract requires anyway. Evidence: the JOURNAL-01 role tests run against the exact migration SQL.
- No pg-boss (see ADR-006).

## Alternatives considered

- Whole-product Rust: rejected, the brief keeps orchestration/auth/UI in TypeScript.
- TypeScript-only reducers: rejected by the performance contract (single canonical Rust implementation).

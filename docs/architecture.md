# Implementation architecture

Baseline: baseline-v14 resolves to 629da21ce922b110cfeb7e3c7a3f543912826a73.

TypeScript adapters validate provider syntax and stage typed observations. PostgreSQL
serializes each tenant's sequence allocation in the same transaction as the journal,
immutable links and outbox. Runtime identities do not own tables and have forced RLS.
Rust owns canonical financial and quantity interpretation, durable projections and
bounded memory. API and SDK MCP share current authorization and the engine service.

## ADR 001 — minimum runtime

Use Fastify, React/Vite, official MCP TypeScript SDK, pg/Drizzle and PostgreSQL 17.
Rust uses Axum, Tokio and SQLx with a versioned authenticated private HTTP boundary.
The first worker uses a PostgreSQL outbox with transaction locks, bounded batches and
durable retry state. This narrowly scoped queue avoids a second scheduler authority;
pg-boss is preferred by the brief, not required. No external queue is introduced.

Use Node's maintained crypto CSPRNG, SHA-256 verifiers for 256-bit random bearer keys,
timing-safe comparison, opaque database sessions and AES-256-GCM for protected
content with tenant/purpose/key-version authenticated data. These are standard
primitives, not a custom authentication protocol. Host access is a separate trust
boundary. Backups will use a maintained recipient encryption format.

## Module contracts

- `packages/contracts`: validated wire types; no financial arithmetic.
- `packages/database`: transaction-local RLS scope, migrations, immutable ingestion.
- `packages/auth`: credential purposes, revocation and sessions.
- `packages/connectors`: provider HTTP transport and normalization; no balance logic.
- `crates/domain`: pure canonical reducers and rule versions.
- `apps/engine`: private authenticated queries, durable checkpoints and bounded cache.
- `apps/api`: owner/session authority and shared authorized business services.
- `apps/worker`: outbound scheduling and durable outbox dispatch.
- `packages/mcp`: SDK stdio bridge; stdout contains protocol messages only.

Only 127.0.0.1:18741 is published by the development Compose project. Engine and
PostgreSQL remain private. Each installation creates fresh credentials. No alternate
repository or shared data volume is used. Development fixtures contain synthetic data.

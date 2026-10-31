# ADR-004 TypeScript/Rust internal RPC and shared contracts

**Status:** accepted 2026-10-31 (P0).

- The engine exposes HTTP/JSON (axum 0.7) on the internal Compose network only (`engine:7000`, not published). Every request carries `X-Engine-Token` (shared secret generated at setup, mounted from the secret directory) and a `tenant_id` validated by the API's authorization layer before the call. Request bodies are limited to 1 MiB; queries carry a deadline.
- Shared wire schemas live in `packages/contracts` as zod schemas; `packages/contracts/fixtures/*.json` are checked by both `vitest` (TypeScript) and a Rust conformance test (`crates/query/tests/contracts.rs`) so both sides agree on field names, units and status enums.
- Consistency: query requests specify `consistency: {mode: "latest_committed" | "at_least_cursor" | "as_of", cursor?, effective_at?, recorded_at?}`. The API reads the tenant's committed high-water mark (one indexed read) for `latest_committed` and passes it as `required_cursor`; the engine waits up to the deadline (default 1.5 s) for `applied_cursor >= required_cursor`, otherwise returns `projection_behind` with both cursors.
- Alternatives: gRPC/tonic (more tooling for little pilot benefit); Unix sockets (not portable across Compose services).

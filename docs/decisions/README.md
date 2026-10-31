# Architecture decisions

Short numbered ADRs for material local-pilot choices. Each records the decision, alternatives and the evidence that validated it. The active scope is delivery-profile.json and specs/LOCAL-PILOT.md; deferred options (Passkeys, OIDC, public MCP OAuth, native packaging, distributed hosting, gateways) are not designed here.

| ADR | Decision |
| --- | --- |
| [ADR-001](ADR-001-stack-and-layout.md) | Stack, workspace layout, dependency direction |
| [ADR-002](ADR-002-journal-and-append-only.md) | Journal SQL layout, tenant-serialized sequence, database-enforced append-only, RLS roles |
| [ADR-003](ADR-003-identity-sessions-reset.md) | Owner access key verifier, sessions, agent keys, host-only reset |
| [ADR-004](ADR-004-engine-rpc-and-contracts.md) | TypeScript/Rust internal RPC and shared contracts |
| [ADR-005](ADR-005-engine-state-snapshots-recovery.md) | Reducer/derivation model, bounded RAM, snapshots, cold hydration, recovery |
| [ADR-006](ADR-006-jobs-outbox-scheduler.md) | PostgreSQL-backed leased jobs instead of pg-boss |
| [ADR-007](ADR-007-local-packaging-distribution.md) | Wrapper, Compose release, versioned archive and image distribution |
| [ADR-008](ADR-008-secrets-encryption-backups.md) | Installation data key, authenticated encryption, backup envelope |
| [ADR-009](ADR-009-logging-and-diagnostics.md) | Shared structured log record, bounded local files, outage CLI |
| [ADR-010](ADR-010-shopify-authorization.md) | Shopify authorization path, API version and polling coverage |

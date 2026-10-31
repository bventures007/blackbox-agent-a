# Architecture decisions

Create short numbered ADRs for material local-pilot choices: personal access-key verifier/session/reset behavior, tenant/RLS context, event ordering/outbox/idempotency, Rust/TypeScript contracts, bounded RAM/cold indexes, snapshot recovery, local packaging/prerequisites, provider authorization/polling coverage and measured performance. Record alternatives and actual evidence.

The active scope is delivery-profile.json and specs/LOCAL-PILOT.md. Passkeys, email/OIDC login, public MCP OAuth, native packaging, distributed hosting and gateways are deferred options; do not spend the pilot implementing or exhaustively designing them. Preserve clear module boundaries and record future questions briefly for feedback-driven decisions.

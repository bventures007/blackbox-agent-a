# Local pilot implementation status

Baseline-v14, P0–P4 scope. Work is confined to this repository and isolated resources. No competing implementation was inspected.

P0 is implemented: environment, SQL/auth/RPC decisions and genuine Shopify authorization prerequisites were recorded; implementation is underway. P1's synthetic persisted SLICE-01 passed at `dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127`. The complete P1 local installation/operations contract remains under development.

Verified: actual HTTP adapter pagination, durable PostgreSQL source/outbox and derived tracks, Rust payment state, API/UI/MCP, full restart, missing/corrupt projection cold recovery, fixed cutoffs, late revisions, duplicates/content conflicts, refunds/missing payments, tenant isolation, agent revocation and basic offline diagnostics. Evidence lives in reports/runs/p1-dd0998e. No live Shopify or full product acceptance is implied.

Next implementation: Golden Scenario and generalized typed inputs/reducers, then all 24 structured questions, source/readiness operations and the reference EN/DE interface. P3/P4 package, backup/restore/upgrade, performance and independent review remain open. The supplied baseline contracts and reference assets are unchanged.

External blockers: no authorized Shopify/Payments credentials; Compose containers remain created on this Mac despite successful image builds. The native developer runtime is isolated and real, but is not DIST proof. Independent reviewer approval has not been obtained or self-issued.

Historical specification/preparation status is preserved in Git and docs/history. Current evidence, not seed prose, determines progress. See reports/checkpoint.md and reports/acceptance.json. Stop only at the P4 handover; deferred SaaS/gateway/native scope remains unstarted.

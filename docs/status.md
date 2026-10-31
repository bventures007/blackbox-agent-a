# Local pilot implementation status

Baseline-v14, P0–P4 scope. Work is confined to this repository and isolated resources. No competing implementation was inspected.

P0 is implemented: environment, SQL/auth/RPC decisions and genuine Shopify authorization prerequisites were recorded; implementation is underway. P1's synthetic persisted SLICE-01 passed at `dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127`. The complete P1 local installation/operations contract remains under development.

Verified: actual HTTP adapter pagination, durable PostgreSQL source/outbox and derived tracks, Rust payment state, API/UI/MCP, full restart, missing/corrupt projection cold recovery, fixed cutoffs, late revisions, duplicates/content conflicts, refunds/missing payments, tenant isolation, agent revocation and basic offline diagnostics. Evidence lives in reports/runs/p1-dd0998e. No live Shopify or full product acceptance is implied.

Next implementation: Golden Scenario and generalized typed inputs/reducers, then all 24 structured questions, source/readiness operations and the reference EN/DE interface. P3/P4 package, backup/restore/upgrade, performance and independent review remain open. The supplied baseline contracts and reference assets are unchanged.

External blockers: no authorized Shopify/Payments credentials; Compose containers remain created on this Mac despite successful image builds. The native developer runtime is isolated and real, but is not DIST proof. Independent reviewer approval has not been obtained or self-issued.

Historical specification/preparation status is preserved in Git and docs/history. Current evidence, not seed prose, determines progress. See reports/checkpoint.md and reports/acceptance.json. Stop only at the P4 handover; deferred SaaS/gateway/native scope remains unstarted.

## Golden lifecycle checkpoint

At `2e8094402f642e534e432fb386e966912023b69c`, all Golden checkpoints and a varied USD/quantity scenario passed through signed HTTP ingestion and the persisted Rust/API/MCP path, including repeated empty-projection recovery. DOMAIN-01–03 now have executed evidence. Remaining question, source lifecycle, units/conflict, UI and release gates are still open. See reports/runs/golden-2e80944/result.json.

## All 24 structured questions

At `3ced26bb56543703e1d05e8719e35f2d537f2b45`, all 24 positive and missing-data cases and all 24 changed USD/fractional-quantity variants passed through signed ingestion, PostgreSQL, Rust, API and MCP. Late corrections, out-of-order snapshots, duplicate delivery, fixed-cutoff pagination, full restart and corrupted/deleted projection recovery passed; all 24 cross-tenant evidence denials, warmed credential revocation and principal-bound cursors passed. Golden and first-slice persisted regressions passed at the same clean revision. See reports/runs/questions-3ced26b. No live provider, performance or independent review is implied. React/Vite EN/DE interface implementation is next.

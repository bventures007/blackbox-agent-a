# Local pilot implementation status

## Current assignment

Baseline-v12 / brief 2.1: P0–P4 local pilot, then handover and stop. The owner approved a personal saved access key and local testing before deciding later product/hosting scope. Passkeys, invitations, public SaaS/servers, gateways, native packaging and large capacity certification are deferred. Read delivery-profile.json and specs/LOCAL-PILOT.md.

Product implementation has not started. The prototype is static/simulated. No production login, importer, database/engine, local MCP bridge or installer exists yet. All 105 acceptance records remain not_started: 68 active pilot cases and 37 deferred cases. The exact previous 86 case descriptions remain preserved; 11 local cases define the simpler delivery and eight DIAG cases make operational visibility a required part of it. No diagnostics implementation exists yet.

## Milestones

- [ ] P0 — environment and minimal contracts; start implementation
- [ ] P1 — local key/session, automatic owner/workspace and persisted Rust/journal slice, structured logging and CLI fallback
- [ ] P2 — Golden Scenario, all 24 query contracts, UI/locales, import/readiness, System & Diagnostics and restart
- [ ] P3 — Shopify/Shopify Payments and supplemental producers; local agent keys/MCP
- [ ] P4 — real Mac install, local performance/memory, backup/restore/upgrade, DIAG-01–08 evidence, feedback guide and handover

## Preserved foundation

Keep the append-only five-track journal, exact Rust business reducers, durable PostgreSQL/outbox, bounded RAM/cold reads, tenant/RLS boundaries, snapshots/replay and provenance. All 24 questions need positive/missing-data evidence. Keep 30-day plus disclosed open/related import defaults, exact date plans, real progress and central source/answer readiness. EN-default/full-DE UI and landing page and all English engineering content remain required.

The visual reference is unchanged: 67 desktop/mobile captures plus original assets. The catalogue remains 24 questions, 26 datasets, 11 tenant-scoped projections and 22 source/internal producers. All 127 integration rows remain; the profile selects 68 current rows and preserves all existing work history. Legacy first_release labels are broader platform plans, not current pilot gates. All rows remain unassigned/unimplemented; no provider or customer account has been used.

## Next action and prerequisites

Read START-HERE.md, AGENTS.md and the local contract, inspect the prototype and record actual tools/resources in build-environment.md. Begin P1 after the minimum P0 decisions. Synthetic work needs no merchant or LLM credentials. Later verify Shopify/Shopify Payments API grants/installation/account access, an actual compatible local MCP client and a real Apple Silicon install. Missing prerequisites are blocked proof, never success; complete unrelated work.

## Evidence policy

Keep reports/acceptance.json, question-coverage.json, performance.json and source history current with actual code commits, commands, environment and artifacts. Ordinary validators check preparation consistency only; the profile --release gate checks current evidence/selected independent approvals. No checker independently proves execution truth. Deferred requirements are not passed or automatic next work. Preserve the P4 comparison commit/report and stop for owner feedback.

Previous preparation findings and decisions are preserved in docs/history/baseline-v10-status.md, docs/history/baseline-v11-status.md and older Git tags. They describe the prior assignment, not current obligations.

## Diagnostics addition for baseline-v12

The owner approved a central System & Diagnostics view with source/run links, measured/stale health, common correlated structured logs, filters/live/history, local setup/outage access, bounded seven-day/100-MiB technical retention, 15-minute scoped debug and explicit sanitized export. The new specification defines permissions, redaction, failure behavior, performance bounds and P1–P4 implementation order. DIAG-01–08 are selected release gates; reports remain not_started. Start/Goal/build/review instructions include the new contract. Source capability selection, all previous acceptance semantics, journal/data contracts, integration history and visual references are unchanged.

The question catalogue validator, integration register check against 8d67454b4a8fd3556312bf5160ecbb0655ab0e13, delivery-profile validator and all 45 existing tooling regression tests passed. An additional consistency check confirms all 97 previous acceptance cases are byte-equivalent as parsed records, all 105 results remain not_started, and integration history/source selection, golden data and visual assets are unchanged. These checks verify specification/control consistency only; no runtime, diagnostic feature or product result is claimed.

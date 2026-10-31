# Implementation status

## Current state

Repository preparation is complete. Product implementation has not started. The source snapshot is a static prototype with simulated data. No production or provider acceptance case has run.

## Milestones

- [ ] M0 — product/architecture contract, ADRs, threat model, acceptance mapping
- [ ] M1 — authentication, tenant isolation, database-enforced append-only journal, persistence, ingestion, core UI
- [ ] M2 — Golden Scenario, replay/restart, English/German UI and landing page
- [ ] M3 — real MCP with full authorized journal/history reads, structured queries and 24 shared query contracts
- [ ] Comparison checkpoint — M0–M3 plus local installation and report
- [ ] M4 — first real connector adapters and capability verification
- [ ] M5 — Mac local/remote client, public webhook gateway, deployment migration, release profiles and operation evidence

## Latest verification

Seed preparation only: JSON parsing, reference checksums, requirement counts and matching repository baseline. This is not evidence of a working product. All cases in ../reports/acceptance.json start as not_started.

The visual reference now includes 67 captures (58 desktop, nine mobile), with an English index and reproducible routes/interactions in reference/screenshots/. The capture run completed without page-script errors; all images were inspected in contact sheets and selected full-size views. Both reference fonts loaded in every capture and no document-level horizontal overflow was observed at the two capture sizes. The journal/recorder can still scroll horizontally within their own regions on mobile. Static prototype assets remain unchanged; no product acceptance case has run.

## Language clarification

All engineering material is English. The UI and landing page default to English and also support complete German localization. Architecture and question specifications are now English; original German visual references are retained. See README.md for the full policy.

## Journal and MCP clarification

The binding contract is specs/JOURNAL-AND-MCP.md. Runtime roles must be unable to update/delete/truncate canonical journal data. MCP covers all authorized business records and histories, beyond the 24 example questions. Journal/MCP coverage has four dedicated core acceptance cases. These are requirements, not implemented or executed capabilities.

## Performance clarification

Implement the Rust business/query engine with bounded hot state and durable journal/checkpoint recovery as specified in specs/PERFORMANCE-ARCHITECTURE.md. The benchmark contract defines 250k, 10m and 100m profiles with explicit scopes. No performance or memory target has been measured. Maintain reports/performance.json. The full acceptance register now contains 67 cases.

## Question-data audit

The initial question catalogue and common architecture are now joined by specs/QUESTION-DATA-COVERAGE.md and specs/question-data-contracts.json: 24 intents, 26 required input datasets, 11 logical Rust projections, source-field candidates, 24 positive plus 24 missing-data examples, and extra edge cases. Public Shopify, easybill and DHL documentation was reviewed; no merchant credentials or live business API calls were used. Nine questions have documented launch-provider candidate paths, eleven need supplementary business context, three retain provider-detail gaps and one specifically requires bank import (bank evidence also contributes to the full money overview). These are data-dependency categories, not measured readiness. Actual SQL, adapters, reducers, indexes and executable fixtures remain unimplemented; reports/question-coverage.json tracks the open proof. DHL retention/use conditions must be resolved before perpetual live tracking ingestion.

Catalogue consistency check: `python3 scripts/validate-question-catalogue.py` passed for all 24 original questions, 48 minimum case descriptions, 26 datasets, 11 tenant-scoped projections and 22 source/internal-producer entries. This checks specification references, not product behavior.

## Central integration register

INTEGRATIONS.md now provides the central source/capability work list: 22 sources/internal producers and 127 rows, including 72 first-release/internal work rows and 55 unreviewed roadmap rows. It maps each row to the five applicable tracks and canonical inputs, PostgreSQL events, Rust projections and question contracts. All rows are unassigned and not started; no connector, provider account or product acceptance test has run.

The register uses append-only actor/timestamp/evidence history, a generated overview, exact code/artifact hashes and independent confirmation. The supplied GitHub Actions workflow checks consistency, history and the validator regression tests. At baseline v7, local register/crosswalk checks and 19 synthetic control tests passed; these are tooling tests only. REGISTRY-01 is the new full-release acceptance gate and remains not_started. Repository branch protection has not been changed.

## Next action

Read START-HERE.md and the full brief. Inspect the prototype and environment. Record capabilities in build-environment.md, create the product/architecture/ADR documents, and begin M1 after the minimum M0 decisions.

## External prerequisites

No credentials are required for the initial synthetic build. Later verify Shopify/Shopify Payments scopes/account access, easybill API access and DHL API/product eligibility. Record access and limitations per capability. Verify actual available Docker, Mac/Linux and MCP-client environments before claiming platform coverage.

## Update after each meaningful checkpoint

Record: current task; files/commit; actual start/test commands; observed results; open failures; external blockers; next concrete action. Keep the complete per-case execution record in ../reports/acceptance.json.

## Web/desktop and synchronization update (baseline v8)

The binding contract now includes complete browser management, a required additional Mac desktop client, one backend journal per workspace, three explicit connectivity modes, an optional-use public gateway, resumable source synchronization, truthful receipt/freshness states and fenced workspace migration. The full acceptance contract contains 67 cases (14 added); every product case remains not_started. Native packaging and gateway work belong to M5 and do not silently expand the earlier comparison checkpoint.

All 127 integration rows now carry mode investigation obligations, with append-only preparation records. Implemented mappings and tests must account for all three modes; no provider support or live connectivity has been certified. The generated human register exposes this distinction. Public hosting/DNS, provider access and real Mac/distribution verification remain explicit external prerequisites. Preparation checks passed: question-catalogue validator; integration-register check against the full baseline-v7 commit (including preserved history and generated view); 30 synthetic register-control regression tests; JSON/reference/count checks and git diff --check. These checks validate repository preparation, not product behavior. The --release register gate remains intentionally blocked because no connector capability has been implemented.

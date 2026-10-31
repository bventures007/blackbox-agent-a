# Local pilot implementation status

Baseline-v14, P0–P4 scope. Work is confined to this repository and isolated resources. No competing implementation was inspected.

P0 is implemented: environment, SQL/auth/RPC decisions and genuine Shopify authorization prerequisites were recorded; implementation is underway. P1's synthetic persisted SLICE-01 passed at `dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127`. The complete P1 local installation/operations contract remains under development.

Verified: actual HTTP adapter pagination, durable PostgreSQL source/outbox and derived tracks, Rust payment state, API/UI/MCP, full restart, missing/corrupt projection cold recovery, fixed cutoffs, late revisions, duplicates/content conflicts, refunds/missing payments, tenant isolation, agent revocation and basic offline diagnostics. Evidence lives in reports/runs/p1-dd0998e. No live Shopify or full product acceptance is implied.

Current work: selected source/readiness operations and review/repair, followed by package, backup/restore/upgrade and operational validation. Golden, all 24 typed questions and the initial EN/DE React interface have executed checkpoints below. P3/P4 package, backup/restore/upgrade, performance and independent review remain open. The supplied baseline contracts and reference assets are unchanged.

External blockers: no authorized Shopify/Payments credentials; Compose containers remain created on this Mac despite successful image builds. The native developer runtime is isolated and real, but is not DIST proof. Independent reviewer approval has not been obtained or self-issued.

Historical specification/preparation status is preserved in Git and docs/history. Current evidence, not seed prose, determines progress. See reports/checkpoint.md and reports/acceptance.json. Stop only at the P4 handover; deferred SaaS/gateway/native scope remains unstarted.

## Golden lifecycle checkpoint

At `2e8094402f642e534e432fb386e966912023b69c`, all Golden checkpoints and a varied USD/quantity scenario passed through signed HTTP ingestion and the persisted Rust/API/MCP path, including repeated empty-projection recovery. DOMAIN-01–03 now have executed evidence. Remaining question, source lifecycle, units/conflict, UI and release gates are still open. See reports/runs/golden-2e80944/result.json.

## All 24 structured questions

At `3ced26bb56543703e1d05e8719e35f2d537f2b45`, all 24 positive and missing-data cases and all 24 changed USD/fractional-quantity variants passed through signed ingestion, PostgreSQL, Rust, API and MCP. Late corrections, out-of-order snapshots, duplicate delivery, fixed-cutoff pagination, full restart and corrupted/deleted projection recovery passed; all 24 cross-tenant evidence denials, warmed credential revocation and principal-bound cursors passed. Golden and first-slice persisted regressions passed at the same clean revision. See reports/runs/questions-3ced26b. No live provider, performance or independent review is implied. React/Vite EN/DE interface implementation is next.

## React browser increment

At `fcd72d055ab9211369decc96c2c7cbb0e04e915a`, the reference-styled React/Vite interface passed all 24 template/API-result comparisons in English and German, persisted evidence access, bundled example ingestion, agent creation/revocation, owner endpoint/CSRF/tenant/cursor denials, explicit sanitized diagnostic export, no browser exceptions or external network requests, German mobile navigation and logout. Existing P1 browser checks and the actual official MCP Inspector client passed. See reports/runs/ui-fcd72d0/result.json and screenshots. Source lifecycle/onboarding, repairs, complete diagnostics, backup/restore/upgrade, release packaging and performance remain open. No full UI/DIAG/PILOT acceptance has been marked passed.

## Settlement scope correction

At `4e9edcffbfd6716d568cd618e69feea8f7beea5f`, questions-v2 passed the full 24 positive/missing/varied suite plus five new persisted scope adversaries, including restart and corrupted/deleted projections. Shared-capture refunds are subtracted once; unrelated receipts cannot close a cancellation; unknown refund populations remain unknown; impossible reversals/releases produce conflicts. Golden and first-slice regressions passed. See reports/runs/questions-4e9edcf. The 45 preparation regression tests and ordinary profile/catalogue/register validators also pass; none substitute for remaining release gates.

## Durable source operations increment

Implemented fixed import plans, protected Shopify credentials, account-bound reconnect, fenced/resumable initial/delta/reconciliation jobs and EN/DE source onboarding for orders/payments/refunds. Synthetic pre-commit checks exercised PostgreSQL/Rust/API, actual SDK MCP and a real process restart, plus desktop/mobile browser scope controls. Visual QA exposed and fixed a late-readiness form overwrite; a regression assertion now preserves the selected preset. Clean committed reproduction is the next evidence step. See docs/contracts/source-operations.md. Other selected Shopify/Payments adapters, complete shared answer health, review/repair and P4 operational/delivery/performance gates remain active work. No additional product acceptance or independent review is approved.

Clean a5fc0f82c15729ff3a30ca7317a72c494790412d passed the scheduled-source subset (HTTP/PostgreSQL/Rust/API/SDK MCP, restart, EN/DE Chrome and real background worker), all 24 question regressions, Golden and the explicit native first-slice regression. Evidence: reports/runs/sources-a5fc0f8. The default Compose slice attempt was canceled while Docker remained blocked; no Compose pass is asserted. Inspection identified a same-provider-revision changed-content identity edge case, which is the next source correction. No new full product acceptance or independent approval is claimed.

The provider-revision conflict correction is implemented: same-revision changed content is quarantined, old identities remain replay-compatible, and unresolved health gaps survive later empty checks. Pre-commit API/PostgreSQL/Rust/actual SDK MCP checks passed; the next clean-commit run will provide durable evidence. No additional acceptance gate or independent review is claimed.

Clean 113ea876e5139d2b5d266be7955d547132e42724 passed source conflict/health, all 24 questions and their cold/security adversaries, Golden and the native first-slice regressions. Evidence: reports/runs/source-conflicts-113ea87. Changed content at the same provider revision stays quarantined; an empty later check does not erase its unresolved health gap. Live access, other selected adapters, complete operational/distribution/performance gates and independent review remain open.

The owner-review subset is implemented with immutable claims/decisions, optimistic/idempotent corrections, bounded retained-input retries and EN/DE UI. Pre-commit actual API/PostgreSQL/Rust/SDK MCP/browser/restart/cold checks passed, including distinct competing decisions and expired poison inputs. Clean-commit reproduction follows. Legacy lifecycle/failed-derivation review and other P4 operations remain open; no full PILOT-04 pass or independent review is asserted.

Clean ddeba85dcbc272b4b752de8a8ba9f9f907c96b56 passed immutable owner decisions, competing corrections, retained-input retries, link confirmation/rejection, EN/DE browser, API/SDK MCP, restart with an unapplied decision and deleted-projection recovery. Source, all 24 question, Golden and native first-slice regressions also passed. Evidence: reports/runs/reviews-ddeba85. Legacy lifecycle/failed-derivation review and other P4 work remain open; no full PILOT-04 or independent approval is claimed.

Shopify stock snapshots are implemented with bounded item/location pagination, exact provider-available quantities, atomic persisted item cohorts, strict opening-state consent, source limitations and EN/DE scope controls. Synthetic pre-commit HTTP/PostgreSQL/Rust/API/SDK MCP/browser, interrupted-page restart and deleted-projection checks passed. The committed reproduction is next. Current snapshots are not historical openings, provider-atomic counts, movement causes or global completeness; live account access and independent review remain unverified.

The committed stock suite passed at 50b0e1c. The following source regression failed because grant-metadata refresh unnecessarily regenerated the unchanged credential ciphertext. The worker now preserves the existing envelope unless credentials change. No token content or account identity changed. Evidence: reports/runs/stock-50b0e1c; the affected committed regression rerun follows.

Clean bd147b9b4441df9954fd09d9a791bbfcf4001e30 passed inventory HTTP/PostgreSQL/Rust/API/SDK MCP, EN/DE browser, interrupted-page/unapplied-cohort restart, deleted projection recovery and source-scope/tenant adversaries. All source, owner-review, 24-question, Golden and native first-slice regressions passed; 10 Node and 5 Rust unit tests, build and typecheck passed. Evidence: reports/runs/stock-bd147b9. Unchanged credential envelopes now remain stable during grant refresh. Other selected adapters, full operational/distribution/performance gates, live access and independent review remain open.

Shopify fulfillment snapshots are implemented with bounded outer/nested pagination, exact line quantities, separate preparation and physical milestones, and EN/DE source controls. Synthetic development HTTP/PostgreSQL/Rust/API/SDK MCP/browser/restart/deleted-projection checks passed. The corrected harness explicitly uses bb_worker; a prior API-role initialization was correctly denied by PostgreSQL. Later physical regressions are quarantined, and retained preparation facts preserve their gap through empty checks. Additional line-budget and negative-quantity checks precede clean committed reproduction. Live access, carrier/tracking inputs, independent review and remaining P4 work are open.

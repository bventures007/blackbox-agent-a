# Local pilot implementation status

## Current assignment

Baseline-v14 / brief 2.3: P0–P4 local pilot, then handover and stop. Implementation ran in this repository only (`blackbox-agent-a`), with isolated ports (API `127.0.0.1:19080`, test-only published PostgreSQL `19032`, fixture `19079`, engine `19070`), volumes (`blackbox-agent-a_*`) and secrets (`.secrets/`, never committed). Engineering content is English; UI and landing page are English by default with complete German.

## Milestones

- [x] P0 — environment and minimal contracts (docs/build-environment.md, ADR-001..010, typed journal/query contracts, migrations, Compose/wrapper)
- [x] P1 — owner key/session, automatic owner/workspace, persisted Shopify-shaped slice (fixture → worker → PostgreSQL journal → Rust engine → API and SDK stdio MCP → restart), structured logging and host CLI; SLICE-01 recorded; SLICE-02 blocked (no authorized store)
- [x] P2 — Golden Scenario through the real pipeline, all 24 query intents with positive and missing-data paths, UI/locales, import plans/readiness/health, System & Diagnostics, restart/rebuild
- [x] P3 — Shopify and Shopify Payments adapters (fixture-proven), generic signed producer, replay, bank CSV, policy rules, runtime producers; agent keys, revocation and the MCP bridge
- [x] P4 — release archive build, landing download states, bounded memory/perf harness, backup/restore/upgrade, DIAG/PILOT evidence, feedback guide, handover (`reports/checkpoint.md`). Items that could not be verified without external access are listed as blockers, not passes.

## What runs (verified on this Mac)

| Layer | Implementation | Verification |
|---|---|---|
| Journal | PostgreSQL 17, five logical tracks in `journal_entries`, gap-free tenant sequences allocated under a row lock inside `journal_append`, append-only triggers (`BBX01`), same-identity/different-content conflicts (`BBX02`) to review cases, tenant scope mismatch (`BBX03`), RLS with explicit scopes, runtime roles without ownership/BYPASSRLS | `tests/integration/journal.test.ts` (JOURNAL-01/02, TENANT-02/03) |
| Engine | Rust: typed payloads, deterministic `r1` derivation (same-batch facts visible through a batch overlay resolver), per-entity reducers, bounded resident state with LRU eviction and hydration, snapshots + tail, rebuild on unreadable snapshot, committed/applied cursors, 24 intents + entity views | `tests/integration/golden.test.ts` (DOMAIN-01/02/03/07), `slice.test.ts` restart (LOCAL-09/INSTALL-02), Rust unit golden |
| Ingestion | Shopify GraphQL 2025-10 orders/inventory with per-page durable commit and overlap; Shopify Payments ledger/payouts/disputes; signed generic envelopes; replay; bank CSV profiles; policy rules; runtime coverage/identity facts | `slice.test.ts`, `payments.test.ts`, `queries.test.ts` |
| Access | One automatic owner/workspace; 256-bit keys shown once, verifier-only storage; HttpOnly/SameSite=Strict sessions with absolute/idle expiry; exponential throttling; exact Host/Origin + CSRF header; separate revocable agent principals; loopback-only publication | `tests/integration/auth.test.ts`, `slice.test.ts` (LOCAL-01..05) |
| Queries | Shared API/MCP query core with cutoffs, coverage, calculation, evidence ids; admission limits; `projection_behind` instead of stale answers | `queries.test.ts` (QUERY-01/02, MCP-01), `contract.test.ts` |
| Diagnostics | Measured health with timestamps/reasons; allowlisted structured records with cursor correlation; bounded filterable logs; 15-minute debug windows; redaction before emission; local export with 10 MiB cap; host CLI readers that work without the API | `tests/integration/diagnostics.test.ts` (DIAG-02/03/05/06/08), `./blackbox logs` |
| UI | React app reusing the supplied prototype styles; EN default, full DE; recorder, sources, questions with evidence drawer, agents, journal, review, diagnostics, settings | `tests/e2e/pilot-journey.spec.ts` (desktop + mobile, EN + DE) |
| Operations | `./blackbox` wrapper (doctor/setup/up/down/status/logs/backup/restore/upgrade/diagnostics export/reset-access), encrypted backup generations with recovery key, isolated restore with fenced access, serialized fenced upgrade with migrations and post-checks | scripts + evidence under `tests/evidence/current/ops-*` |
| Distribution | `scripts/build-release.sh` → versioned archive with wrapper, pinned Compose, bundled images, EN/DE guide, manifest + SHA-256; landing page reads `release/manifest.json` | DIST-01..03 evidence |

## Defects found and fixed during verification (kept for reviewers)

- Engine HTTP wedged after a notification for an unknown tenant (read guard held while requesting the write guard). Fixed; probe: `NOTIFY journal_committed, '<unknown uuid>'` then `/health`.
- Scheduled polls never fired after the first job: scheduler scope could not read capability/connection rows (RLS) and finished singleton jobs were never re-armed; a naive re-arm produced a per-tick import burst. Fixed with migration 0002, re-arm spacing and capability advancement.
- Derivation inside one batch could not see facts derived earlier in the same batch (bank confirmations, refund holds), so results depended on batching and rebuilds differed from first passes. Fixed with the batch overlay resolver.
- Producer-declared coverage was quarantined (Date objects in a strict payload); coverage-only envelopes were refused. Fixed.
- Shopify Payments re-polls raised identity conflicts (hour-bucketed balance ids, run-independent gap ids). Fixed.
- Stock movements effective before an authoritative snapshot were applied on top of it. Fixed (effective-time guard).
- The SPA fallback answered any unknown path with the app shell (200), including POSTs. Fixed.
- Docker VM disk exhaustion from repeated full image builds crashed PostgreSQL mid-run (recovered; reproduced by the `No space left on device` panic in its log). Operational note added to docs/operations.md.

## Evidence summary (fresh installation, commit 45f9090, run `pilot-20261031T181630Z-45f9090`)

- Integration suite: 52/52 passed (`reports/integrations/pilot-20261031T181630Z-45f9090/vitest-integration.json`).
- Browser journeys: 10/10 passed, desktop and mobile, EN and DE (`tests/evidence/current/playwright.json`, 40 screenshots).
- Backup, tamper rejection and isolated restore: passed, restore 30 s machine time (`tests/evidence/current/ops-backup-restore.txt`).
- Release archive 281,837,818 bytes with verified manifest/checksum/landing links; fresh-folder installation from the archive answered the first question with evidence (`tests/evidence/current/dist-*.json`).
- Integration register: 68 pilot rows with claim, implementation and four passed test kinds each; 40 live tests blocked (no provider access); 0 independent approvals (`INTEGRATIONS.md`).
- Question coverage: 24/24 positive paths, 24/24 explicit missing-data paths, API/MCP parity for 5 intents (`reports/question-coverage.json`).
- Performance smoke profile: `reports/performance.json` (filled from the seed/load run; targets not instrumented are listed there).

Independent review events have not been recorded by this session (no self-approval).

## External blockers (not passes)

- SLICE-02 / SOURCE-01 live: no authorized Shopify store or Shopify Payments account was available; the adapter path is proven only against the bundled fixture (`fixtures/shopify-fixture-server`).
- MCP-03: a real third-party MCP client session is recorded only if the Claude Code CLI run in `tests/evidence/current/mcp-client.json` succeeded; otherwise pending.
- DIST-02 registry publication: no `write:packages` permission; images are bundled in the archive instead of published to a registry.
- Independent approvals in the integration register: require a reviewer other than the implementing agent.

## Evidence policy

Keep reports/acceptance.json, question-coverage.json, performance.json and the integration history current with actual commits, commands, environment and artifacts. Previous preparation findings remain in docs/history/.

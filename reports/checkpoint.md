# P4 handover checkpoint — Blackbox local pilot 0.1.0-dev

Repository: `bventures007/blackbox-agent-a`, branch `main`. Final evidence run: `reports/integrations/pilot-20261031T191734Z-0faf361/` on a fresh installation at commit `0faf36199d9e1df8a3fa78444a98c157582061a5` (an earlier green run at `45f9090` is kept under `reports/integrations/pilot-20261031T181630Z-45f9090/`). The commits after `0faf361` contain only the recorded evidence, reports and this document. Two defects found by the tester after the handover were fixed afterwards (`84c2020`, `e6cf2d2`): the API container served the landing page without its stylesheet and manifest, and the Compose health probe of the API container always reported unhealthy. The installation archive was rebuilt at `e6cf2d2` and re-verified from the landing bundle and a fresh-folder installation (`tests/evidence/current/dist-*.json`, `ops-dist-install.txt`); the other evidence still refers to the `0faf361` run.

## What is delivered

- **Runnable local application**: `./blackbox doctor && ./blackbox setup && ./blackbox up` from this repository or from the installation archive; UI at <http://127.0.0.1:19080/> (EN default, full DE).
- **Installation package**: `release/dist/blackbox-0.1.0-dev-macos-arm64.tar.gz` (281,854,930 bytes, SHA-256 `a993654dd3b47c4da6251a0fea0d7e68e5727bb9a6a873bf3a9104b05ac2a210`, built by `scripts/build-release.sh --reuse-images`) with wrapper, pinned Compose, bundled node/engine/postgres images, EN/DE guide, `release/manifest.json`; publishable landing bundle in `release/site/` (page + manifest + archive + checksum). The archive is not committed (size); rebuild it with the script at the tested commit.
- **Instructions**: `docs/feedback-guide.md` (tester start/save-key/import/first answer/agent/restart/recovery, EN + DE), `docs/operations.md` (lifecycle, secrets, backup, restore, upgrade, offline diagnostics, disk exhaustion), `README.md`.
- **Reports**: `reports/acceptance.json`, `reports/question-coverage.json`, `reports/performance.json`, `INTEGRATIONS.md` (generated from `integrations/history.jsonl`), `docs/status.md`, this checkpoint.

## Exact start / test / recovery commands

```bash
./blackbox doctor
./blackbox setup            # prints the owner key once; save it
./blackbox up               # http://127.0.0.1:19080/
./blackbox status
./blackbox logs --since 2h --level warn
./blackbox backup --configure --destination /path/outside/the/installation   # prints the recovery key once
./blackbox backup --now
./blackbox restore /path/to/generation.bbx --into /empty/folder --port 19081  # asks for the recovery key
./blackbox upgrade --from /path/to/extracted/newer/release
./blackbox diagnostics export --since 24h --output blackbox-diagnostics.json
./blackbox reset-access     # host-only owner key rotation
```

Tests (from a checkout, with the stack started through the test overrides so PostgreSQL/engine/fixture are reachable on loopback test ports):

```bash
docker compose --env-file infra/compose/.env -f infra/compose/compose.yaml -f infra/compose/compose.test.yaml --profile fixture up -d
cd tests && npx vitest run --config vitest.integration.config.ts integration/*.test.ts
cd tests && npx playwright test
node tests/perf/seed.mjs --orders 11000 --tenants 50 && node tests/perf/load.mjs --duration 600 --mode api && node tests/perf/load.mjs --duration 600 --mode mcp
cargo test && pnpm -r build
python3 scripts/integration-register.py check && python3 scripts/validate-question-catalogue.py && python3 scripts/validate-delivery-profile.py --release
```

## Verified (synthetic, on this Mac, fresh installation)

| Area | Result | Evidence |
|---|---|---|
| Integration suite (journal, auth, contract, slice, golden, queries, diagnostics, payments) | 52/52 passed | `reports/integrations/pilot-20261031T191734Z-0faf361/vitest-integration.json`, `tests/evidence/current/*.json` |
| Browser journeys (desktop + mobile, EN + DE, landing, sign-in, questions with evidence, agents, journal, review, diagnostics, settings, wrong-key handling) | 10/10 passed | `tests/evidence/current/playwright.json`, `tests/evidence/current/screens/` (40 screenshots) |
| Persisted slice: fixture Shopify → worker → PostgreSQL journal → Rust engine → API and SDK stdio MCP → restart with removed snapshot | identical fixed-cutoff answers | `tests/evidence/current/slice-01.json` |
| Golden Order-to-Cash through the real pipeline (stepwise, full, repeated, scaled, missing bank, bitemporal) | every checkpoint matched; conservation holds | `tests/evidence/current/golden.json` |
| All 24 intents: positive paths, API/MCP parity (5 intents), missing-data on an empty workspace | 24/24 positive, 24/24 missing-data explicit | `tests/evidence/current/queries.json`, `reports/question-coverage.json` |
| Shopify Payments ledger/payouts/disputes (fixture) with values recomputed independently from the fixture | gross-to-net exact | `tests/evidence/current/shopify-payments.json` |
| Backup → tamper rejection → isolated restore (new owner key, agents revoked, providers paused, identical answer at the same cursor) | restore 30 s machine time | `tests/evidence/current/ops-backup-restore.txt`, `ops-restore-check.json`, `ops-backup-manifest.json` |
| Release archive, manifest/checksum/landing links from one static origin, installation from the archive in a fresh folder (no clone, no toolchain), first answer | passed | `tests/evidence/current/dist-landing-check.json`, `dist-install-check.json`, `ops-dist-install.txt` |
| Fresh installation path (setup prints the key once, migrations, one workspace) | passed | `tests/evidence/current/ops-fresh-install.txt` |
| Performance smoke profile (55 tenants, 347,182 journal entries, 20 ingest/s, 20 clients + 40 arrivals/s API, 10 clients + 20 arrivals/s MCP, 600 s each) | 15 of 18 measured targets hold (hot p95 API 186 ms / MCP 173 ms, cold p95 46/73 ms, history p95 41/58 ms, summary p95 96/149 ms, durable ack p95 151 ms, lag p95 300 ms, engine RSS 735 MiB peak); **failed**: hot p99 API 878 ms (target 500), hot p99 MCP 1205 ms (900), MCP success 0.9977 (0.999) under the per-workspace concurrency cap | `reports/performance.json`, `tests/evidence/current/perf-*.json` |

## Acceptance tally (`reports/acceptance.json`, 83 active pilot cases)

- passed: 62 · implemented_unverified: 16 (each names the missing automated check) · blocked_external: 3 (SLICE-02, SOURCE-01, MCP-03) · failed: 1 (PILOT-09, three performance targets missed) · not_applicable: 1 (SEC-03, no extraction feature). Deferred platform cases (37) stay `not_started`.
- `python3 scripts/validate-delivery-profile.py` passes; `--release` fails by design until live proof and independent approvals exist.

## Not verified / external blockers (not passes)

- **Live Shopify / Shopify Payments (SLICE-02, SOURCE-01, live register tests)**: no authorized store or Shopify Payments account was available; the adapters are proven only against the bundled fixture. `blocked_external`.
- **Real third-party MCP client (MCP-03)**: the Claude Code CLI on this Mac could not authenticate (OAuth session expired); the SDK stdio client is the exercised client. `tests/evidence/current/mcp-client.json` records the attempt. `blocked_external`.
- **Independent review**: the integration register has 0 independent approvals; `python3 scripts/validate-delivery-profile.py --release` fails on exactly these gaps by design. Acceptance cases that depend on them stay `blocked_external` / `implemented_unverified`.
- **Upgrade rehearsal (OPS-02, PILOT-03)**: implemented and preflight-checked, but no newer release existed to upgrade to in this session.
- **Registry publication (DIST-02 variant)**: no `write:packages` permission; images are bundled in the archive instead.
- Cases marked `implemented_unverified` in `reports/acceptance.json` name the missing automated check in their blocker field.

## Known limitations worth a tester's attention

- The host is a developer Mac with Docker Desktop; performance numbers are for that environment, not the contract's reference host.
- The pilot runs only in `local_standalone` mode; gateway and public modes are refused explicitly.
- The web UI is the supplied prototype design wired to live data; some secondary screens show live data more plainly than the prototype's mock-ups.

## Stop

Work stops here at the P4 handover as instructed. Deferred SaaS, gateways, native packaging and the platform roadmap were not started.

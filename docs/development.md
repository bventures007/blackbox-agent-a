# Current developer checkpoint

This is an incomplete P1 implementation based on baseline-v14. It is not an
installation package or a P4 handover. The full specification and acceptance gates
remain unchanged. Do not use customer data in this development runtime.

## Compose path

Prerequisites: Docker with Compose, locally installed Node/pnpm and Rust only when
building from source. Pinned runtime/build images and lockfiles are committed.

```sh
./blackbox doctor
./blackbox build
./blackbox setup
./blackbox up
./blackbox status
```

Setup requires an interactive host terminal to display the personal key once.
The browser origin is http://127.0.0.1:18741. `./blackbox down` stops services and
preserves volumes. Never run `docker compose down -v` on business data.

Observed limitation on this Mac: images built, but ordinary Docker containers
remained in `created`. Therefore Compose startup/install is unverified. No Docker
reset, global security change or competing-resource operation was performed.

## Isolated native developer tests

This fallback uses the already-installed Postgres.app 18.4, Node 25.9.0 and Rust
1.90.0. It is not the advertised no-toolchain distribution. PostgreSQL data lives
under `.runtime/pg` with a unique protected Unix socket and no TCP listener. Web,
engine and synthetic fixture bind loopback 19741/19742/19743.

```sh
pnpm install --frozen-lockfile
cargo build -p blackbox-engine
python3 scripts/native-dev.py up
python3 scripts/verify-slice.py --native --output .runtime/slice-evidence.json
python3 scripts/native-dev.py exec node --import tsx tests/client-compatibility.ts
python3 scripts/native-dev.py exec node --import tsx tests/browser-smoke.ts
python3 scripts/native-dev.py down
```

The tests create synthetic tenants/credentials and read-only HTTP fixtures; no
Shopify account is contacted. Tests deliberately corrupt/remove only rebuildable
synthetic projections and test recovery from the unchanged journal. Generated
keys and config stay in `.runtime` with protected permissions. Do not commit or
upload that directory. Repeating tests appends fresh synthetic tenant namespaces.

## Current test commands

```sh
pnpm typecheck
pnpm test
cargo test --workspace
python3 scripts/validate-question-catalogue.py
python3 scripts/integration-register.py check
python3 scripts/validate-delivery-profile.py
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
```

`--release` is a separate gate and remains blocked while implementation/evidence
are incomplete. Validator success is not a product pass.

## Retained diagnostics

```sh
./blackbox logs --since 1h --level warn
./blackbox logs --component worker --format json
./blackbox diagnostics export --since 1h --output /absolute/new-file.json
```

Host diagnostics reads allowlisted local files without the API/database. Export
is explicit, pseudonymizes opaque IDs and never uploads. The complete DIAG
retention/performance/export contract is still under implementation and unverified.
Backup/restore/upgrade release commands are not yet delivered; no protection is
claimed merely because this development runtime persists data.

# Current developer checkpoint

This is an in-progress local pilot implementation based on baseline-v14. It is not an
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

The actual Compose persisted slice passed at 5e5fc42 on this Apple Silicon Mac,
including PostgreSQL/Rust/API/MCP and restart/corrupt/deleted projection recovery.
Fresh browser-download installation and the release package remain unverified.
No Docker reset, global security change or competing-resource operation was performed.

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

The React production UI must be built with `pnpm build:web` before starting the native developer stack. It is served by the existing loopback API, not a second runtime web server.

## Protected bootstrap and separate installations

Fresh explicit `./blackbox build` or `./blackbox setup` creates a random
`blackbox-a-<12 hex digits>` Compose project, separate database passwords and
installation data/internal keys. Use `./blackbox setup --port 18751` (or `build
--port 18751` before setup) for a concurrent isolated install. The existing
source-development installation retains project `blackbox-a` and port 18741.
Normal `up`, `status` and `down` never create replacement credentials.

The runtime directory and its `secrets`, `evidence` and `logs` directories must
be owned by the current OS user and mode 0700. `compose.env`, `native.json` and
key files are protected regular single-link files with no group/world access
or executable bits. Bootstrap rejects symlinks, corrupt lengths/encoding,
foreign ownership, dotenv injection and different requested existing ports.
An older developer runtime created with mode 0755 requires an explicit
`chmod 700 .runtime` before startup. Do not loosen permissions to repair errors.

If configuration or a key is missing, stop and restore the original protected
material; setup will not manufacture a replacement over existing state.
Stopping/status remain available with a missing encryption key when the
Compose configuration is intact. Native `down` also remains available without
encryption keys. This fail-closed guard is not a substitute for the still-pending
encrypted backup/restore and versioned key-rotation procedures.

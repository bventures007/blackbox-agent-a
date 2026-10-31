# ADR-007 Wrapper, Compose release, versioned archive and image distribution

**Status:** accepted 2026-10-31 (P0); revisited at P4 with measured results.

- `./blackbox` is a POSIX shell wrapper (bash 3.2-compatible for macOS) implementing `doctor setup up down status logs demo verify backup restore upgrade diagnostics export reset-access`. It never installs software, never deletes volumes and prints setup phases to `./.local/setup.log` before any container exists.
- Release = `infra/compose/compose.yaml` with image digests pinned in `release/manifest.json`, `.env.example`, EN/DE quick-start guide and the wrapper, packaged as `blackbox-<version>-macos-arm64.tar.gz` with a SHA-256 sidecar.
- Prebuilt images: the GitHub token available to this build lacks `write:packages`, and public publication is not authorized. The archive therefore bundles the release images as `images/*.tar` (`docker load`) so the advertised download works without registry credentials, a Git clone or toolchains. PostgreSQL 17 is bundled the same way. The trade-off is archive size (recorded in the manifest). A GHCR-hosted variant is a separately authorized option.
- Landing page: static build in `apps/landing/dist`, reads `release.json` at runtime so the same build can point at a private GitHub release asset or a local test host; tested from an independent static server before first install (DIST-01).
- Ports/volumes: loopback `127.0.0.1:19080` only; PostgreSQL and engine have no published ports. Named volumes `blackbox-agent-a_postgres`, `_data`, `_logs`; secrets in `./.secrets` (0700).

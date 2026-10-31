# Build environment

Recorded at implementation start (2026-10-31). Updated when the environment changes. No secrets or tokens.

| Item | Observed value |
| --- | --- |
| Assigned repository | `bventures007/blackbox-agent-a` (private), local clone `~/GitHub/blackbox-agent-a` |
| Agent/model and version | Claude Code (desktop app), model `claude-fable-5-1` (Claude Fable 5.1) |
| Start commit | `629da21ce922b110cfeb7e3c7a3f543912826a73` (baseline-v14 seed, `main`) |
| OS, CPU architecture, available CPU/RAM | macOS 27.2 (build 26B5091g), Apple Silicon arm64, 8 CPU cores, 24 GiB RAM, 54 GiB free disk |
| Node and pnpm versions | Node v25.9.0 (host); pnpm 11.20.0; containers pin `node:22-bookworm-slim` |
| Rust toolchain | rustup stable `aarch64-apple-darwin` (cargo 1.83.0 reported by `cargo --version`), 1.90.0 also installed; containers pin `rust:1.90-bookworm` |
| Docker/Compose availability | Docker Desktop 27.3.1, Compose v2.30.3; Linux VM aarch64 with 8 vCPU and 7.65 GiB memory (smoke profile reference is 4 vCPU/8 GiB: the VM is memory-limited below the reference; declared in reports/performance.json) |
| PostgreSQL integration-test availability | `postgres:17` image available locally; no host PostgreSQL. Integration tests run against a Compose-managed PostgreSQL |
| Browser/E2E availability | Playwright Chromium to be installed in the workspace; the built-in browser pane of the desktop app is also available for manual inspection |
| Network/package registry access | npm registry and crates.io reachable; Docker Hub reachable. GitHub CLI token scopes: `repo`, `workflow`, `read:org`, `gist` (no `write:packages`: pushing images to GHCR is **not** possible without separate owner authorization) |
| Execution limits set by owner | Work only in this repository; isolated ports/volumes/credentials; stop after P4. No paid services, no public publication |
| Provider sandbox/live capabilities | No Shopify store, Shopify Payments account or API token available in this environment. SLICE-02 / SOURCE-01 live proof is blocked_external until the owner supplies an authorized development store token |
| Real Mac/Linux host verification | This build runs on a real Apple Silicon Mac; fresh-install proof uses a separate directory and the browser-downloaded archive (P4). A second, physically different Mac is not available |
| MCP client(s) available | `@modelcontextprotocol/sdk` protocol client (automated). Claude Desktop (Claude.app) and Claude Code CLI are installed as potential real compatible local clients; their use is recorded separately |
| Runtime isolation: ports/Compose project/volumes | Compose project `blackbox-agent-a`; loopback web/API port **19080**; volumes `blackbox-agent-a_postgres`, `blackbox-agent-a_data`, `blackbox-agent-a_logs`; images `blackbox-agent-a/*`. A different independent build of the same assignment is running on this host under Compose project `blackbox-a` (port 18741); it was not inspected, and none of its containers, volumes, images or files are shared |

Distinguish an intended environment from one that was actually used. A missing host capability is a test limitation, not a reason to invent a result.

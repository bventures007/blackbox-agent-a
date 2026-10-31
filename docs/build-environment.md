# Build environment — 2026-10-31

Actor: Codex root agent, chat 01a19207-b77a-7182-be85-f3bbab82f151.
Assigned repository only: bventures007/blackbox-agent-a. No competing source read.

Observed host: Darwin arm64, macOS 27.2 (26B5091g). Node v25.9.0, pnpm 11.20.0;
Rust toolchain 1.90.0 is already installed and selected explicitly for this project.
Docker client/server 27.3.1, Linux aarch64 VM, 8 CPUs and 8,218,251,264 bytes RAM.
The installed Docker application was started; no global prerequisites installed.
Benchmarks must separately constrain/report the required 4 CPU/8 GiB conditions.

Checkout branch: codex/local-pilot, based on baseline-v14. Development runtime uses
the blackbox-a namespace, port 18741, private service networking and fresh generated
secrets. Generated state and package caches are ignored inside this checkout.

## External access

No SHOPIFY/BLACKBOX credential variables or supplied development-store access exist
in this task. SLICE-02 and live provider capabilities remain blocked_external. The
user authorized read-only live verification; no merchant mutation is authorized.
Do not paste credentials into chat. A protected host enrollment path is being built.

Official documentation checked on 2026-10-31:
- https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant
- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens
- https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order

Pin Admin GraphQL 2026-10. Client credentials apply to installed apps/stores in the
same organization; this is not universal merchant authorization. Order access needs
read_orders; older history needs read_all_orders approval. Payments account grants
are separate and not proved by an order token. No account permissions changed.

A real Apple Silicon host is available. Download/install, recovery, actual client,
sleep/wake and smoke evidence must still be executed; host availability is no pass.

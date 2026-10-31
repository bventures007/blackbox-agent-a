# Web, desktop and deployment contract

Binding owner-approved requirements for the full M0–M5 assignment. This is a specification, not an implemented installer or hosted service. Read with SOURCE-SYNCHRONIZATION.md and WEBHOOK-GATEWAY.md.

## One backend, two clients

The complete management product must work in a normal browser without installing the desktop app: sign-in, workspace/member/role administration, source setup and credentials, connection health, recorder, evidence, questions, MCP access, exports and application settings. Preserve the supplied design. English is the default; all product UI and the landing page also support German. Share React components, locale resources and authorized API/query services between browser and desktop; never duplicate business reducers in a client.

The Mac desktop app is required in the full release. Use Tauri with a narrow native runtime adapter by default; record an ADR for a justified alternative. It adds local runtime discovery/start/stop/status, diagnostics, opening the browser and a local/remote backend selector. It can also connect to a self-hosted or hosted backend over HTTPS. A remote client does not need local PostgreSQL, Docker or Rust-engine processes. Do not expose a shell, Docker socket or privileged process control through ordinary web routes. Remote origins must not gain native capabilities. Store desktop credentials in the OS credential store; use supported browser-based login/PKCE where applicable, never ship a shared secret.

A backend instance owns ingestion, credentials, PostgreSQL journal/outbox, evidence storage, Rust projections/RAM, shared queries and MCP. Each workspace has exactly one writable canonical journal at its selected backend. Desktop/browser caches are not independent business replicas. Scaling backend replicas requires common durable state, consistent cursors and worker fencing; switching the UI endpoint is not replication or data migration.

## Deployment and ingestion are separate choices

| Ingestion mode ID | Backend location | Provider delivery | User access |
| --- | --- | --- | --- |
| `local_standalone` | Mac/private host | Outbound polling, imports or local authorized producers, only where supported | Local browser and desktop |
| `local_gateway` | Mac/private host plus separately deployed public gateway | Provider → registered public HTTPS gateway → durable queue → backend-initiated authenticated delivery; polling/reconciliation continue | Local browser and desktop |
| `public_server` | Self-hosted Linux or hosted multi-tenant backend | Provider → registered public HTTPS backend callback; polling/reconciliation continue | Browser and optional remote desktop |

These are connectivity profiles, not separate products or tenant models. A private Linux backend has the same reachability constraints as a Mac. Hosted SaaS and self-hosted servers use the same public-server profile and tenant isolation. A gateway is optional for the customer but its implementation is required in M5. No paid cloud account is needed for standalone use or synthetic verification. Local mode is not promised full live capability for every provider.

Local services bind to loopback by default. Any deliberate LAN exposure requires documented bind/auth/TLS choices. Public profiles require TLS, strict allowed origins, secure sessions and normal role enforcement. Core API/MCP authorization also applies locally; loopback is not authorization. A browser from another computer cannot access a loopback backend automatically. Gateway access forwards source events only; it does not expose local administration, queries or MCP. A cloud agent cannot reach a local MCP endpoint without a separately configured, secured route; support a compatible local MCP client/stdio bridge, or a remote public backend. Do not confuse these with webhook delivery.

## Local installation and lifecycle

Keep the same versioned Compose backend release for Linux and Apple Silicon Mac. The initial native launcher may orchestrate Compose, but must clearly detect and explain its container-runtime prerequisite before setup. Do not describe this as a dependency-free installer, silently install a system prerequisite, or claim a native PostgreSQL bundle exists without implementing and testing it. A fully bundled runtime is a later ADR, not a hidden first-release assumption.

Provide `./blackbox doctor setup up down status logs demo verify backup restore upgrade` as already required, and documented desktop equivalents for the applicable local operations. Protect initial-admin bootstrap; no default password or data reseeding. Keep project names, ports, volumes and credentials distinct for parallel installations. The desktop app attaches to the supervised local runtime: closing a window must not stop ingestion. Explicit shutdown shows its effect and leaves durable work recoverable. No processing occurs while the host/runtime is stopped; show the actual restart/catch-up state. Register login-start only through an explicit user setting. Updates preserve data, serialize migrations and support the documented recovery procedure.

Deliver reproducible desktop build/package instructions, a versioned Apple Silicon artifact, supported OS/prerequisite versions and evidence from a real Mac. Record signing/notarization separately; unavailable release credentials block that distribution proof, not independent development. Do not call an unsigned developer package a verified public distribution. Do not implement an unchecked remote auto-updater. Browser builds, desktop builds and backend compatibility must be versioned together.

## Moving a workspace

Provide an explicit operator-run migration procedure with a dry run. Freeze ingestion and acquire/fence the workspace writer; export a consistent journal/evidence/configuration checkpoint plus required encryption keys through a separate secure channel. Verify identity, counts/hashes, journal cutoff and schema compatibility on the target; rebuild/verify Rust state. Disable the old writer, move/rotate provider callback registrations or gateway routing, invalidate sessions/tokens as required, then resume and reconcile from the saved cursors. Reject overlapping writers. Preserve tenant and source identity without exposing a cross-tenant export. Document rollback before and after resumed writes; never restore an old writable copy after new target commits. Hosted per-tenant migration needs a scoped export/import, not a whole shared database dump. This is not peer-to-peer merging.

## Delivery sequence and proof

M0 defines trust boundaries, profiles and manifests. M1–M3 produce the complete core browser workflow, local backend, durable synchronization framework and honest mode/freshness display. The comparison checkpoint remains M0–M3 plus a working local Compose installer; native packaging and the public gateway may still be explicitly unfinished there. M4 implements the launch-provider adapters and direct callback/polling setup with honest provider evidence. M5 completes the desktop local/remote experience, gateway, server profiles, migration and operating/recovery tests. Full release requires all applicable gates; an optional customer mode does not make its implementation optional.

Required acceptance: WEB-01, WEB-02, DESKTOP-01, DESKTOP-02, DEPLOY-01, the SYNC/GATEWAY cases, and the existing install/isolation/operations/performance gates. Feature parity must be tested without a desktop process running. Keep UI privileges and native host privileges separate.

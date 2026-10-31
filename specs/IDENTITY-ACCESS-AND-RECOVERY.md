# Local identity, access key and recovery

Binding contract for `local_pilot`, superseding baseline-v10 passkey requirements. Read LOCAL-PILOT.md. The previous platform design is preserved under future/ for later review, not current implementation.

## One owner, a saved access key

First local setup creates one workspace and one human owner. Generate a personal access key with a CSPRNG and at least 256 random bits, formatted for reliable copy/paste with an identifying prefix. It is an opaque bearer login secret, used like a long generated password; it is not an asymmetric private key, a passkey or a data-encryption key. Use maintained crypto/session libraries. No chosen password, username, email account, central identity service or recurring one-time-code delivery is required.

An explicit OS-authorized setup command displays the key once through the local terminal/setup channel with copy/save instructions in EN/DE. Never print it into persistent application/container logs, command-line arguments, analytics or a URL. Store only a verifier/hash of the high-entropy key in the backend. Keep signing/encryption/provider secrets separately protected. The user saves the login key in a password manager; the application does not require integration with a particular password manager.

Initialization is atomic and idempotent: concurrent setup cannot create competing owners, restarts cannot replace the saved owner/key, and an HTTP visitor can never claim first-admin rights. Avoid an unauthenticated first-run web endpoint. The local owner can choose a workspace display name; no account-registration or multi-workspace journey is required. A key screen must explain that possession grants administrator access and that it should not be shared with agents.

## Login and remembered sessions

The browser connects only to the loopback web/API origin. Enter the key in a dedicated local login form to obtain a separate opaque, revocable session. Throttle failed attempts and do not reveal partial key matches. Use constant-time verifier comparison where appropriate, session fixation protection, HttpOnly cookies, deliberate SameSite policy, CSRF protection and exact Origin/Host allowlists. Never store the master key or session credentials in localStorage or send them in query strings.

Provide “Stay signed in on this computer” with a maximum 30-day absolute and seven-day idle session lifetime; ordinary unremembered sessions end on browser close where supported and have an eight-hour absolute limit. Browser session restoration behavior must not override server expiry. Logout revokes the session server-side. Native credential storage is not needed for the pilot because no native shell is required. If a future native client remembers a secret, it must use an appropriate OS credential store.

Local HTTP is permitted only on the explicitly tested loopback profile. Use the strongest cookie configuration actually supported there, documenting browser behavior; Secure cookies are mandatory for any future HTTPS network profile. CORS is not authentication. Reject forged Host/Origin, DNS-rebinding attempts, credential-less requests and unexpected origins. Protect API routes, source credentials, evidence/downloads and runtime metadata. The launcher cannot expose arbitrary command execution or a Docker socket through the browser.

Default listeners bind explicitly to loopback, never 0.0.0.0 or a LAN address. PostgreSQL, Rust and worker internals are not published to the host network. The pilot does not expose a supported LAN/public-server mode; fail clearly if an unsupported public bind is requested. It cannot promise protection from an attacker already controlling the user's OS account or files.

## Rotation and local loss recovery

Authenticated key rotation requires re-entry of the current owner key, creates a new random key, displays it once and durably invalidates the old verifier and all owner sessions. Re-login with the new key. Agent grants are visible separately and are not confused with owner sessions.

If the owner loses the key, provide a documented host-only reset command through the OS user's protected installation/volume access. It is not an unauthenticated web reset and must never bypass OS file permissions. Reset generates a new owner key, invalidates all owner sessions and agent keys by default, appends a redacted security audit event and preserves business data and source configuration. The personal login key is not used to decrypt stored business data/provider credentials, so replacing it must not destroy access to those records. This local reset is intentionally not a remotely recoverable SaaS account mechanism.

Backups contain the journal, evidence and separately protected encryption/configuration material needed to restore them. On restore, fence access and perform host-authorized rotation of owner/agent credentials and sessions before reopening; do not trust old revocation state or silently revive keys from a stale backup. Test the actual restored business answers, not only that files exist. No extra recovery-code, email or passkey system is required in the pilot.

## Separate read-only agent access

The owner can create named service principals in Agents & MCP. Each has its own random key (at least 256 bits), workspace binding, status, created_at, last_used_at, optional expires_at, revoked_at and responsible owner. Show secrets once; store verifiers, never plaintext. The simple pilot grant is “Read all business records and evidence in this workspace”; show that meaning explicitly. There is no employee role UI, arbitrary dataset restriction editor or service-owner promotion in this phase.

Agent access excludes authentication/session/credential tables, source secrets, setup/reset/admin operations, journal writes, generic ingestion, arbitrary SQL/files and process controls. Internal/provider/generic ingestion identities are separate. Every API/MCP/Rust/cache/cold query validates current workspace and active credential/grant; a caller-supplied tenant ID or localhost origin does not authorize a request. Tenant-scoped database constraints/RLS and actual two-tenant tests remain required even with one visible workspace.

Local MCP uses the maintained SDK with a stdio client/bridge calling these shared authorized services. Provision its agent key through protected environment/configuration or an available credential store, never command-line arguments, Git or a shared owner key. Do not auto-launch a subprocess as unrestricted owner. Protocol tests and at least one actual compatible local client must be documented with versions. No model subscription is needed for the protocol path. A cloud-only client cannot reach a private loopback endpoint; show that limitation rather than offering an insecure tunnel.

A loopback HTTP MCP transport may be supplied if useful and tested; public HTTP OAuth discovery, passkey consent and client-credentials flows are deferred. Never present a custom local bearer-key scheme as universally compatible remote MCP OAuth. Provider OAuth, if required for source authorization, is a separate connector concern and is not removed by simplifying user login.

## Revocation, storage and extensibility

Use one API authority for the pilot. Revocation/rotation commits before acknowledgment. New requests after acknowledgment must fail with the revoked credential, including stdio bridges, downloads, cold reads and cached answers. Open streams/queued deliveries must recheck authorization and stop within five seconds; do not rely on a permanent cached token or connection. In-flight operations completed before the revocation cannot retract data already delivered. Fail closed when current credential state cannot be verified. Multi-replica invalidation is deferred, not silently claimed.

Keep identity, membership, credential and session records separate from journal data. A stable owner user_id survives key rotation. Workspace membership remains a record rather than a global boolean admin flag. Service principals are distinct from people. Suggested fields: credential_id, principal_id, workspace_id, purpose, verifier, status, created_at, last_used_at, expires_at, revoked_at; session_id verifier, owner_id, created_at, last_seen_at, expiry, revoked_at. Store only necessary metadata and audit key creation/rotation/revocation/reset without secret values. Mutable auth state is not a sixth business track.

Maintain an authentication adapter boundary so a future passkey or server login can authenticate the existing identity. Do not implement those adapters now. Future server exposure needs an explicit threat model, transport, recovery and user-management review; changing the bind address is not a supported upgrade path.

Acceptance: AUTH-02 plus LOCAL-01 through LOCAL-05 and the shared isolation/security/MCP cases selected in ../delivery-profile.json. These are specifications; no product login is implemented by this document.

## Operational key and content policy

PILOT-OPERATIONS-AND-RECOVERY.md specifies the independent installation data key and backup recovery material, protected host storage, rotation/failure/restore behavior and field-level raw-content policy. These do not replace the simple personal login key or add a second login factor. Backup configuration may be postponed with an honest unprotected status. Human repair uses authenticated owner commands; business MCP credentials cannot approve corrections or administer backups.

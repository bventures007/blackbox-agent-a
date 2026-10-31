# System and diagnostics — required local pilot contract

Owner-approved addition after baseline-v11. This is part of P0–P4, not future hosting work. Implement it in both independent builds with the existing visual language. The seed contains specifications only; these behaviors and tests are not implemented yet.

## Product entry points and responsibility

Add an owner-only sidebar destination **System & Diagnostics** / **System & Diagnose**. Keep Sources as the central place for source setup, import progress, last successful checks, coverage and recovery. Each source detail and import run has **View logs** / **Logs anzeigen**, opening this destination with its connection/run filters applied. Link back to the authorized source/run from log details. Do not replace the business recorder or existing source health with technical logs.

The page has a health overview, searchable retained logs with a live mode, an expandable record/operation detail, temporary debug controls and an explicit diagnostic export. English is the default UI, with complete German labels, status explanations, recovery actions, empty/error states and accessibility. Raw structured logs, event names and engineering messages stay English. Translate known event summaries/actions with safe parameters; never translate or blindly render raw external payloads. Preserve keyboard operation and useful narrow-screen layouts.

The local owner may inspect sanitized runtime-wide health for this installation. Workspace-specific log rows, links, search results, counts, streams and exports remain workspace-scoped even in two-tenant tests. Installation-wide records contain only safe infrastructure metadata, never another workspace's context. Ordinary read-only business MCP agents cannot read technical logs, download diagnostics or enable debugging; they retain the existing authorized business readiness/evidence responses. No anonymous diagnostics endpoint, browser shell, arbitrary file reader or Docker-socket access is introduced.

## Health must describe measured state

Show these compact cards, with observation time, reason and an appropriate next action:

| Area | Required observations |
| --- | --- |
| API/backend | Version, uptime, last successful probe and current response availability |
| Worker/import | Heartbeat, running/queued/failed work, oldest pending age and latest successful progress |
| PostgreSQL | Actual connection/read/write readiness checks appropriate to the service; failed/unknown is distinct from healthy |
| Rust/query engine | Heartbeat, rebuild/loading phase, durably committed versus applied cursor for the relevant workspace, pending count/age and actual lag |
| Sources | Existing shared source-health state: last completed import/outcome, last successful scoped check, last new event, next attempt and coverage/rate/permission limits |
| MCP | Local bridge/service readiness and last actual authorized client request when available; configured endpoint or successful self-test is not an actual connected client |
| Diagnostics | Collector/store health, retained time range, disk usage/cap, dropped/suppressed record counts and active debug expiry |

Use explicit healthy, working/catching-up, degraded, unavailable and unknown/stale states. A process heartbeat alone does not establish end-to-end readiness. A running engine that is behind the required cursor is not query-current. An empty successful provider check is not a newly imported record. Derive source freshness thresholds from its capability schedule as specified in IMPORT-ONBOARDING-AND-DATA-READINESS.md; do not replace those thresholds with a universal five-second polling promise.

Refresh local runtime observations at intervals no longer than five seconds while the view is open and its transport is healthy. If runtime observations are more than 30 seconds old or their transport fails, show that they are stale/disconnected and retain the last observation time; never leave an unqualified green badge. Display reconnecting/recovered state explicitly. The UI refresh does not trigger provider API polling. Component thresholds and measured durations must be documented and testable. Health uses probes and durable operational state, not absence of ERROR logs or a green development register.

## Log view and severity semantics

Default to the last hour, newest first, INFO and higher. Provide exact level selection plus a **Warnings & errors** preset; also filter by time range, component, source/provider, connection, import run and correlation/trace ID. AND different filter dimensions, OR selected values within one dimension. Text search is literal and operates only on retained sanitized fields. Show active filters and a clear/reset action. Preserve selected filters across refresh; never put secrets or customer search text in URLs. Source/run links use opaque internal IDs.

| Level | Meaning | Example English summary |
| --- | --- | --- |
| DEBUG | Temporary, detailed troubleshooting; never required to understand normal progress | `Import page processed` with safe counts and duration |
| INFO | Normal lifecycle, batch progress, successful completion or recovery | `Journal batch committed` |
| WARN | Degradation or delay while recovery remains possible | `Provider rate limit reached; retry scheduled` |
| ERROR | An operation failed or cannot continue without intervention | `Source authorization expired; reconnect required` |

An expected scheduled poll is not a warning. A controlled 429 retry is WARN with the next attempt, not a fatal crash. Failed operations include a stable error code, affected component/scope, retryability, next retry if scheduled and an actionable explanation. Repeated identical failures are aggregated/rate-limited with a visible count; successful recovery emits a corresponding event without rewriting older logs. Fatal process errors use ERROR plus explicit termination metadata. Do not add severity levels or a complex alerting system as a pilot prerequisite.

Live mode appends new retained records within five seconds under the declared healthy pilot workload. Pause freezes the displayed position, not collection or ingestion; show a new-record counter and resume/jump control. History uses bounded cursor pagination with stable record IDs and duplicate suppression; timestamps alone are not unique cursors. Default page size 200, maximum 1,000. A reconnect resumes from a retained cursor, or explicitly reports that rotation/loss made it unavailable. Empty results, out-of-retention ranges, missing DEBUG history, collector failure and network failure have different states. Never imply logs are complete when rows were dropped or a service never started.

Details expose timestamp, level, component, safe English message/localized explanation, identifiers, durations/counts, error/retry/action metadata and a copy-safe action. Traces are expandable across components; all displayed links are reauthorized. Use text rendering/escaping, not provider HTML or terminal escape execution.

## Shared structured record and lifecycle instrumentation

Use one versioned log contract across the wrapper, API, worker, Rust engine and local MCP bridge. Generate structured JSON through maintained logging libraries. Align timestamp, severity and optional trace/span semantics with the [OpenTelemetry log data model](https://opentelemetry.io/docs/specs/otel/logs/data-model/); an external collector or telemetry service is not required.

Required fields: `schema_version`, unique `record_id`, UTC `occurred_at` and collector `observed_at`, `level`, stable `event_name`, safe English `message`, `component`, `service_version`, `instance_id` and `scope` (`installation` or `workspace`). Workspace records require verified `tenant_id`; scoped operations also carry applicable `connection_id`, `capability_id`, `run_id`, `operation_id` and `attempt`. Include `trace_id`/`span_id`/parent linkage when propagated through a request. Optional typed fields include `duration_ms`, `record_count`, `error_code`, `retryable`, `next_retry_at`, `action_code`, `journal_batch_id`, `committed_cursor` and `applied_cursor`. Absent context is null/omitted with honest scope, not an invented ID or a borrowed workspace.

Choose finite allowlisted fields, length limits and stable event names. Do not serialize arbitrary objects or exception/request structures. Record local opaque references rather than customer names, emails, order numbers, provider pagination URLs or raw cursor tokens. Provider cursor secrets stay in protected operational state. Do not trust incoming payload tenant IDs or provider strings as log scope, paths, templates or instructions. Clip overlong allowed text safely, escape control characters and flag truncation; maximum serialized record is 16 KiB. Measure local durations with a monotonic clock; distinguish occurrence, receipt and observation times, and do not claim cross-machine latency without valid clock assumptions.

Instrument setup/start/stop/restart and failure; poll/import/reconciliation start, batch progress, retry, failure and completion; verified source fetch, durable journal/outbox commit, Rust projection/application and query serving; permission/access failures; source reconnect and component recovery. Reuse existing run/batch/cursor IDs. Correlation must cross TypeScript/Rust/queue boundaries and retries without treating distinct attempts as one success. Log `journal.batch_committed` only after its transaction commits and `engine.batch_applied` only after the corresponding committed state is actually published. A query record may reference its authorized applied cutoff and timings, never its prompt, response or raw business records. A crash can leave a missing log even after a durable commit; durable journal/checkpoints remain the authority.

At INFO, log bounded batch/run summaries rather than every business record. Show how to follow a source batch through commit and engine application, then identify the cutoff used by a subsequent query. This is causal evidence, not an assertion that every later query shares the ingestion trace. Record database slow/failure metadata with safe operation names, never SQL values, bound parameters or full queries containing customer data. Configure third-party/HTTP/PostgreSQL loggers accordingly. MCP stdio stdout is protocol-only; diagnostics go to stderr/local collection, never into JSON-RPC output.

## Local storage, bounds and failure behavior

Store technical logs separately from PostgreSQL's canonical five-track journal and from durable security audit records. Use persistent rotating local JSON logs, available without the API/database. A small rebuildable local search index is permitted if needed for bounded queries; the index is not a second business database. Document the actual host-visible path/volume mapping, access permissions and index rebuild procedure. No required Grafana/Loki/Elasticsearch, SaaS account, public endpoint or automatic upload.

Default retention is **seven days or 100 MiB total, whichever is reached first** for automatically retained technical logs and their index. Account for every managed copy, including debug output and container log buffers; do not hide an unlimited stdout/container duplicate. Size rotation must enforce the bound during ingestion; enforce age expiration at startup and at least hourly while running. No background deletion while the runtime is stopped is promised. Document allocations within the total cap, including persistent collector buffers/index overhead, and show the actual retained interval. Owner changes require bounded validated configuration; unlimited retention is unsupported in the pilot. Explicit user-exported files are outside automatic retention and their size/location must be shown.

Use bounded asynchronous logging buffers; do not block business commit/query threads on a slow log sink. Establish a finite memory budget per component and report it. Under overload, suppress/sample DEBUG/INFO first, reserve bounded capacity for WARN/ERROR, expose lost-record counts and mark diagnostics degraded. Even errors cannot justify unbounded memory; report loss rather than claiming an exhaustive audit. If logging storage is full/read-only/unavailable, keep source/journal behavior correct where their independent storage is healthy. If the shared disk also prevents durable journal writes, fail safely without acknowledging ingestion or claiming query freshness. Never delete business data to recover log space. Avoid recursive log storms when reporting collector failure; make the failure observable through health/CLI independently of the failed sink.

Required durable security audit records from IDENTITY-ACCESS-AND-RECOVERY.md remain separate and retain their transaction/access guarantees; best-effort log dropping or technical rotation cannot erase/replace them. The business journal remains append-only regardless of technical log retention. There is no claim of tamper resistance against the local host administrator.

## Temporary debug recording

The owner can enable DEBUG for a chosen component and optionally a connection/run for **up to 15 minutes**. Display scope, start/expiry and a stop button. Renewal is explicit, never automatic; startup resets to INFO and expiry must hold when the browser closes. The worker/logger enforces expiry, not a browser timer. Capture safe metadata about activation/stop/expiry and actor identity in the existing protected administrative audit mechanism. DEBUG is subject to the same redaction, retention, rate and memory bounds; it is not permission to include payloads/secrets. Filtering cannot retrieve DEBUG records that were never recorded. Do not enable global debug by default or silently persist it across restart.

## Installation and outage fallback

Implement and document these minimum wrapper interfaces, with equivalent filter semantics to the UI:

```sh
./blackbox logs --follow --level warn
./blackbox logs --since 1h --component worker --connection <connection-id>
./blackbox logs --run <run-id> --format json
./blackbox doctor
./blackbox diagnostics export --since 1h --output <local-file>
```

`--level` is a minimum threshold (warn includes error); enum/ID/time parsing is bounded and validated. `logs` is read-only; interruption only stops following. `doctor` reports prerequisites, runtime, configured ports, storage accessibility and observable service state with safe error/next-action codes; it does not silently install/repair/reset anything. Use success/degraded/failure exit codes documented in `--help` and the tester guide. Print local time presentation only with explicit timezone; JSON retains UTC. None of these commands are implemented by this seed.

The wrapper records sanitized setup phases before containers/API/database exist. Prerequisite failures appear immediately in the terminal with an accessible local setup log path. After an API/database/container-runtime outage, host-authorized CLI reads of already retained logs must still work from persistent files without requiring owner HTTP login. Report which live checks are unavailable; never fabricate status when the runtime is down. If files cannot be created/read, give a safe terminal error and state that persistence is unavailable. Personal key issuance remains only in the protected setup channel and is excluded from all persistent/wrapper/container logs. Do not capture shell tracing, full environment dumps or access keys in command arguments.

## Access, redaction and explicit export

Apply current owner session authorization and workspace scope to listing, searching, live subscription, details, downloads and debug controls. Debug/export mutations require the existing origin/CSRF protection. Revoke/log out with the existing contract: new requests denied after durable acknowledgment and open delivery stopped within five seconds. Host CLI access depends on OS/volume access; it does not create an unauthenticated web escape hatch.

Redact/allowlist **before emission**, including exception chains, nested fields, request URLs/headers and third-party output; do not merely hide values in the UI. Never log owner/agent/provider credentials, verifier material, cookies, Authorization headers, full request/query bodies, raw emails/orders, customer PII or arbitrary environment/configuration dumps. This also applies to debug, stdout/stderr, persisted files, indexes, copied details and exports. Test injected canaries and control/HTML strings. Local file permissions and encrypted host storage recommendations belong in the install guide; do not imply that application authentication protects files from the host owner.

Export is explicit and local. Preview included categories, time range, estimated/actual size and any unavailable/truncated sections. Default bundle: application/build/schema versions, coarse OS/runtime versions, allowlisted configuration choices (no hostnames/usernames/home paths/credentials), health observations, error codes/counts and selected sanitized log excerpts. Pseudonymize workspace/connection/run/trace identifiers consistently within an exported bundle so correlations survive without exporting account identifiers. Exclude business content, database/evidence dumps, tokens, absolute personal paths and raw provider configuration. Reapply export allowlisting even to older log formats. Cap bundles at 10 MiB with a clear truncation/range notice; use bounded temporary storage and cleanup after expiry/failure. No automatic upload, telemetry or external collector traffic. User-selected output files are deliberate exports, not silently retained temporary copies.

## Delivery and acceptance

P1 implements the shared record/redaction boundary, persistent bounded logs, setup/CLI fallback and runtime probes alongside the first persisted slice. P2 delivers the full EN/DE page, filters/live/history, safe details, shared source health/deep links and debug controls. P3 instruments real selected source/MCP paths. P4 proves failure behavior, bounded overhead, real-Mac fallback and export, and includes screenshots plus short troubleshooting steps in the tester guide. Do not defer all logging until after implementation.

DIAG-01 through DIAG-08 in ACCEPTANCE.json are active pilot release gates. Use provider-shaped local fixtures and injected outages without customer data. Required evidence includes actual commands, tested commit, environment, measured behavior and artifacts, plus browser screenshots in both locales. A spec/fixture or green preparation validator is not a product pass. The existing active performance and security gates still apply with default production logging enabled.

For DIAG-07, generate a retained log corpus up to the default cap with mixed components/levels and run first-page filters plus literal text search concurrently with the pilot smoke workload. Require p95 first-page response within two seconds for 200 rows, live visibility within five seconds when healthy, bounded memory/disk, and responsiveness under a failed sink. Report actual corpus size, index/storage choice, sample count, hardware and ingestion/query/logging timings. Measure temporary DEBUG overhead separately without disabling redaction, auth or journal durability; saturation must be visible and bounded. No 10m/100m log-search or external telemetry infrastructure is required.

## Operational status additions

Expose PILOT-OPERATIONS-AND-RECOVERY.md backup age/last actual restore check, maintenance/update/rebuild phase, unresolved review counts, resume/catch-up state, disk thresholds and secret/retention failures through the same owner-scoped status service. Link to the narrow settings/review action, never an arbitrary shell/file interface. Do not log backup recovery material or repaired raw evidence. DIAG-07 runs with the strengthened smoke workload and default logging; no operational alert overrides the business truth/authorization contract.

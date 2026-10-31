# Local pilot — current delivery contract

Owner decision: first build, test and share a local application; learn from early users before deciding whether server hosting, SaaS or a native shell is useful. This supersedes the earlier automatic M0–M5 platform assignment. The active profile is `local_pilot` in ../delivery-profile.json. Stop after a verified pilot and handover; do not automatically implement deferred platform features.

## Intended first experience

Install documented prerequisites, start Blackbox on the user's Mac, save a generated personal access key, open the local browser UI, connect a source or run the example, watch actual import progress and obtain an evidence-backed Order-to-Cash answer. Subsequent opening uses a remembered, revocable local session. No domain, email signup, passkey, external identity provider or Blackbox-operated service is required. All persistent data stays in the local backend; configured providers and user-selected agents may require network access. Do not claim that data sent to an external agent remains offline.

One visible workspace and one human owner are created automatically. Separate local installations remain separate; each gets its own random credentials, volumes and ports. Retain tenant-scoped storage/services/Rust keys and real two-tenant adversarial tests so later expansion does not require rewriting the journal. Synthetic test tenants do not imply a workspace switcher, employee management or hosted SaaS UI in this release.

## Scope and sequence

| Milestone | Required result |
| --- | --- |
| P0 — smallest contract | Confirm environment, read references, choose supported dependencies, record the minimal schema/auth/Rust boundaries and begin implementation |
| P1 — local foundation | Working Compose backend, secure access-key setup, automatic owner/workspace, local web UI, append-only PostgreSQL journal, durable ingestion/outbox and Rust vertical slice |
| P2 — useful answers | Full Golden Scenario and all 24 positive/missing-data question contracts, journal/evidence UI, bounded RAM/cold access, restart recovery, import setup and truthful source health, EN/DE UI and landing page |
| P3 — connected pilot | Shopify/Shopify Payments outbound import/polling/reconciliation, named read-only agent keys and a working local MCP client/bridge, bank CSV and signed typed generic input; actual external access reported separately |
| P4 — handover and stop | Fresh install on a real Apple Silicon Mac, backup/restore, populated upgrade, local performance smoke and bounded-memory/crash tests, clean-checkout verification, screenshots, short tester guide, safe diagnostics and honest evidence report |

The primary deliverable is a local backend plus complete browser UI, started by a small wrapper. A native `.app`/DMG, Tauri shell, signing/notarization, remote desktop client and background OS-service installer are deferred. Closing the browser must not stop the supervised backend; an explicit stop must preserve durable data. Do not claim a dependency-free installer: show the required container runtime and supported versions. A small double-click launcher may be added only if useful and tested, without becoming a prerequisite for core functionality.

## Source scope

| Sources/producers | Pilot obligation |
| --- | --- |
| Replay, signed typed generic input, bank CSV, versioned policy and internal runtime | Complete persisted test/demo and supplemental-input paths; all 24 question examples still need generalized positive and missing-data tests |
| Shopify and Shopify Payments | First real provider adapters, with actual local outbound API coverage, historical import, reconciliation and honest permission/account limits |
| easybill, DHL and other catalogued providers | Deferred connector work, visible as planned. They are not quietly treated as live or complete; existing provider/retention research remains available |

Exact required capability IDs are in ../delivery-profile.json; all 127 source-capability rows and their history remain in INTEGRATIONS.md. The old `first_release` column records the larger platform plan, not the current pilot gate. A planned provider cannot supply data merely because a card exists. Synthetic/generic invoice, shipment, return and bank data can prove software behavior; they do not prove live easybill/DHL coverage. A real Shopify-only user may receive partial answers for unavailable invoicing, bank or warehouse facts. Explicitly show the missing source/input.

Use `local_standalone` only: initial import, outbound polling and reconciliation. No public callback, tunnel or gateway is provisioned or required for ingestion. A capability requiring unavailable webhook/history access is partial/unsupported with its exact limitation. Provider authorization is separate: some Shopify app/account flows may require provider-side configuration or redirect hosting. Research and test the supported read-only installation/token path; never promise every merchant can authorize with no prerequisites or bypass provider rules. Missing access blocks that live proof, not the synthetic build. No owner-supplied secret goes into Git/prompts/logs.

## Preserved engineering requirements

Keep the supplied design, English-default UI/landing with full German, all English engineering material, five journal tracks, append-only enforcement, exact financial/quantity rules, provenance, 24 question contracts plus complete authorized history traversal, and the TypeScript/Rust boundary. PostgreSQL remains canonical; compact RAM is rebuildable. Preserve commit-before-ack, outbox, idempotency, late/corrected events, fixed query cutoffs, safe snapshots/tail recovery, bounded memory and indexed cold reads. Never downgrade these because the app is local.

The 250k-entry smoke profile and local memory/recovery checks are required. Use the same generated corpus, resource limits and workload for A/B comparison; report actual Mac/container hardware and measurements. The 10m reference run and 100m experiment remain future performance gates, not current delivery work; no capacity claim is permitted without its actual evidence. A local application can be structurally ready for larger datasets without claiming those scales are verified.

## Deferred work is not an automatic next phase

Passkeys (including optional UI), key-pair enrollment, employee invitations/multiple owners, fine-grained dataset grants, public MCP OAuth, remote clients, SaaS signup/operator tools/billing, public-server profiles, webhook gateways, deployment migration, HA/replicated routing, native packaging, additional live providers and large capacity certification are deferred. Preserve extension interfaces and safe defaults, but do not build empty frameworks or dead-end placeholder screens for all of them.

Future notes live in future/. They are design options to revisit after feedback. Their old “required” wording does not expand the active profile. A later owner instruction must deliberately select the next scope. Do not automatically continue a former M4/M5 roadmap or deploy publicly when P4 finishes.

## Pilot acceptance and feedback

ACCEPTANCE.json retains prior cases with explicit applicability plus pilot-specific cases. Only IDs listed in delivery-profile.json gate this assignment; deferred cases remain `not_started`, not passed or silently waived. `reports/acceptance.json` must keep the distinction visible. Run the profile validator in CI and its `--release` variant when claiming pilot completion. Real provider/platform/client evidence remains required for an unqualified pilot-complete claim; an artifact awaiting that evidence can be handed over as a restricted preview with exact blockers. No provider credential is required to complete independent synthetic work.

Collect feedback with a short guide covering installation, saving/reusing the key, first import, one useful question, local agent connection, restart and restore. Provide explicit copy/export of sanitized diagnostics: app/version, OS/runtime, safe error IDs and counts; exclude raw orders, customer content and secrets. No automatic telemetry or uploading of business data. Record observed usability issues without claiming user tests that did not run.

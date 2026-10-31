# Implementation specifications

Read [LOCAL-PILOT.md](LOCAL-PILOT.md) and [delivery-profile.json](../delivery-profile.json) first. They define the current P0–P4 assignment and stop condition. Earlier platform features are deferred, not implicitly part of the local pilot.

| Contract | Current application |
| --- | --- |
| [FIRST-VERTICAL-SLICE.md](FIRST-VERTICAL-SLICE.md) | P1 persisted adapter-to-MCP/restart checkpoint and earliest authorized live Shopify proof |
| [PILOT-OPERATIONS-AND-RECOVERY.md](PILOT-OPERATIONS-AND-RECOVERY.md) | Daily backup/recovery, safe upgrades, owner repairs, Mac lifecycle/storage, secret/retention policy, stricter performance and model-free local question UX |
| [IDENTITY-ACCESS-AND-RECOVERY.md](IDENTITY-ACCESS-AND-RECOVERY.md) | One saved personal owner key, sessions, host-only reset and distinct read-only agents; Passkeys deferred |
| [JOURNAL-AND-MCP.md](JOURNAL-AND-MCP.md) | Database append-only journal, five tracks and full authorized business-history reads via local MCP |
| [PERFORMANCE-ARCHITECTURE.md](PERFORMANCE-ARCHITECTURE.md) / [benchmark contract](../benchmarks/performance-contract.json) | Rust/TypeScript boundary, durable consistency, bounded memory/cold reads and required smoke profile; 10m/100m deferred |
| [QUESTION-DATA-COVERAGE.md](QUESTION-DATA-COVERAGE.md), [CONNECTOR-CAPABILITIES.md](CONNECTOR-CAPABILITIES.md), [question-data-contracts.json](question-data-contracts.json) | Preserved 24 input/journal/RAM/query contracts and provider research; active source work is selected by the delivery profile |
| [WEB-DESKTOP-AND-DEPLOYMENT.md](WEB-DESKTOP-AND-DEPLOYMENT.md) | Local browser/Compose product, landing-page archive download/guide and real Mac install; native/public/remote delivery deferred |
| [SOURCE-SYNCHRONIZATION.md](SOURCE-SYNCHRONIZATION.md) | local_standalone backfill/poll/reconcile; other modes declared unsupported/deferred |
| [IMPORT-ONBOARDING-AND-DATA-READINESS.md](IMPORT-ONBOARDING-AND-DATA-READINESS.md) | Date selection, older open/related context, real counters and central Sources/answer readiness |
| [SYSTEM-AND-DIAGNOSTICS.md](SYSTEM-AND-DIAGNOSTICS.md) | Owner-only health/live log UI, filters/correlation, bounded retention/debug, outage CLI, safe export and DIAG-01–08 pilot gates |
| [WEBHOOK-GATEWAY.md](WEBHOOK-GATEWAY.md) | Explicit deferral; no public receiver is required for the pilot |

[INTEGRATIONS.md](../INTEGRATIONS.md) is the central source-by-source work list. [Its rules](../integrations/README.md) govern exact mappings, evidence and independent confirmation. The profile validator selects current rows without deleting future plans/history. All product/connector evidence starts unexecuted.

[future/](future/) preserves earlier platform designs and the exact baseline-v10 acceptance descriptions. Their old mandatory wording applies only to that prior reference and does not authorize new scope. Revisit them after actual user feedback and a new owner decision. Derive concise implementation specs/ADRs from the active contract and immediately implement a real persisted slice; planning frameworks are optional.

# Implementation specifications

The central implementation and evidence work list is [INTEGRATIONS.md](../INTEGRATIONS.md). Follow [its update and verification rules](../integrations/README.md); this specification supplies requirements, while the register owns source-capability progress and confirmation.

Read [JOURNAL-AND-MCP.md](JOURNAL-AND-MCP.md) first: it is the binding journal data-structure and complete authorized MCP read-access specification.

Read [PERFORMANCE-ARCHITECTURE.md](PERFORMANCE-ARCHITECTURE.md) and [the benchmark contract](../benchmarks/performance-contract.json) for the Rust engine, memory/consistency rules and measurable targets.

Read [QUESTION-DATA-COVERAGE.md](QUESTION-DATA-COVERAGE.md), [CONNECTOR-CAPABILITIES.md](CONNECTOR-CAPABILITIES.md) and [question-data-contracts.json](question-data-contracts.json) for all 24 input-to-answer paths, source-field candidates, journal families, RAM indexes and positive/missing-data examples. The public-documentation audit is not live integration proof. Update [question coverage](../reports/question-coverage.json) only with actual implementation evidence.

Derive milestone and feature specifications from the authoritative root brief and acceptance inputs. Each spec should name its user behavior, affected module contracts, tenant/data rules, acceptance IDs and executable verification approach. Add unresolved assumptions and the selected decision.

Keep specs short enough to implement; move immediately from the initial M0 contract to a working persisted slice. This folder is intentionally not populated with speculative application code. GitHub Spec Kit is optional and must not replace or weaken the supplied acceptance oracle.

## Web, desktop and synchronization

- [WEB-DESKTOP-AND-DEPLOYMENT.md](WEB-DESKTOP-AND-DEPLOYMENT.md): complete browser management, native Mac client, shared backend, profiles, installation and fenced workspace migration.
- [SOURCE-SYNCHRONIZATION.md](SOURCE-SYNCHRONIZATION.md): per-capability initial import, cursors, polling, webhooks, reconciliation, mode coverage and freshness.
- [WEBHOOK-GATEWAY.md](WEBHOOK-GATEWAY.md): optional-use public receiver, durable queue and backend-initiated delivery into private networks.

These are binding full-release requirements. The native client and gateway may remain open at the earlier comparison checkpoint; no provider capability is verified by this specification.

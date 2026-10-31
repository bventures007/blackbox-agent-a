# Implementation specifications

Read [JOURNAL-AND-MCP.md](JOURNAL-AND-MCP.md) first: it is the binding journal data-structure and complete authorized MCP read-access specification.

Read [PERFORMANCE-ARCHITECTURE.md](PERFORMANCE-ARCHITECTURE.md) and [the benchmark contract](../benchmarks/performance-contract.json) for the Rust engine, memory/consistency rules and measurable targets.

Read [QUESTION-DATA-COVERAGE.md](QUESTION-DATA-COVERAGE.md), [CONNECTOR-CAPABILITIES.md](CONNECTOR-CAPABILITIES.md) and [question-data-contracts.json](question-data-contracts.json) for all 24 input-to-answer paths, source-field candidates, journal families, RAM indexes and positive/missing-data examples. The public-documentation audit is not live integration proof. Update [question coverage](../reports/question-coverage.json) only with actual implementation evidence.

Derive milestone and feature specifications from the authoritative root brief and acceptance inputs. Each spec should name its user behavior, affected module contracts, tenant/data rules, acceptance IDs and executable verification approach. Add unresolved assumptions and the selected decision.

Keep specs short enough to implement; move immediately from the initial M0 contract to a working persisted slice. This folder is intentionally not populated with speculative application code. GitHub Spec Kit is optional and must not replace or weaken the supplied acceptance oracle.

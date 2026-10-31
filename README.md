# Blackbox — business flight recorder

An independent implementation workspace for a commerce business flight recorder: evidence from source systems becomes traceable facts, commitments, movements and reservations, available to people and agents through the same business services.

**Status: prepared build assignment. Production application development has not started.** The included static prototype is the visual reference, with simulated data. Acceptance specifications are supplied; executable product tests still need to be built.

**For source-by-source progress, open [the central integration register](INTEGRATIONS.md): required data, five journal tracks, implementation, tests, live verification and who confirmed the work.**

## Start here

Open this repository in your coding agent, then give it this prompt:

```text
GO. Read AGENTS.md and START-HERE.md. Implement Blackbox according to BUILD-PROMPT-EN.txt, preserving the supplied design. Work through M0–M5, record the comparison checkpoint after M0–M3 plus local installation, and verify against ACCEPTANCE.json. Keep docs/status.md, reports/acceptance.json and the central INTEGRATIONS.md register current with actual evidence. Deliver running software and reproducible evidence; do not stop at a plan. Complete independent work when external access is missing and report those blockers honestly.
```

For a Codex Goal, use the objective in [GOAL.txt](GOAL.txt). The exact workflow and an optional checkpoint-only scope are explained in [START-HERE.md](START-HERE.md).

## Contents

| File | Purpose |
| --- | --- |
| [INTEGRATIONS.md](INTEGRATIONS.md) | Central human-readable work list: 22 sources/internal producers, 127 capability rows, ownership and evidence |
| [integrations/README.md](integrations/README.md) | Update workflow, six implementation steps, evidence requirements and enforced checks |
| [AGENTS.md](AGENTS.md) | Working rules, reading order and boundaries |
| [START-HERE.md](START-HERE.md) | Launch instructions, scope and handover |
| [BUILD-PROMPT-EN.txt](BUILD-PROMPT-EN.txt) | Full implementation contract |
| [specs/JOURNAL-AND-MCP.md](specs/JOURNAL-AND-MCP.md) | Append-only data structure and full authorized MCP read contract |
| [specs/PERFORMANCE-ARCHITECTURE.md](specs/PERFORMANCE-ARCHITECTURE.md) | Rust engine, memory limits, durable consistency and recovery |
| [specs/QUESTION-DATA-COVERAGE.md](specs/QUESTION-DATA-COVERAGE.md) | All 24 questions mapped to inputs, journal families, RAM projections, queries and test examples |
| [specs/CONNECTOR-CAPABILITIES.md](specs/CONNECTOR-CAPABILITIES.md) | Reviewed provider candidates, supplemental data and unresolved integration proof |
| [specs/question-data-contracts.json](specs/question-data-contracts.json) | Machine-readable field/data/query crosswalk and 48 minimum acceptance examples |
| [reports/question-coverage.json](reports/question-coverage.json) | Per-question implementation and verification register; all runtime proof pending |
| [benchmarks/performance-contract.json](benchmarks/performance-contract.json) | Measurable 250k / 10m / 100m workload profiles |
| [ARCHITECTURE-EN.txt](ARCHITECTURE-EN.txt) | Architecture and delivery approach |
| [ACCEPTANCE.json](ACCEPTANCE.json) | 53 acceptance cases with release gates |
| [GOLDEN-ORDER-TO-CASH.json](GOLDEN-ORDER-TO-CASH.json) | Synthetic business cycle: 19 events, 11 checkpoints |
| [reference/questions.json](reference/questions.json) | 24 questions in six Order-to-Cash groups |
| [reference/prototype/](reference/prototype/) | Original visual and interaction reference |
| [reference/screenshots/README.md](reference/screenshots/README.md) | Visual catalogue: 67 desktop/mobile captures, interaction states and coverage boundaries |
| [docs/status.md](docs/status.md) | Durable implementation progress and next action |
| [reports/acceptance.json](reports/acceptance.json) | Honest per-case execution status, initially not started |
| [features/](features/) | Plain-language feature ideas for future expansion |
| [SCORECARD.json](SCORECARD.json) | Common comparison criteria |
| [REVIEW-PROMPT-EN.txt](REVIEW-PROMPT-EN.txt) | Independent review assignment |

## Target product

- One modular TypeScript/Rust product: web/API/connectors in TypeScript; canonical business reducers, compact RAM projections and fast queries in a Rust engine; PostgreSQL provides durability and indexed cold access.
- Hosted multi-tenant SaaS, self-hosted Linux and local Mac through the same Docker Compose-based release.
- All engineering material in English; application UI and landing page in English by default, with complete German localization.
- Order-to-Cash first, a database-enforced append-only journal, evidence-linked answers, actual tenant isolation and read-only MCP over all authorized business records and histories.
- An offline synthetic workflow first; Shopify/Shopify Payments, easybill and DHL as the initial real connector scope, subject to actual provider access.
- Founder-friendly extension points for connectors, questions and isolated experiments.

The full contract specifies details and exceptions. GitHub Spec Kit is optional; the repository already contains the requirements and acceptance baseline. Do not spend the implementation run installing a planning framework.

## Language policy

Use English for all requirements, documentation, architecture decisions, feature briefs, agent instructions, code identifiers, comments, tests, logs, API/MCP contracts and handover reports. Only the application UI and landing page require both English (default) and complete German localization. Keep machine-readable identifiers stable in English; localize product-facing text through locale resources.

The unchanged prototype and screenshots contain original German UI copy. Use them as visual references; the production UI and landing page must implement both locales. The canonical question specification in reference/questions.json is English.

## Preview the existing design

With Python 3 installed, from the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory reference/prototype
```

Open `http://127.0.0.1:4173/` or `http://127.0.0.1:4173/#app/agents`. This serves the static design reference only. The production `./blackbox` commands described in the brief are not implemented yet.

Start with the [visual reference catalogue](reference/screenshots/README.md): all six existing top-level views, onboarding, evidence drawers, invoice/payment lifecycles, 24 expanded Order-to-Cash questions and representative mobile views. The catalogue distinguishes existing design references from product views that still need to be designed. It includes capture recipes and checksums; these are reference assets, not product-test evidence.

## Independent comparison

Both repositories share the same input commit. The current English engineering baseline is tagged `baseline-v7`; earlier baseline tags preserve the preparation history. Build only in your assigned repository. Do not inspect or import the other agent's implementation before the independent comparison. Use separate development databases, volumes, credentials and ports; never share writable runtime state. See [docs/comparison.md](docs/comparison.md).

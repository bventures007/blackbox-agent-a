# Blackbox — business flight recorder

An independent implementation workspace for a commerce business flight recorder: evidence from source systems becomes traceable facts, commitments, movements and reservations, available to people and agents through the same business services.

**Status: prepared build assignment. Production application development has not started.** The included static prototype is the visual reference, with simulated data. Acceptance specifications are supplied; executable product tests still need to be built.

## Start here

Open this repository in your coding agent, then give it this prompt:

```text
GO. Read AGENTS.md and START-HERE.md. Implement Blackbox according to BUILD-PROMPT-EN.txt, preserving the supplied design. Work through M0–M5, record the comparison checkpoint after M0–M3 plus local installation, and verify against ACCEPTANCE.json. Keep docs/status.md and reports/acceptance.json current. Deliver running software and reproducible evidence; do not stop at a plan. Complete independent work when external access is missing and report those blockers honestly.
```

For a Codex Goal, use the objective in [GOAL.txt](GOAL.txt). The exact workflow and an optional checkpoint-only scope are explained in [START-HERE.md](START-HERE.md).

## Contents

| File | Purpose |
| --- | --- |
| [AGENTS.md](AGENTS.md) | Working rules, reading order and boundaries |
| [START-HERE.md](START-HERE.md) | Launch instructions, scope and handover |
| [BUILD-PROMPT-EN.txt](BUILD-PROMPT-EN.txt) | Full implementation contract |
| [ARCHITECTURE-DE.txt](ARCHITECTURE-DE.txt) | Architecture and approach, explained in German |
| [ACCEPTANCE.json](ACCEPTANCE.json) | 43 acceptance cases with release gates |
| [GOLDEN-ORDER-TO-CASH.json](GOLDEN-ORDER-TO-CASH.json) | Synthetic business cycle: 19 events, 11 checkpoints |
| [reference/questions.json](reference/questions.json) | 24 questions in six Order-to-Cash groups |
| [reference/prototype/](reference/prototype/) | Original visual and interaction reference |
| [reference/screenshots/](reference/screenshots/) | Reference screenshots |
| [docs/status.md](docs/status.md) | Durable implementation progress and next action |
| [reports/acceptance.json](reports/acceptance.json) | Honest per-case execution status, initially not started |
| [features/](features/) | Plain-language feature ideas for future expansion |
| [SCORECARD.json](SCORECARD.json) | Common comparison criteria |
| [REVIEW-PROMPT-EN.txt](REVIEW-PROMPT-EN.txt) | Independent review assignment |

## Target product

- One TypeScript modular monolith, with web/API/worker entrypoints, PostgreSQL and a shared domain model.
- Hosted multi-tenant SaaS, self-hosted Linux and local Mac through the same Docker Compose-based release.
- English by default; complete German translation.
- Order-to-Cash first, evidence-linked answers, actual tenant isolation and read-only MCP.
- An offline synthetic workflow first; Shopify/Shopify Payments, easybill and DHL as the initial real connector scope, subject to actual provider access.
- Founder-friendly extension points for connectors, questions and isolated experiments.

The full contract specifies details and exceptions. GitHub Spec Kit is optional; the repository already contains the requirements and acceptance baseline. Do not spend the implementation run installing a planning framework.

## Preview the existing design

With Python 3 installed, from the repository root:

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory reference/prototype
```

Open `http://127.0.0.1:4173/` or `http://127.0.0.1:4173/#app/agents`. This serves the static design reference only. The production `./blackbox` commands described in the brief are not implemented yet.

## Independent comparison

Both repositories start from the same commit and input files. Build only in your assigned repository. Do not inspect or import the other agent's implementation before the independent comparison. Use separate development databases, volumes, credentials and ports; never share writable runtime state. See [docs/comparison.md](docs/comparison.md).

## Kurz auf Deutsch

Dieses Repository ist fertig vorbereitet, damit ein Code-Agent direkt mit der Umsetzung starten kann. Gib jedem Agenten genau eines der beiden Repositories und denselben Startauftrag oben. Die vollständige Beschreibung liegt bereits im Repository; du musst den bisherigen Chat nicht kopieren.

Der erste gemeinsame Prüfpunkt ist M0–M3 einschließlich lokaler Installation. Danach geht der vollständige Auftrag mit echten Anbindungen und Betriebshärtung weiter. Für einen ausdrücklich kürzeren ersten Vergleich gibt es in START-HERE.md einen separaten Auftrag.

Die Software ist hier noch nicht gebaut. Testnachweise, Live-Anbindungen und Plattformtests dürfen erst nach tatsächlicher Prüfung als erfolgreich gelten.

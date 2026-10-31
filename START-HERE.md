# Start the independent Blackbox build

This repository contains the full context needed to start. It is an implementation assignment for one agent, not a request to generate another proposal.

## Owner: how to start

1. Give agent A its repository and agent B its repository. Each needs its own checkout and write access to that assigned repository. Do not share a working directory or database.
2. Open or clone the assigned repository in the coding environment. A GitHub link alone does not grant a coding service access to a private repository; select or authorize that repository in that service if required.
3. Paste the ordinary GO prompt from README.md. For Codex with Goal support, select `/goal` in the composer and use the text in GOAL.txt as the objective. In an interactive CLI, `/goal <objective>` is also supported. This is a chat command, not a shell command. See the [official app instructions](https://learn.chatgpt.com/docs/reference/slash-commands) and [Goals guide](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex).
4. Give both agents comparable resource limits and test access. Do not share credentials in prompts or Git. Initial synthetic work needs no merchant account or LLM key.
5. Review the saved comparison checkpoint and final acceptance report. Use REVIEW-PROMPT-EN.txt for an independent technical review.

Nothing starts automatically just because this repository exists. The owner launches each build. No new agent run is started by this seed.

## Language policy

Use English for all requirements, documentation, architecture decisions, feature briefs, agent instructions, code identifiers, comments, tests, logs, API/MCP contracts and handover reports. Only the application UI and landing page require both English (default) and complete German localization. Keep machine-readable identifiers stable in English; localize product-facing text through locale resources. Preserve the original German reference UI and screenshots as design inputs; implement English and German product locales.

## Agent: first actions

Read the files in AGENTS.md's order, including the binding specs/JOURNAL-AND-MCP.md and specs/PERFORMANCE-ARCHITECTURE.md contracts, inspect the local visual reference, and check the environment. Record versions and available Docker/database/browser capabilities in docs/build-environment.md. Make the milestone/task checklist concrete in docs/status.md, document necessary ADRs, then immediately start implementing the smallest complete persisted path.

Use reference/screenshots/README.md as the visual reading guide. It links all implemented pages, key dialog and lifecycle states, the 24 expanded questions and mobile views, and identifies product areas with no existing screen design. Inspect the original prototype for interactions; screenshots are not executable product acceptance evidence.

Use specs/QUESTION-DATA-COVERAGE.md and specs/question-data-contracts.json to implement complete vertical slices: actual input fields → committed journal → Rust projection → shared query → API/MCP evidence. The capability audit identifies supplemental inputs and provider gaps. Maintain reports/question-coverage.json; all 24 positive paths must work with isolated synthetic data even when live access remains blocked.

The default scope is the full BUILD-PROMPT-EN.txt, milestones M0–M5. Preserve the checkpoint after M0–M3 plus local installation for comparison, then continue independent work on real adapters and operations. If a provider account is missing, build and contract-test what can be verified; document the missing live verification without presenting it as success. A complete release cannot be asserted while applicable release gates remain open.

## Milestones and visible results

| Milestone | Concrete result |
| --- | --- |
| M0 | Written product/architecture contract, ADRs, threat model and acceptance mapping; implementation begins |
| M1 | Real auth, two isolated tenants, PostgreSQL, durable ingestion, workers, Rust engine vertical slice and the core UI |
| M2 | Full Golden Scenario through Rust reducers, bounded RAM state, snapshots/restarts and English/German UI and landing page |
| M3 | Real scoped MCP with full authorized journal/history traversal, bounded structured queries, all 24 query contracts, evidence links and explicit missing-data results |
| Comparison checkpoint | M0–M3 plus a usable local installer, reproducible tests and a recorded commit |
| M4 | Shopify/Shopify Payments, easybill and DHL adapter work, tests and honest live-access status |
| M5 | Release artifacts, Linux/Mac/hosted profiles, recovery/upgrade/security, 10m benchmark evidence and a separate 100m capacity experiment |

At the checkpoint, create reports/checkpoint.md with exact commit, start/test commands, environment, screenshots, acceptance status and limitations. Do not conflate this checkpoint with customer-production readiness.

## Completion evidence

Deliver executable source, locked dependencies, migrations, container/Compose release setup, the actual `./blackbox` wrapper, tests/CI, operating instructions and extension guides. Demonstrate a fresh install, the real persisted Order-to-Cash replay, tenant isolation, UI/MCP consistency and recovery. Maintain every acceptance ID in reports/acceptance.json with observed evidence.

For every environment or provider you could not exercise, state the exact prerequisite and the smallest next verification step. A mock or an arm64 image build is not a live-provider or real-Mac test.

## Optional: stop at the first comparison checkpoint

Use this prompt instead of the default full-build prompt only when the owner wants to choose a foundation before funding the remaining scope:

```text
GO. Read AGENTS.md and START-HERE.md. Implement BUILD-PROMPT-EN.txt through M0–M3 plus a working local installer. Verify the applicable core acceptance cases, record reports/checkpoint.md and reports/acceptance.json, then stop at that checkpoint. M4–M5 remain explicitly unfinished. Preserve the supplied design and use separate runtime state. Do not stop after planning or scaffolding.
```

For Goal-capable tools, the same text can be used as the objective. Use the same scope for both agents.

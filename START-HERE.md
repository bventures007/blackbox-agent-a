# Start the independent local pilot build

The current assignment is **P0–P4 local pilot, then handover and stop**. The owner wants local testing and early-user feedback before choosing a hosting or distribution strategy. The former automatic M0–M5 assignment is superseded.

## Start

Give each coding agent only its assigned repository and an independent checkout/runtime. Paste:

```text
GO. Read AGENTS.md, START-HERE.md, delivery-profile.json and BUILD-PROMPT-EN.txt. Implement the local pilot P0–P4, preserving the supplied design. Verify the active acceptance cases, keep actual evidence and the central integration register current, and deliver a runnable local application plus reports/checkpoint.md. Stop at the pilot handover; defer Passkeys, SaaS, public hosting, gateways and native packaging. Complete independent work when external access is missing and report blockers honestly. Do not stop at a plan or mockup.
```

For a Goal-capable coding tool use GOAL.txt as the objective. This seed does not start an agent automatically. A GitHub URL alone does not grant a coding service access to a private repo; authorize that repo in the chosen service. Do not paste credentials into prompts.

## Read and begin

Follow AGENTS.md's reading order. Read specs/LOCAL-PILOT.md and specs/IDENTITY-ACCESS-AND-RECOVERY.md before copying any earlier authentication or platform assumption. Inspect reference/screenshots/README.md and reference/prototype/. Record available tools/platforms in docs/build-environment.md, choose the minimum ADRs, and start a persisted slice. Use English for engineering; UI and landing page use English by default plus complete German.

The first user experience is: install prerequisites, start locally, save one personal access key, open the browser, connect a source or run the example, and ask an evidence-backed question. One owner/workspace is automatic. Separate agent keys grant business read access. No Passkey, email signup, domain, employee management or native shell is required.

## Milestones

| Milestone | Result |
| --- | --- |
| P0 | Environment, minimal contracts and implementation started |
| P1 | Local setup/key/session, workspace, PostgreSQL/outbox/worker/Rust and basic recorder |
| P2 | Golden Scenario, 24 question paths, evidence, EN/DE UI/landing, import/readiness and RAM/restart correctness |
| P3 | Shopify/Shopify Payments local import/poll/reconcile, supplemental producers and local read-only MCP |
| P4 | Fresh real-Mac install, backup/restore/upgrade, smoke/memory tests, safe diagnostics, tester guide and evidence-backed handover |

The required capability IDs and acceptance IDs are explicit in delivery-profile.json. The old `first_release` labels in the broad source catalogue do not expand this selection. Keep all future rows and gates visible and unstarted; do not mark them passed or proceed automatically. Missing account/platform access blocks the affected proof, not unrelated development. A restricted preview with pending live tests must be labelled accordingly.

## Completion

Deliver actual code, dependencies, migrations, versioned local Compose/wrapper, tests/CI and documentation. A real Apple Silicon run is distinct from building an arm64 image. A protocol test is distinct from an actual MCP-client connection. No mock proves provider access. Preserve all journal, correctness, isolation and evidence requirements selected for the pilot.

Use scripts/validate-delivery-profile.py in ordinary CI and its --release gate before claiming the pilot complete. Update reports/checkpoint.md with commit, commands, resource conditions, screenshots, verified scope and blockers. Give the owner the local result and feedback guide, then stop. Later product scope needs a new owner decision.

# Blackbox — local business flight recorder

A local commerce flight recorder: source evidence becomes linked facts, commitments, movements and reservations, with trustworthy answers for people and read-only agents.

**Status: prepared build assignment. Product implementation has not started.** The static prototype is the design reference, with simulated data. The current assignment is a **local pilot P0–P4, then handover and stop for feedback**. The previous automatic SaaS/server/native/gateway roadmap is deferred.

## Start the build

Give each coding agent its assigned repository and paste:

```text
GO. Read AGENTS.md, START-HERE.md, delivery-profile.json and BUILD-PROMPT-EN.txt. Implement the local pilot P0–P4, preserving the supplied design. Verify the active acceptance cases, keep actual evidence and the central integration register current, and deliver a runnable local application plus reports/checkpoint.md. Stop at the pilot handover; defer Passkeys, SaaS, public hosting, gateways and native packaging. Complete independent work when external access is missing and report blockers honestly. Do not stop at a plan or mockup.
```

Use [GOAL.txt](GOAL.txt) as the objective in a Goal-capable agent. [START-HERE.md](START-HERE.md) explains scope and completion. No agent is started automatically. Both repos receive identical inputs; work only in the assigned repo with separate ports, volumes, databases and secrets.

## Pilot experience

- Download the versioned Mac installation archive from the landing page, follow its English/German guide, start the local backend and open the browser; no domain, email signup or external identity service.
- Save one generated personal access key. Remembered protected sessions avoid repeated entry; host-only reset preserves business data.
- One owner/workspace is automatic. Agents get separate named, revocable read-only keys and a local MCP connection.
- Connect Shopify/Shopify Payments through supported outbound import/polling/reconciliation; run the full synthetic scenario through replay/generic/bank/policy/runtime inputs.
- See actual date-based import progress, source health, the five journal tracks, evidence and all 24 Order-to-Cash questions. Live answers remain partial when prerequisite sources are missing.
- See measured runtime health and filter live/history logs in System & Diagnostics; follow source/run context, briefly enable safe debug and inspect logs even when the UI is unavailable.
- Test restart, backup/restore, upgrade, bounded memory and actual local latency. Share a runnable local pilot and short feedback guide.

The TypeScript/Rust/PostgreSQL architecture, append-only journal, exact business logic and tenant-safe foundation remain. Passkeys (even optional), employee invitations, SaaS, public servers/gateways, native packaging and larger capacity certification are later choices. The local browser product is the first deliverable; its container-runtime prerequisites must be explicit.

## Read the contracts and progress

| File | Purpose |
| --- | --- |
| [specs/LOCAL-PILOT.md](specs/LOCAL-PILOT.md) | Current scope, P0–P4, sources, acceptance and stop condition |
| [delivery-profile.json](delivery-profile.json) | Machine-readable 71 active cases, 37 deferred cases and 68 required capability rows |
| [BUILD-PROMPT-EN.txt](BUILD-PROMPT-EN.txt) / [AGENTS.md](AGENTS.md) | Implementation assignment and agent rules |
| [specs/IDENTITY-ACCESS-AND-RECOVERY.md](specs/IDENTITY-ACCESS-AND-RECOVERY.md) | Personal login key, sessions, host reset and separate read-only agents |
| [specs/WEB-DESKTOP-AND-DEPLOYMENT.md](specs/WEB-DESKTOP-AND-DEPLOYMENT.md#landing-page-download-and-first-install) | Landing download, versioned Mac installation archive, release metadata and actual first-install proof |
| [specs/SYSTEM-AND-DIAGNOSTICS.md](specs/SYSTEM-AND-DIAGNOSTICS.md) | Measured health, filterable logs, bounded debug/retention, outage CLI and explicit sanitized export |
| [INTEGRATIONS.md](INTEGRATIONS.md) / [integrations/README.md](integrations/README.md) | Central 127-row source/capability register, work history and independent evidence; current selection comes from the delivery profile |
| [specs/README.md](specs/README.md) | Journal, performance, source mapping, synchronization and import/readiness contracts |
| [ACCEPTANCE.json](ACCEPTANCE.json) / [reports/acceptance.json](reports/acceptance.json) | 108 specifications/results, explicitly split into active pilot and deferred future work; no product case has run |
| [GOLDEN-ORDER-TO-CASH.json](GOLDEN-ORDER-TO-CASH.json) / [reference/questions.json](reference/questions.json) | Preserved business oracle and 24 questions |
| [ARCHITECTURE-EN.txt](ARCHITECTURE-EN.txt) | Local modular foundation and future extension boundaries |
| [docs/status.md](docs/status.md) / [docs/comparison.md](docs/comparison.md) | Actual progress and fair comparison protocol |
| [specs/future/](specs/future/) | Preserved previous platform options, not automatic implementation requirements |
| [reference/screenshots/README.md](reference/screenshots/README.md) / [reference/prototype/](reference/prototype/) | Complete 67-capture design catalogue and interactive reference |

Engineering documentation/code/tests/logs/contracts are English. Application UI and landing page default to English with complete German localization. The original German prototype/screenshots remain unchanged reference assets.

## Preparation checks

```sh
python3 scripts/validate-question-catalogue.py
python3 scripts/integration-register.py check
python3 scripts/validate-delivery-profile.py
python3 -m unittest discover -s scripts/tests -p 'test_*.py'
```

These check the specification/register tooling, not a running product. At actual pilot handover, also run `python3 scripts/validate-delivery-profile.py --release`: active product evidence and selected capability approvals are required. The broader register `--release` remains a future-platform check. Both release checks intentionally fail on this unimplemented seed.

## Preview the reference

```sh
python3 -m http.server 4173 --bind 127.0.0.1 --directory reference/prototype
```

Open `http://127.0.0.1:4173/` or `http://127.0.0.1:4173/#app/agents`. This serves the unchanged static reference only. The production `./blackbox` wrapper/access-key login is not implemented yet. Inspect the screenshot catalogue for all pages/states and missing product views; screenshots are not acceptance proof.

The shared input tag is `baseline-v13`; older tags preserve earlier decisions. Compare both builds at the local pilot scope using [REVIEW-PROMPT-EN.txt](REVIEW-PROMPT-EN.txt) and [SCORECARD.json](SCORECARD.json). GitHub Spec Kit is optional and must not delay implementation.

# Blackbox local pilot — product

Status: implementation in progress (P1/P2). This document describes what the running software does; `docs/status.md` records what has been verified.

## What it is

A local commerce flight recorder for one owner and one workspace. Source observations (Shopify, signed generic producers, bank statements, the owner's versioned rules, a synthetic replay) become an append-only five-track journal in PostgreSQL. A Rust engine derives facts, commitments, movements and reservations with one set of deterministic rules, keeps bounded in-memory projections and answers the 24 Order-to-Cash questions with calculation, evidence entry ids, cutoffs, coverage and missing inputs. The browser UI (English default, complete German) and a local MCP bridge for the owner's own agents use the same authorized query service.

## First experience

1. Landing page (`/landing/`) → download the versioned Mac archive → EN/DE guide.
2. `./blackbox doctor` → `./blackbox setup` (prints the personal access key once) → `./blackbox up` → `http://127.0.0.1:19080/`.
3. Sign in with the key (optional "stay signed in", 30 days absolute / 7 days idle).
4. Sources: connect Shopify with a custom-app token and a history plan (last 30 days default), import a bank CSV, record workspace rules, or run the synthetic Order-to-Cash example (labelled synthetic).
5. Questions & Answers: pick one of 24 templates, add typed parameters, read the answer with calculation, evidence, coverage and cutoff. No language model is involved.
6. Agents & MCP: create named read-only agent keys and connect a local MCP client through the stdio bridge.
7. System & Diagnostics: measured health, filterable retained logs, 15-minute debug windows, explicit sanitized export.

## Areas and their state

| Area | Implemented | Notes |
| --- | --- | --- |
| Landing + install guide (EN/DE) | yes | release manifest driven; honest unavailable state until an artifact exists |
| Access key sign-in, remembered sessions, rotation, host reset | yes | `./blackbox reset-access` is host-only |
| Recorder (five tracks, counters, engine phase) | yes | live polling every 5 s |
| Sources: Shopify (fixture-proven), replay, bank CSV, rules, generic producer | yes | Shopify live proof blocked without an authorized store; Shopify Payments ledger/payouts adapter pending |
| 24 question templates with typed parameters | yes | deterministic Rust query crate |
| Journal with drawer (payload, links, provenance) | yes | stable snapshot pagination |
| Needs review | yes | quarantined inputs, conflicts, decisions append to the journal |
| Agents & MCP (keys, bridge, tool list) | yes | SDK stdio bridge; HTTP transport optional and off by default |
| System & Diagnostics | yes | health cards, log filters/live/pause, debug windows, export, retention |
| Settings | yes | workspace name, locale, key rotation, lifecycle explanation |
| Backups & recovery, upgrade | in progress (P4) | wrapper commands currently report "not available in this build" |
| Planned providers (easybill, DHL, …) | visible as planned | no connector; answers stay partial |

## Honest limits

- A fixture-proven Shopify path is synthetic; live coverage needs an authorized development store (SLICE-02 blocked_external).
- Shopify Payments ledger/payout/dispute import is not yet implemented in the worker (P3).
- Holds, balance breakdown and chargeback debit postings are not available from the pinned Shopify API; related answers are partial by design.
- The engine answers `as_of` for entity state; intents answer `latest_committed`/`at_least_cursor`.

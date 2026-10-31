# In-progress P1 checkpoint — not P4 handover

Baseline: baseline-v14. Tested source: `dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127`. Branch: `codex/local-pilot`.

The narrow synthetic SLICE-01 path passed on this Apple Silicon Mac with native PostgreSQL 18.4, Node 25.9.0 and Rust 1.90.0. See [persisted evidence](runs/p1-dd0998e/persisted-slice.json) and [client/browser/outage checks](runs/p1-dd0998e/additional-checks.json). Actual SDK and MCP Inspector calls read persisted values. Restart and corrupt/deleted projection recovery retained values and provenance. No demo reseeding occurs during recovery.

Start/test commands and isolated ports are in [development instructions](../docs/development.md). The developer fallback is separate from release installation proof. Journal data and secrets persist under the protected local runtime; no customer data was imported.

P2–P4 remain in progress. The 24 questions, full Golden flow, source lifecycle, reference UI, package, backup/restore/upgrade and stronger performance/diagnostic gates are not yet delivered or certified. No independent capability review exists.

External blockers: authorized Shopify test-store/token/grants and eligible Shopify Payments account are unavailable. SLICE-02 remains blocked_external. Docker images built, but this Mac's ordinary Docker containers remained created; Compose startup and browser-download installation are unverified. No global Docker reset or competing runtime was touched.

This is a progress checkpoint, not a release or pilot-complete claim. Continue independent implementation through P4 and preserve all acceptance requirements.

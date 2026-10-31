# In-progress local pilot checkpoint — not P4 handover

Baseline: baseline-v14. Tested source: `dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127`. Branch: `codex/local-pilot`.

The narrow synthetic SLICE-01 path passed on this Apple Silicon Mac with native PostgreSQL 18.4, Node 25.9.0 and Rust 1.90.0. See [persisted evidence](runs/p1-dd0998e/persisted-slice.json) and [client/browser/outage checks](runs/p1-dd0998e/additional-checks.json). Actual SDK and MCP Inspector calls read persisted values. Restart and corrupt/deleted projection recovery retained values and provenance. No demo reseeding occurs during recovery.

Start/test commands and isolated ports are in [development instructions](../docs/development.md). The developer fallback is separate from release installation proof. Journal data and secrets persist under the protected local runtime; no customer data was imported.

P2–P4 remain in progress. Golden and all 24 question paths have the executed checkpoints below. Source lifecycle, full UI acceptance, package, backup/restore/upgrade and stronger performance/diagnostic gates remain incomplete. No independent capability review exists.

External blockers: authorized Shopify test-store/token/grants and eligible Shopify Payments account are unavailable. SLICE-02 remains blocked_external. Docker images built, but this Mac's ordinary Docker containers remained created; Compose startup and browser-download installation are unverified. No global Docker reset or competing runtime was touched.

This is a progress checkpoint, not a release or pilot-complete claim. Continue independent implementation through P4 and preserve all acceptance requirements.

## P2 progress: Golden lifecycle

Tested commit `2e8094402f642e534e432fb386e966912023b69c` passes the complete Golden checkpoint oracle and scaled variant, with evidence resolution and duplicate/restart/corrupt/twice-empty projection recovery. Command: `python3 scripts/verify-golden.py --output .runtime/golden-evidence.json`. Evidence: [Golden run](runs/golden-2e80944/result.json). This does not certify all 24 questions or P4.

The 24-question checkpoint passed on clean `3ced26bb56543703e1d05e8719e35f2d537f2b45`: `python3 scripts/verify-questions.py --output .runtime/questions-evidence.json`, followed by Golden and first-slice regressions. Evidence: reports/runs/questions-3ced26b. This is still an in-progress implementation checkpoint, not the P4 handover.

React/Vite browser increment: clean `fcd72d055ab9211369decc96c2c7cbb0e04e915a`; commands, runtime, actual browser/MCP results and screenshots in reports/runs/ui-fcd72d0. All 24 browser template answers matched the persisted query result. This remains an in-progress checkpoint.

The questions-v2 scope refinements passed at `4e9edcffbfd6716d568cd618e69feea8f7beea5f`; persisted recovery evidence is in reports/runs/questions-4e9edcf. Source and operational workflows remain active implementation work.

The scheduled source operations increment adds fixed date plans, encrypted credentials, lease fencing, logical cohorts and bilingual setup for Shopify orders/payments/refunds. Synthetic pre-commit pipeline/restart/MCP and browser checks passed; clean committed reproduction remains pending at this note. This is not a P4 handover or live-provider certification.

Clean a5fc0f82c15729ff3a30ca7317a72c494790412d passed the scheduled-source subset (HTTP/PostgreSQL/Rust/API/SDK MCP, restart, EN/DE Chrome and real background worker), all 24 question regressions, Golden and the explicit native first-slice regression. Evidence: reports/runs/sources-a5fc0f8. The default Compose slice attempt was canceled while Docker remained blocked; no Compose pass is asserted. Inspection identified a same-provider-revision changed-content identity edge case, which is the next source correction. No new full product acceptance or independent approval is claimed.

The provider-revision conflict correction is implemented: same-revision changed content is quarantined, old identities remain replay-compatible, and unresolved health gaps survive later empty checks. Pre-commit API/PostgreSQL/Rust/actual SDK MCP checks passed; the next clean-commit run will provide durable evidence. No additional acceptance gate or independent review is claimed.

Clean 113ea876e5139d2b5d266be7955d547132e42724 passed source conflict/health, all 24 questions and their cold/security adversaries, Golden and the native first-slice regressions. Evidence: reports/runs/source-conflicts-113ea87. Changed content at the same provider revision stays quarantined; an empty later check does not erase its unresolved health gap. Live access, other selected adapters, complete operational/distribution/performance gates and independent review remain open.

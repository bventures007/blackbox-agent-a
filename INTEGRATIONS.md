# Integration implementation register

> Generated from integrations/register.json, integrations/history.jsonl and the data contracts. Do not edit this view by hand.

**22 sources/internal producers · 127 capability rows · 0 independently approved.**

Prepared on 2026-10-31T11:30:02Z by Codex assistant (repository preparation). Progress is derived from the recorded work history.

This is the central work list. Planned support is not a working connection. An approval applies only to the explicit field subset, source revision and test environment recorded below. Partial coverage never becomes a complete business answer.

[How to use and update this register](integrations/README.md) · [Append-only work history](integrations/history.jsonl) · [Machine-readable plan](integrations/register.json)

[Historical import and data readiness contract](specs/IMPORT-ONBOARDING-AND-DATA-READINESS.md): date selection, older open/related items, opening state, truthful progress, source health and per-answer readiness. Every capability must provide its own mapping and test evidence. This development register is not a tenant runtime health dashboard.

The five tracks are Source, Fact, Commitment, Movement and Reservation. They are logical journal tracks; physical SQL tables follow the journal contract. Each event uses only the applicable tracks.

**Active scope: local pilot.** [delivery-profile.json](delivery-profile.json) selects the required capability rows. Scope labels below preserve the broader platform plan; they do not make every first_release row a pilot requirement. Use the [local pilot contract](specs/LOCAL-PILOT.md) and its release gate. Deferred providers remain planned and unverified.

## Source overview

| Source | Pilot | Platform plan | Capabilities | Implemented | Test suites passed | Independently approved |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| [Shopify](#source-shopify) | required | first_release | 8 | 0 | 0 | 0 |
| [Shopify Payments](#source-shopify_payments) | required | first_release | 6 | 0 | 0 | 0 |
| [easybill](#source-easybill) | deferred | first_release | 3 | 0 | 0 | 0 |
| [DHL Unified Tracking](#source-dhl) | deferred | first_release | 1 | 0 | 0 | 0 |
| [Validated bank statement CSV](#source-bank_csv) | required | first_release | 1 | 0 | 0 | 0 |
| [Signed typed business-event API](#source-generic) | required | first_release | 25 | 0 | 0 | 0 |
| [Deterministic synthetic replay](#source-replay) | required | first_release | 25 | 0 | 0 | 0 |
| [Versioned workspace rules](#source-policy) | required | first_release | 1 | 0 | 0 | 0 |
| [Shopware 6](#source-shopware) | deferred | roadmap | 8 | 0 | 0 | 0 |
| [WooCommerce](#source-woocommerce) | deferred | roadmap | 6 | 0 | 0 | 0 |
| [Mailbox](#source-email) | deferred | roadmap | 3 | 0 | 0 | 0 |
| [Lexware Office](#source-lexware) | deferred | roadmap | 3 | 0 | 0 | 0 |
| [sevdesk](#source-sevdesk) | deferred | roadmap | 3 | 0 | 0 | 0 |
| [Billbee](#source-billbee) | deferred | roadmap | 5 | 0 | 0 | 0 |
| [Sufio](#source-sufio) | deferred | roadmap | 3 | 0 | 0 | 0 |
| [Stripe standalone account](#source-stripe) | deferred | roadmap | 7 | 0 | 0 | 0 |
| [PayPal](#source-paypal) | deferred | roadmap | 7 | 0 | 0 | 0 |
| [Mollie](#source-mollie) | deferred | roadmap | 7 | 0 | 0 | 0 |
| [DPD](#source-dpd) | deferred | roadmap | 1 | 0 | 0 | 0 |
| [UPS](#source-ups) | deferred | roadmap | 1 | 0 | 0 | 0 |
| [Klaviyo](#source-klaviyo) | deferred | roadmap | 1 | 0 | 0 | 0 |
| [Internal ingestion and identity services](#source-runtime) | required | first_release | 2 | 0 | 0 | 0 |

## Per-source work list

Track initials: **S** Source · **F** Fact · **C** Commitment · **M** Movement · **R** Reservation. “—” means no event in this data contract requires that track. Step counts are work claims, not test passes. Tests show the four required suites. Live evidence is separate.

<a id="source-shopify"></a>
### Shopify

**Pilot:** required. **Platform plan:** first_release. **Documentation:** reviewed.

**Input:** GraphQL Admin API: paginated backfill and reconciliation; verified HTTPS webhooks trigger durable receipt and re-fetch. Pin an API version and fixture schema; consume all nested pages.

**Prerequisites:** read_orders; older order access needs read_all_orders approval. read_inventory and appropriate fulfillment-order scopes; read_returns for return objects. Prove actual grants and protected customer-data access. Record history start and every missing scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [shopify.orders](#data-orders) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | BLOCKED: Live verification lacks authorized development-store credentials and confirmed grants. Synthetic contract and persisted pipeline work continues. | Codex primary implementation agent / 2026-10-31T14:10:52.291794Z |
| [shopify.stock](#data-stock) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify.allocations](#data-allocations) | ✓ | ✓ | — | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify.fulfillments](#data-fulfillments) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | BLOCKED: Live verification lacks authorized development-store credentials and confirmed grants. Synthetic contract and persisted pipeline work continues. | Codex primary implementation agent / 2026-10-31T14:10:52.291900Z |
| [shopify.returns](#data-returns) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify.receipts](#data-receipts) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T14:10:52.291906Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| shopify.orders | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.stock | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.fulfillments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.payments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.returns | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.receipts | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| shopify.orders | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.stock | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.fulfillments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.payments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.returns | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.receipts | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.orders / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.stock / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.fulfillments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.returns / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.receipts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.orders / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.stock / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.fulfillments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.returns / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.receipts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.orders / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.stock / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.allocations / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.fulfillments / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.payments / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.returns / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.receipts / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify.refunds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T13:02:30.622506Z / Codex root agent | shopify.orders / claim |   Implementing the baseline-v14 persisted P1 slice in the assigned repository. No acceptance or independent approval claimed. | —;  |
| 2026-10-31T13:02:30.622625Z / Codex root agent | shopify.orders / blocked |   Live verification lacks authorized development-store credentials and confirmed grants. Synthetic contract and persisted pipeline work continues. | —;  |
| 2026-10-31T13:02:30.622631Z / Codex root agent | shopify.payments / claim |   Implementing the baseline-v14 persisted P1 slice in the assigned repository. No acceptance or independent approval claimed. | —;  |
| 2026-10-31T13:02:30.622635Z / Codex root agent | shopify.payments / blocked |   Live verification lacks authorized development-store credentials and confirmed grants. Synthetic contract and persisted pipeline work continues. | —;  |
| 2026-10-31T13:15:57.215770Z / Codex primary implementation agent | shopify.orders / progress |   Narrow synthetic SLICE-01 executed at dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127; reports/runs/p1-dd0998e. Shared pipeline code exists and checks pass, but six full capability steps, mapping completeness and independent review are not claimed. External provider access remains blocked where applicable. | —;  |
| 2026-10-31T13:15:57.215770Z / Codex primary implementation agent | shopify.payments / progress |   Narrow synthetic SLICE-01 executed at dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127; reports/runs/p1-dd0998e. Shared pipeline code exists and checks pass, but six full capability steps, mapping completeness and independent review are not claimed. External provider access remains blocked where applicable. | —;  |
| 2026-10-31T14:10:52.291794Z / Codex primary implementation agent | shopify.orders / progress |   Fixed source import plans, protected account-bound credentials, fenced polling jobs and EN/DE onboarding are implemented for orders/payments/refunds. Synthetic pre-commit PostgreSQL/Rust/API/MCP/restart and browser checks have run; clean committed reproduction, exact per-capability mappings, other selected provider adapters and independent review remain pending. Live access is still externally blocked. See docs/contracts/source-operations.md. | —;  |
| 2026-10-31T14:10:52.291900Z / Codex primary implementation agent | shopify.payments / progress |   Fixed source import plans, protected account-bound credentials, fenced polling jobs and EN/DE onboarding are implemented for orders/payments/refunds. Synthetic pre-commit PostgreSQL/Rust/API/MCP/restart and browser checks have run; clean committed reproduction, exact per-capability mappings, other selected provider adapters and independent review remain pending. Live access is still externally blocked. See docs/contracts/source-operations.md. | —;  |
| 2026-10-31T14:10:52.291906Z / Codex primary implementation agent | shopify.refunds / progress |   Fixed source import plans, protected account-bound credentials, fenced polling jobs and EN/DE onboarding are implemented for orders/payments/refunds. Synthetic pre-commit PostgreSQL/Rust/API/MCP/restart and browser checks have run; clean committed reproduction, exact per-capability mappings, other selected provider adapters and independent review remain pending. Live access is still externally blocked. See docs/contracts/source-operations.md. | —;  |

</details>

<a id="source-shopify_payments"></a>
### Shopify Payments

**Pilot:** required. **Platform plan:** first_release. **Documentation:** reviewed.

**Input:** Query ShopifyPaymentsAccount balanceTransactions, payouts and disputes with pagination; reconcile provider balances independently of order ingestion.

**Prerequisites:** An eligible Shopify Payments account and actual finance/dispute grants. Account docs list read_shopify_payments or read_shopify_payments_accounts; payout objects require view_payouts permission and disputes require read_shopify_payments_disputes. Validate all field-level access in the pinned schema/account.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [shopify_payments.provider_ledger](#data-provider_ledger) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify_payments.positions](#data-positions) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify_payments.payouts](#data-payouts) | ✓ | ✓ | ✓ | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify_payments.holds](#data-holds) | ✓ | ✓ | ✓ | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify_payments.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopify_payments.disputes](#data-disputes) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| shopify_payments.provider_ledger | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify_payments.positions | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify_payments.payouts | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify_payments.holds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify_payments.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopify_payments.disputes | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| shopify_payments.provider_ledger | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify_payments.positions | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify_payments.payouts | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify_payments.holds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify_payments.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopify_payments.disputes | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify_payments.provider_ledger / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify_payments.positions / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify_payments.payouts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify_payments.holds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify_payments.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopify_payments.disputes / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify_payments.provider_ledger / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify_payments.positions / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify_payments.payouts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify_payments.holds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify_payments.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopify_payments.disputes / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify_payments.provider_ledger / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify_payments.positions / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify_payments.payouts / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify_payments.holds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify_payments.refunds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopify_payments.disputes / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |

</details>

<a id="source-easybill"></a>
### easybill

**Pilot:** deferred. **Platform plan:** first_release. **Documentation:** reviewed.

**Input:** GET /documents and /documents/{id}; /document-payments; /post-boxes; document versions where available. Reconcile edited_at with overlap and stable page handling. Webhook notifications can trigger authenticated re-fetch; verify the documented signature scheme before trusting payloads.

**Prerequisites:** Authorized account/API credential and actual plan limits. Schema reviewed: REST v1, info.version 1.103.1, SHA256 6d532f96a7fe82fcbd556178f8bd2a11f364061690f67ccb932d3722ac2b1e86. Verify signs, correction linkage, historical version completeness and account-specific field population in fixtures and an authorized account.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [easybill.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [easybill.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [easybill.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| easybill.invoices | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| easybill.invoice_dispatch | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| easybill.payment_allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| easybill.invoices | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| easybill.invoice_dispatch | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| easybill.payment_allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | easybill.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | easybill.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | easybill.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | easybill.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | easybill.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | easybill.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | easybill.invoices / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | easybill.invoice_dispatch / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | easybill.payment_allocations / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-dhl"></a>
### DHL Unified Tracking

**Pilot:** deferred. **Platform plan:** first_release. **Documentation:** reviewed.

**Input:** GET https://api-eu.dhl.com/track/shipments?trackingNumber=... for known shop shipment references; optional authorized push subscriptions with reconciliation. Back off and stop/slow polling terminal shipments according to the actual contract.

**Prerequisites:** Eligible tracking numbers, API subscription key, product coverage and quotas. Published Unified Tracking terms include deletion 30 days after delivery unless otherwise agreed. Resolve retention and permitted downstream use before live append-only ingestion; raw-data separation alone does not establish rights to retain derived tracking facts indefinitely.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [dhl.tracking](#data-tracking) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| dhl.tracking | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| dhl.tracking | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | dhl.tracking / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | dhl.tracking / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | dhl.tracking / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-bank_csv"></a>
### Validated bank statement CSV

**Pilot:** required. **Platform plan:** first_release. **Documentation:** internal_contract_required.

**Input:** Authorized upload -> versioned mapping/validation -> durable import records -> same journal/outbox/engine path.

**Prerequisites:** A statement supplied by the merchant, explicit account/currency/date/sign mapping and declared coverage interval. No live bank API is included.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [bank_csv.bank](#data-bank) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| bank_csv.bank | unverified — Verify authenticated file import, deduplication and explicit statement coverage. | unverified — Verify authenticated file import, deduplication and explicit statement coverage. | unverified — Verify authenticated file import, deduplication and explicit statement coverage. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| bank_csv.bank | unverified — Verify statement period/coverage, explicit opening balances where supplied, repeat import and later history expansion, durable record counts and query readiness; file import does not certify later bank activity. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | bank_csv.bank / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | bank_csv.bank / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | bank_csv.bank / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |

</details>

<a id="source-generic"></a>
### Signed typed business-event API

**Pilot:** required. **Platform plan:** first_release. **Documentation:** internal_contract_required.

**Input:** Versioned authenticated event envelope with idempotency key, tenant-bound connection, source identity, occurred_at and typed payload.

**Prerequisites:** Must be implemented and actually supplied by an authorized merchant system/operator. A defined schema does not collect data by itself.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [generic.orders](#data-orders) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.stock](#data-stock) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.allocations](#data-allocations) | ✓ | ✓ | — | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.supply](#data-supply) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.promises](#data-promises) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.fulfillments](#data-fulfillments) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.tracking](#data-tracking) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.communications](#data-communications) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.policy](#data-policy) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.cases](#data-cases) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.provider_ledger](#data-provider_ledger) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.positions](#data-positions) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.payouts](#data-payouts) | ✓ | ✓ | ✓ | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.bank](#data-bank) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.holds](#data-holds) | ✓ | ✓ | ✓ | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.returns](#data-returns) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.receipts](#data-receipts) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.entitlements](#data-entitlements) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.disputes](#data-disputes) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [generic.identity](#data-identity) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| generic.orders | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.stock | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.allocations | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.supply | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.promises | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.fulfillments | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.tracking | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.communications | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.invoices | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.invoice_dispatch | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.payments | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.payment_allocations | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.policy | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.cases | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.provider_ledger | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.positions | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.payouts | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.bank | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.holds | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.returns | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.receipts | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.entitlements | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.refunds | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.disputes | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |
| generic.identity | unverified — Verify signed local/reachable-producer submission; no unreachable remote callback. | unverified — Verify signed public gateway submission plus outbound consumption and local import. | unverified — Verify signed public backend submission and scoped producer credentials. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| generic.orders | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.stock | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.allocations | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.supply | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.promises | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.fulfillments | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.tracking | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.communications | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.invoices | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.invoice_dispatch | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.payments | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.payment_allocations | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.policy | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.cases | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.provider_ledger | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.positions | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.payouts | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.bank | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.holds | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.returns | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.receipts | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.entitlements | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.refunds | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.disputes | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |
| generic.identity | unverified — Verify authorized producer-declared effective/history scope, explicit opening/open/related records, durable progress and actual readiness; declarations do not prove complete external-source history. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.orders / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.stock / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.supply / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.promises / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.fulfillments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.tracking / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.communications / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.policy / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.cases / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.provider_ledger / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.positions / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.payouts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.bank / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.holds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.returns / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.receipts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.entitlements / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.disputes / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | generic.identity / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.orders / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.stock / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.supply / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.promises / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.fulfillments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.tracking / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.communications / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.policy / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.cases / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.provider_ledger / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.positions / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.payouts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.bank / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.holds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.returns / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.receipts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.entitlements / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.disputes / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | generic.identity / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.orders / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.stock / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.allocations / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.supply / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.promises / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.fulfillments / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.tracking / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.communications / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.invoices / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.invoice_dispatch / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.payments / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.payment_allocations / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.policy / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.cases / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.provider_ledger / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.positions / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.payouts / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.bank / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.holds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.returns / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.receipts / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.entitlements / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.refunds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.disputes / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | generic.identity / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.orders / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.stock / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.allocations / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.supply / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.promises / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.fulfillments / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.tracking / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.communications / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.invoices / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.invoice_dispatch / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.payments / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.payment_allocations / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.policy / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.cases / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.provider_ledger / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.positions / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.payouts / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.bank / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.holds / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.returns / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.receipts / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.entitlements / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.refunds / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.disputes / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | generic.identity / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |

</details>

<a id="source-replay"></a>
### Deterministic synthetic replay

**Pilot:** required. **Platform plan:** first_release. **Documentation:** internal_contract_required.

**Input:** Replay typed observations through the same tenant-scoped ingestion path.

**Prerequisites:** Clearly synthetic isolated workspace; no provider access claimed.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [replay.orders](#data-orders) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.stock](#data-stock) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.allocations](#data-allocations) | ✓ | ✓ | — | — | ✓ | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.supply](#data-supply) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.promises](#data-promises) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.fulfillments](#data-fulfillments) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.tracking](#data-tracking) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.communications](#data-communications) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.policy](#data-policy) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.cases](#data-cases) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.provider_ledger](#data-provider_ledger) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.positions](#data-positions) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.payouts](#data-payouts) | ✓ | ✓ | ✓ | ✓ | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.bank](#data-bank) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.holds](#data-holds) | ✓ | ✓ | ✓ | — | ✓ | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.returns](#data-returns) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.receipts](#data-receipts) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.entitlements](#data-entitlements) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.disputes](#data-disputes) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |
| [replay.identity](#data-identity) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T13:43:54.124428Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| replay.orders | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.stock | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.allocations | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.supply | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.promises | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.fulfillments | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.tracking | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.communications | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.invoices | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.invoice_dispatch | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.payments | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.payment_allocations | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.policy | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.cases | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.provider_ledger | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.positions | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.payouts | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.bank | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.holds | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.returns | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.receipts | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.entitlements | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.refunds | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.disputes | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| replay.identity | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| replay.orders | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.stock | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.allocations | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.supply | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.promises | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.fulfillments | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.tracking | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.communications | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.invoices | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.invoice_dispatch | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.payments | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.payment_allocations | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.policy | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.cases | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.provider_ledger | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.positions | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.payouts | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.bank | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.holds | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.returns | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.receipts | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.entitlements | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.refunds | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.disputes | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| replay.identity | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.orders / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.stock / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.supply / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.promises / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.fulfillments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.tracking / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.communications / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.policy / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.cases / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.provider_ledger / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.positions / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.payouts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.bank / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.holds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.returns / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.receipts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.entitlements / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.disputes / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | replay.identity / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.orders / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.stock / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.supply / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.promises / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.fulfillments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.tracking / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.communications / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.policy / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.cases / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.provider_ledger / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.positions / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.payouts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.bank / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.holds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.returns / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.receipts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.entitlements / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.disputes / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | replay.identity / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.orders / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.stock / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.allocations / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.supply / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.promises / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.fulfillments / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.tracking / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.communications / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.invoices / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.invoice_dispatch / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.payments / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.payment_allocations / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.policy / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.cases / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.provider_ledger / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.positions / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.payouts / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.bank / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.holds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.returns / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.receipts / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.entitlements / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.refunds / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.disputes / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | replay.identity / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.orders / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.stock / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.allocations / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.fulfillments / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.invoices / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.payments / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.provider_ledger / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.payouts / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.bank / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.returns / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.receipts / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:20:22.688192Z / Codex primary implementation agent | replay.refunds / claim |   Implementing typed supplemental ingestion. Golden subset is executable; full capability mapping/six steps/review remain incomplete. Evidence reports/runs/golden-2e80944/result.json. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.orders / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.stock / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.allocations / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.supply / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.promises / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.fulfillments / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.tracking / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.communications / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.invoices / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.invoice_dispatch / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.payments / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.payment_allocations / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.policy / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.cases / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.provider_ledger / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.positions / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.payouts / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.bank / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.holds / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.returns / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.receipts / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.entitlements / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.refunds / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.disputes / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | replay.identity / claim |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |

</details>

<a id="source-policy"></a>
### Versioned workspace rules

**Pilot:** required. **Platform plan:** first_release. **Documentation:** internal_contract_required.

**Input:** Authorized settings/import appends rule-change evidence; runtime query reads the version effective at its cutoff.

**Prerequisites:** Owner-supplied allocation, invoicing, delivery-risk and reminder policy; no undocumented defaults that decide business obligations.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [policy.policy](#data-policy) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| policy.policy | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| policy.policy | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | policy.policy / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | policy.policy / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | policy.policy / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |

</details>

<a id="source-shopware"></a>
### Shopware 6

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [shopware.orders](#data-orders) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.stock](#data-stock) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.allocations](#data-allocations) | ✓ | ✓ | — | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.fulfillments](#data-fulfillments) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.returns](#data-returns) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.receipts](#data-receipts) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [shopware.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| shopware.orders | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.stock | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.fulfillments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.payments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.returns | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.receipts | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| shopware.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| shopware.orders | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.stock | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.fulfillments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.payments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.returns | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.receipts | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| shopware.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.orders / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.stock / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.fulfillments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.returns / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.receipts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | shopware.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.orders / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.stock / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.fulfillments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.returns / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.receipts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | shopware.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.orders / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.stock / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.allocations / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.fulfillments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.payments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.returns / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.receipts / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | shopware.refunds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-woocommerce"></a>
### WooCommerce

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [woocommerce.orders](#data-orders) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [woocommerce.stock](#data-stock) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [woocommerce.fulfillments](#data-fulfillments) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [woocommerce.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [woocommerce.returns](#data-returns) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [woocommerce.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| woocommerce.orders | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| woocommerce.stock | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| woocommerce.fulfillments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| woocommerce.payments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| woocommerce.returns | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| woocommerce.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| woocommerce.orders | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| woocommerce.stock | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| woocommerce.fulfillments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| woocommerce.payments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| woocommerce.returns | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| woocommerce.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | woocommerce.orders / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | woocommerce.stock / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | woocommerce.fulfillments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | woocommerce.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | woocommerce.returns / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | woocommerce.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | woocommerce.orders / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | woocommerce.stock / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | woocommerce.fulfillments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | woocommerce.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | woocommerce.returns / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | woocommerce.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | woocommerce.orders / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | woocommerce.stock / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | woocommerce.fulfillments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | woocommerce.payments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | woocommerce.returns / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | woocommerce.refunds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-email"></a>
### Mailbox

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [email.promises](#data-promises) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [email.communications](#data-communications) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [email.cases](#data-cases) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| email.promises | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| email.communications | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| email.cases | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| email.promises | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| email.communications | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| email.cases | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | email.promises / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | email.communications / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | email.cases / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | email.promises / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | email.communications / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | email.cases / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | email.promises / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | email.communications / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | email.cases / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-lexware"></a>
### Lexware Office

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [lexware.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [lexware.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [lexware.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| lexware.invoices | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| lexware.invoice_dispatch | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| lexware.payment_allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| lexware.invoices | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| lexware.invoice_dispatch | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| lexware.payment_allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | lexware.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | lexware.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | lexware.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | lexware.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | lexware.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | lexware.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | lexware.invoices / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | lexware.invoice_dispatch / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | lexware.payment_allocations / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-sevdesk"></a>
### sevdesk

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [sevdesk.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [sevdesk.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [sevdesk.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| sevdesk.invoices | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| sevdesk.invoice_dispatch | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| sevdesk.payment_allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| sevdesk.invoices | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| sevdesk.invoice_dispatch | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| sevdesk.payment_allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | sevdesk.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | sevdesk.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | sevdesk.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | sevdesk.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | sevdesk.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | sevdesk.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | sevdesk.invoices / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | sevdesk.invoice_dispatch / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | sevdesk.payment_allocations / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-billbee"></a>
### Billbee

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [billbee.orders](#data-orders) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [billbee.fulfillments](#data-fulfillments) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [billbee.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [billbee.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [billbee.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| billbee.orders | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| billbee.fulfillments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| billbee.invoices | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| billbee.invoice_dispatch | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| billbee.payment_allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| billbee.orders | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| billbee.fulfillments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| billbee.invoices | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| billbee.invoice_dispatch | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| billbee.payment_allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | billbee.orders / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | billbee.fulfillments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | billbee.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | billbee.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | billbee.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | billbee.orders / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | billbee.fulfillments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | billbee.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | billbee.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | billbee.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | billbee.orders / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | billbee.fulfillments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | billbee.invoices / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | billbee.invoice_dispatch / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | billbee.payment_allocations / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-sufio"></a>
### Sufio

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [sufio.invoices](#data-invoices) | ✓ | ✓ | ✓ | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [sufio.invoice_dispatch](#data-invoice_dispatch) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [sufio.payment_allocations](#data-payment_allocations) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| sufio.invoices | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| sufio.invoice_dispatch | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| sufio.payment_allocations | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| sufio.invoices | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| sufio.invoice_dispatch | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| sufio.payment_allocations | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | sufio.invoices / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | sufio.invoice_dispatch / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | sufio.payment_allocations / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | sufio.invoices / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | sufio.invoice_dispatch / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | sufio.payment_allocations / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | sufio.invoices / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | sufio.invoice_dispatch / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | sufio.payment_allocations / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-stripe"></a>
### Stripe standalone account

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [stripe.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [stripe.provider_ledger](#data-provider_ledger) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [stripe.positions](#data-positions) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [stripe.payouts](#data-payouts) | ✓ | ✓ | ✓ | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [stripe.holds](#data-holds) | ✓ | ✓ | ✓ | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [stripe.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [stripe.disputes](#data-disputes) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| stripe.payments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| stripe.provider_ledger | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| stripe.positions | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| stripe.payouts | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| stripe.holds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| stripe.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| stripe.disputes | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| stripe.payments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| stripe.provider_ledger | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| stripe.positions | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| stripe.payouts | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| stripe.holds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| stripe.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| stripe.disputes | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.provider_ledger / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.positions / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.payouts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.holds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | stripe.disputes / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.provider_ledger / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.positions / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.payouts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.holds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | stripe.disputes / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.payments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.provider_ledger / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.positions / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.payouts / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.holds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.refunds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | stripe.disputes / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-paypal"></a>
### PayPal

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [paypal.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [paypal.provider_ledger](#data-provider_ledger) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [paypal.positions](#data-positions) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [paypal.payouts](#data-payouts) | ✓ | ✓ | ✓ | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [paypal.holds](#data-holds) | ✓ | ✓ | ✓ | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [paypal.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [paypal.disputes](#data-disputes) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| paypal.payments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| paypal.provider_ledger | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| paypal.positions | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| paypal.payouts | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| paypal.holds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| paypal.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| paypal.disputes | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| paypal.payments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| paypal.provider_ledger | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| paypal.positions | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| paypal.payouts | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| paypal.holds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| paypal.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| paypal.disputes | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.provider_ledger / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.positions / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.payouts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.holds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | paypal.disputes / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.provider_ledger / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.positions / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.payouts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.holds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | paypal.disputes / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.payments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.provider_ledger / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.positions / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.payouts / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.holds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.refunds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | paypal.disputes / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-mollie"></a>
### Mollie

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [mollie.payments](#data-payments) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [mollie.provider_ledger](#data-provider_ledger) | ✓ | ✓ | — | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [mollie.positions](#data-positions) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [mollie.payouts](#data-payouts) | ✓ | ✓ | ✓ | ✓ | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [mollie.holds](#data-holds) | ✓ | ✓ | ✓ | — | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [mollie.refunds](#data-refunds) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |
| [mollie.disputes](#data-disputes) | ✓ | ✓ | — | ✓ | ✓ | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| mollie.payments | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| mollie.provider_ledger | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| mollie.positions | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| mollie.payouts | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| mollie.holds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| mollie.refunds | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |
| mollie.disputes | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| mollie.payments | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| mollie.provider_ledger | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| mollie.positions | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| mollie.payouts | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| mollie.holds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| mollie.refunds | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |
| mollie.disputes | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.payments / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.provider_ledger / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.positions / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.payouts / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.holds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.refunds / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | mollie.disputes / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.payments / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.provider_ledger / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.positions / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.payouts / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.holds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.refunds / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | mollie.disputes / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.payments / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.provider_ledger / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.positions / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.payouts / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.holds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.refunds / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | mollie.disputes / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-dpd"></a>
### DPD

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [dpd.tracking](#data-tracking) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| dpd.tracking | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| dpd.tracking | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | dpd.tracking / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | dpd.tracking / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | dpd.tracking / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-ups"></a>
### UPS

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [ups.tracking](#data-tracking) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| ups.tracking | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| ups.tracking | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | ups.tracking / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | ups.tracking / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | ups.tracking / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-klaviyo"></a>
### Klaviyo

**Pilot:** deferred. **Platform plan:** roadmap. **Documentation:** not_audited.

**Input:** Adapter, fields, scopes, account eligibility, backfill and lifecycle semantics still need a separate capability mapping.

**Prerequisites:** Not verified and not included as a full live first-release connector.

All rows below are desired, unreviewed capabilities. Confirm actual provider support before implementing them; they do not expand the first-release scope.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [klaviyo.communications](#data-communications) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not verified | pending | unassigned / 2026-10-31T12:26:41Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| klaviyo.communications | unverified — Investigate polling/import coverage, history limits and gaps without public callbacks. | unverified — Investigate gateway callback availability and polling/reconciliation per capability. | unverified — Investigate direct public callbacks and polling/reconciliation per capability. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| klaviyo.communications | unverified — Verify requested versus accessible history, older open/related records, opening state, stable import counts, per-question readiness, successful sync versus new events and deduplicated history expansion; disclose source limitations. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | klaviyo.communications / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | klaviyo.communications / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | klaviyo.communications / plan_changed |   Deferred from the local pilot. Preserve this source capability and prior research/history as a future option; no live support, completed implementation or test result is claimed. New scope requires an owner decision after local feedback. | —;  |

</details>

<a id="source-runtime"></a>
### Internal ingestion and identity services

**Pilot:** required. **Platform plan:** first_release. **Documentation:** internal_contract_required.

**Input:** Server-owned ingestion, reconciliation, import and identity-review checkpoints. Not a merchant connector or public capability to declare arbitrary completeness.

**Prerequisites:** Record actual granted scopes, finished pagination/reconciliation and evidenced import intervals. A producer claim of completeness is separately labeled, not trusted as runtime verification.

| Capability → data contract | S | F | C | M | R | Build / fields | Tests | Live proof | Confirmation | Owner / last update |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| [runtime.coverage](#data-coverage) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T14:10:52.291910Z |
| [runtime.identity](#data-identity) | ✓ | ✓ | — | — | — | not started (0/6); unknown | 0/4 | not applicable (internal) | pending | Codex primary implementation agent / 2026-10-31T14:10:52.291913Z |

#### Synchronization by capability

Mode plans are investigation obligations. Only committed implementation mappings declare support, and test/approval columns above remain the verification authority. Local standalone has no public webhook callback. Polling may recover current state without recovering every intermediate event.

| Capability | Local standalone | Local + gateway | Public backend |
| --- | --- | --- | --- |
| runtime.coverage | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |
| runtime.identity | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. | unverified — Verify scoped internal production and recovery in this profile. |

<details><summary>Historical import and data readiness obligations</summary>

| Capability | Investigation / actual mapping |
| --- | --- |
| runtime.coverage | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |
| runtime.identity | unverified — Verify internal trigger/effective scope, replay or initial state, durable progress, readiness dependencies and truthful health; do not claim a remote provider synchronization. |

</details>

<details><summary>Who did what, when, and with which evidence</summary>

| Time / actor | Capability / action | What changed / test | Evidence / commit |
| --- | --- | --- | --- |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | runtime.coverage / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T11:54:09Z / Codex assistant (repository preparation) | runtime.identity / plan_changed |   Add per-capability investigation and verification obligations for standalone, gateway and public-backend synchronization. No implementation or provider support is asserted. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | runtime.coverage / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:02:17Z / Codex assistant (repository preparation) | runtime.identity / plan_changed |   Add historical-import, progress, ongoing-health and answer-readiness mapping/test obligations. This records specification preparation only; no implementation, assignment or provider verification. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | runtime.coverage / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T12:26:41Z / Codex assistant (repository preparation) | runtime.identity / plan_changed |   Selected for the local pilot: implement/prove supported local_standalone import/poll/reconciliation, personal owner-key versus read-only agent authorization and existing journal/query/readiness rules. Public/gateway modes are deferred and must be declared unsupported; no implementation or test result is claimed. | —;  |
| 2026-10-31T13:02:30.622639Z / Codex root agent | runtime.identity / claim |   Implementing the baseline-v14 persisted P1 slice in the assigned repository. No acceptance or independent approval claimed. | —;  |
| 2026-10-31T13:02:30.622643Z / Codex root agent | runtime.coverage / claim |   Implementing the baseline-v14 persisted P1 slice in the assigned repository. No acceptance or independent approval claimed. | —;  |
| 2026-10-31T13:15:57.215770Z / Codex primary implementation agent | runtime.identity / progress |   Narrow synthetic SLICE-01 executed at dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127; reports/runs/p1-dd0998e. Shared pipeline code exists and checks pass, but six full capability steps, mapping completeness and independent review are not claimed. External provider access remains blocked where applicable. | —;  |
| 2026-10-31T13:15:57.215770Z / Codex primary implementation agent | runtime.coverage / progress |   Narrow synthetic SLICE-01 executed at dd0998ec74cc8ed9488dfc5acbb01b57dfaf4127; reports/runs/p1-dd0998e. Shared pipeline code exists and checks pass, but six full capability steps, mapping completeness and independent review are not claimed. External provider access remains blocked where applicable. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | runtime.coverage / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T13:43:54.124428Z / Codex primary implementation agent | runtime.identity / progress |   Typed supplemental inputs and generalized 24-question query paths have committed persisted evidence at 3ced26bb56543703e1d05e8719e35f2d537f2b45 (reports/runs/questions-3ced26b/questions-evidence.json). Full exact per-capability mapping, lifecycle operations and independent confirmation remain incomplete; this is not a source coverage approval. | —;  |
| 2026-10-31T14:10:52.291910Z / Codex primary implementation agent | runtime.coverage / progress |   Fixed source import plans, protected account-bound credentials, fenced polling jobs and EN/DE onboarding are implemented for orders/payments/refunds. Synthetic pre-commit PostgreSQL/Rust/API/MCP/restart and browser checks have run; clean committed reproduction, exact per-capability mappings, other selected provider adapters and independent review remain pending. Live access is still externally blocked. See docs/contracts/source-operations.md. | —;  |
| 2026-10-31T14:10:52.291913Z / Codex primary implementation agent | runtime.identity / progress |   Fixed source import plans, protected account-bound credentials, fenced polling jobs and EN/DE onboarding are implemented for orders/payments/refunds. Synthetic pre-commit PostgreSQL/Rust/API/MCP/restart and browser checks have run; clean committed reproduction, exact per-capability mappings, other selected provider adapters and independent review remain pending. Live access is still externally blocked. See docs/contracts/source-operations.md. | —;  |

</details>

## What must enter each data contract

Every capability above links here. These are required canonical inputs, not a claim that every provider supplies every field. Provider candidate paths are in [the source audit](specs/CONNECTOR-CAPABILITIES.md) and [the JSON crosswalk](specs/question-data-contracts.json). Each implemented row must add its own complete, verified field mapping.

**Shared route:** authorized receipt → immutable PostgreSQL journal and transactional outbox → committed cursor → deterministic Rust reducer → bounded RAM indexes and durable checkpoints → the same API/MCP query service. RAM is never updated ahead of the durable commit. Historical evidence stays addressable; cold data has an indexed fallback.

<a id="data-orders"></a>
### orders

- Required fields: `order_id`, `line_id`, `customer_id`, `item_id`, `variant_id`, `quantity`, `unit`, `currency`, `line_net_minor`, `line_tax_minor`, `line_gross_minor`, `discount_minor`, `shipping_minor`, `agreed_version`, `cancellation_state`, `updated_at`.
- Journal events: `order.accepted`, `order.revised`, `order.cancelled`.
- Applicable tracks: source, fact, commitment.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_ORDER; see the projection definitions in the JSON crosswalk.
- Normalization: Preserve agreed and current versions; line removal/returns are not interchangeable. Use provider IDs scoped to account, never email/order number alone.
- Open proof: Line-price and partial-document matching needs explicit equivalence rules.
- Question coverage: order-02, order-03, order-04, delivery-02, delivery-03, delivery-04, invoice-02, invoice-03, collection-01, collection-02, reversal-03.

<a id="data-stock"></a>
### stock

- Required fields: `item_id`, `location_id`, `unit`, `observed_at`, `basis`, `physical`, `available`, `committed`, `reserved`, `damaged`, `safety_stock`, `quality_control`, `incoming`.
- Journal events: `inventory.snapshot`, `inventory.adjustment_observed`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_STOCK; see the projection definitions in the JSON crosswalk.
- Normalization: One authoritative stock basis per item/location/cutoff. For disjoint states derive free = physical - committed - reserved - damaged - safety_stock - quality_control; compare to provider available. Never subtract the same commitment twice.
- Open proof: Snapshot differences alone do not prove the cause of a goods movement; incompatible snapshots produce a conflict.
- Question coverage: order-01, order-02.

<a id="data-allocations"></a>
### allocations

- Required fields: `allocation_id`, `order_id`, `line_id`, `item_id`, `location_id`, `quantity`, `unit`, `status`, `policy_version`, `evidence_id`.
- Journal events: `inventory.reserved`, `inventory.reservation_released`, `allocation.revised`.
- Applicable tracks: source, fact, reservation.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_ORDER, P_STOCK; see the projection definitions in the JSON crosswalk.
- Normalization: An observed reservation and a derived allocation are distinct. Preserve provenance and releases; reconcile aggregates without double subtracting.
- Open proof: Fulfillment location assignment is not automatically a reservation. Implement explicit generic events or a declared allocation derivation.
- Question coverage: order-02, order-03, order-04, reversal-03.

<a id="data-supply"></a>
### supply

- Required fields: `promise_id`, `supplier_id`, `item_id`, `location_id`, `quantity`, `unit`, `promised_at`, `timezone`, `revision`, `allocation_links`.
- Journal events: `supply.commitment_recorded`, `supply.commitment_revised`.
- Applicable tracks: source, fact, commitment.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PROMISE; see the projection definitions in the JSON crosswalk.
- Normalization: A promise never increases physical stock; corrections append and supersede.
- Open proof: No supplier/PO connector is included at launch. Feed reviewed structured commitments through the generic API.
- Question coverage: order-01, order-04.

<a id="data-promises"></a>
### promises

- Required fields: `promise_id`, `order_id`, `line_id`, `promised_at`, `timezone`, `promise_kind`, `revision`, `evidence_id`.
- Journal events: `customer.commitment_recorded`, `customer.commitment_revised`.
- Applicable tracks: source, fact, commitment.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PROMISE; see the projection definitions in the JSON crosswalk.
- Normalization: Customer promise, fulfill-by date and carrier estimate are different assertions.
- Open proof: Must capture the actual communicated promise from a verified custom field/feed/reviewed communication; do not infer from shipping method.
- Question coverage: order-04, delivery-02, delivery-04.

<a id="data-fulfillments"></a>
### fulfillments

- Required fields: `shipment_id`, `order_id`, `line_id`, `quantity`, `unit`, `location_id`, `carrier`, `tracking_number`, `handover_at`, `delivered_at`, `state`.
- Journal events: `shipment.observed`, `shipment.dispatched`, `shipment.delivered`, `shipment.cancelled`.
- Applicable tracks: source, fact, movement, reservation.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_SHIPMENT, P_ORDER; see the projection definitions in the JSON crosswalk.
- Normalization: Link actual line quantities to shipment milestones. Labels do not count as handover. Do not book stock movement twice from shop and carrier.
- Open proof: Multi-package line assignment may require packing/WMS data; unknown mapping limits line-level claims.
- Question coverage: order-03, delivery-01, delivery-02, delivery-03, delivery-04, invoice-02.

<a id="data-tracking"></a>
### tracking

- Required fields: `carrier_service`, `tracking_number`, `scan_identity`, `status_code`, `effective_time`, `timezone`, `forecast`, `observed_at`.
- Journal events: `carrier.scan_observed`, `carrier.forecast_observed`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_SHIPMENT; see the projection definitions in the JSON crosswalk.
- Normalization: Normalize codes with a versioned mapping and retain original scan evidence; preserve late observations without regressing current status.
- Open proof: Service coverage, licensed retention and tracking-to-order linkage must be validated.
- Question coverage: delivery-01, delivery-02, delivery-03, delivery-04, reversal-01.

<a id="data-communications"></a>
### communications

- Required fields: `message_id`, `customer_id`, `order_id`, `sent_at`, `actor`, `evidence_ref`, `reviewed_commitments`, `visibility_scope`.
- Journal events: `communication.observed`, `communication.extraction_reviewed`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_CONTEXT; see the projection definitions in the JSON crosswalk.
- Normalization: Keep original content in controlled evidence storage; reviewed assertions reference exact source versions.
- Open proof: Mailbox is roadmap. Generic reviewed input is the launch bridge; absence of imported communications is not proof of no prior promise.
- Question coverage: delivery-04.

<a id="data-invoices"></a>
### invoices

- Required fields: `document_id`, `kind`, `invoice_id`, `order_id`, `line_links`, `currency`, `original_gross_minor`, `correction_minor`, `due_date`, `reported_paid_minor`, `revision`, `draft_state`.
- Journal events: `invoice.issued`, `invoice.revised`, `invoice.credit_issued`, `invoice.cancelled`, `invoice.payment_marked`.
- Applicable tracks: source, fact, commitment.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_INVOICE; see the projection definitions in the JSON crosswalk.
- Normalization: Traverse document correction chains; reconcile signed effects and payment markers without treating markers/credits as cash.
- Open proof: Candidate order_number/external_id and line references require validated tenant/account-scoped association.
- Question coverage: invoice-01, invoice-02, invoice-03, invoice-04, collection-03, collection-04, reversal-01, reversal-02, reversal-03.

<a id="data-invoice_dispatch"></a>
### invoice_dispatch

- Required fields: `dispatch_id`, `document_id`, `channel`, `status`, `processed_at`, `source_scope`.
- Journal events: `invoice.dispatch_observed`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_INVOICE; see the projection definitions in the JSON crosswalk.
- Normalization: Report sent evidence at provider-reported scope; no claim of customer receipt/read.
- Open proof: Missing/external send history must remain unknown.
- Question coverage: invoice-04.

<a id="data-payments"></a>
### payments

- Required fields: `transaction_id`, `original_transaction_id`, `order_id`, `account_id`, `gateway`, `kind`, `status`, `amount_minor`, `currency`, `occurred_at`, `economic_effect_id`.
- Journal events: `payment.authorized`, `payment.captured`, `payment.failed`, `payment.voided`.
- Applicable tracks: source, fact, movement.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PAYMENT; see the projection definitions in the JSON crosswalk.
- Normalization: Only successful sale/capture contributes collected cash; unify overlapping observations with proven identity.
- Open proof: Historical attempt coverage and original-transaction joins need verification.
- Question coverage: collection-01, collection-02, collection-03, collection-04, reversal-02, reversal-03, reversal-04.

<a id="data-payment_allocations"></a>
### payment_allocations

- Required fields: `allocation_id`, `invoice_id`, `transaction_id`, `amount_minor`, `currency`, `confidence`, `evidence_id`, `revision`.
- Journal events: `payment.allocation_recorded`, `payment.allocation_revised`, `invoice.payment_marked`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PAYMENT, P_INVOICE; see the projection definitions in the JSON crosswalk.
- Normalization: Only unambiguous allocations reconcile invoices; reported paid markers remain separate.
- Open proof: A payment covering several invoices or several attempts needs explicit allocation; fees are not customer debt.
- Question coverage: collection-03, collection-04.

<a id="data-policy"></a>
### policy

- Required fields: `rule_id`, `rule_kind`, `version`, `effective_from`, `scope`, `priority_method`, `invoicing_trigger`, `tolerance`, `currency`, `timezone`, `reminder_policy`.
- Journal events: `business.rule_recorded`, `business.rule_revised`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_CONTEXT; see the projection definitions in the JSON crosswalk.
- Normalization: Evaluate using the policy effective at the requested cutoff; unsupported/missing business rules are missing inputs.
- Open proof: No invented invoice timing, debt reminder or allocation priority.
- Question coverage: order-02, delivery-01, delivery-02, invoice-02, collection-04.

<a id="data-cases"></a>
### cases

- Required fields: `case_id`, `customer_id`, `invoice_id`, `transaction_id`, `status`, `agreed_extension_until`, `evidence_id`.
- Journal events: `business.case_recorded`, `business.case_revised`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_CONTEXT; see the projection definitions in the JSON crosswalk.
- Normalization: A dispute, deadline extension or investigation changes review context without erasing the receivable.
- Open proof: Need an internal authorized case feed or later CRM/helpdesk connector.
- Question coverage: collection-04.

<a id="data-provider_ledger"></a>
### provider_ledger

- Required fields: `ledger_entry_id`, `account_id`, `source_transaction_id`, `order_link`, `payout_id`, `posting_type`, `gross_minor`, `fee_minor`, `net_minor`, `currency`, `effective_time`.
- Journal events: `provider.ledger_posted`, `payment.fee_booked`.
- Applicable tracks: source, fact, movement.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PROVIDER, P_PAYMENT; see the projection definitions in the JSON crosswalk.
- Normalization: Version provider sign/type mapping, deduplicate economic effects and preserve unsettled residuals.
- Open proof: Do not force optional source links or assume every adjustment belongs to one order.
- Question coverage: settlement-01, settlement-02.

<a id="data-positions"></a>
### positions

- Required fields: `account_id`, `currency`, `observed_at`, `total_minor`, `processing_minor`, `available_minor`, `held_minor`, `coverage`.
- Journal events: `provider.balance_observed`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PROVIDER; see the projection definitions in the JSON crosswalk.
- Normalization: Snapshots supersede; never sum historical balances. Distinguish observed totals, derived totals and unknown subcategories.
- Open proof: Detailed balance breakdown is not established by a single total balance field.
- Question coverage: settlement-01, settlement-04.

<a id="data-payouts"></a>
### payouts

- Required fields: `payout_id`, `account_id`, `status`, `direction`, `amount_minor`, `currency`, `issued_at`, `trace_reference`, `ledger_membership`, `reversal_id`.
- Journal events: `payout.announced`, `payout.sent`, `payout.failed`, `payout.reversed`.
- Applicable tracks: source, fact, commitment, movement.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PROVIDER; see the projection definitions in the JSON crosswalk.
- Normalization: Payouts transfer assets and are not new sales; pending/sent/reversed are distinct.
- Open proof: Require complete payout membership to explain gross-to-net differences.
- Question coverage: settlement-01, settlement-02, settlement-03.

<a id="data-bank"></a>
### bank

- Required fields: `entry_id`, `statement_id`, `account_id`, `booking_status`, `booked_at`, `value_at`, `amount_minor`, `currency`, `reference`, `payout_match`, `coverage_interval`.
- Journal events: `bank.credit_booked`, `bank.debit_booked`, `bank.match_recorded`, `bank.match_revised`.
- Applicable tracks: source, fact, movement.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_BANK; see the projection definitions in the JSON crosswalk.
- Normalization: Use booked independent bank records with unique evidenced matches; ambiguity remains unresolved.
- Open proof: Merchant must supply a real statement; demo bank rows are not bank verification.
- Question coverage: settlement-01, settlement-03.

<a id="data-holds"></a>
### holds

- Required fields: `hold_id`, `account_id`, `transaction_id`, `currency`, `amount_minor`, `reason`, `state`, `release_promised_at`, `released_at`, `evidence_id`.
- Journal events: `provider.hold_recorded`, `provider.hold_released`, `provider.release_promised`.
- Applicable tracks: source, fact, reservation, commitment.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PROVIDER; see the projection definitions in the JSON crosswalk.
- Normalization: A hold affects availability, not ownership or collected sales; a release promise is not a release.
- Open proof: Hold reasons/release dates and complete partition of balances remain unverified for the default provider.
- Question coverage: settlement-01, settlement-04.

<a id="data-returns"></a>
### returns

- Required fields: `return_id`, `order_id`, `line_id`, `quantity`, `unit`, `state`, `reverse_shipment_id`.
- Journal events: `return.approved`, `return.revised`, `return.cancelled`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_REVERSAL; see the projection definitions in the JSON crosswalk.
- Normalization: Return intent and physical receipt are separate; cancelled/closed workflow states need interpretation.
- Open proof: Reverse logistics field population varies with merchant workflow.
- Question coverage: reversal-01.

<a id="data-receipts"></a>
### receipts

- Required fields: `receipt_id`, `return_id`, `line_id`, `location_id`, `quantity`, `unit`, `disposition`, `physical_delta`, `quarantine_delta`, `occurred_at`.
- Journal events: `return.received`, `return.restocked`, `return.disposition_observed`.
- Applicable tracks: source, fact, movement, reservation.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_REVERSAL, P_STOCK; see the projection definitions in the JSON crosswalk.
- Normalization: Receiving into quarantine increases physical and quarantine; subsequent restock releases quarantine without a second physical receipt.
- Open proof: Use verified disposition/warehouse evidence; a return request or carrier delivery does not prove checked SKU-level receipt.
- Question coverage: reversal-01, reversal-03.

<a id="data-entitlements"></a>
### entitlements

- Required fields: `entitlement_id`, `order_id`, `invoice_id`, `credit_id`, `original_transaction_id`, `amount_minor`, `currency`, `destination`, `approved_at`, `state`.
- Journal events: `refund.entitlement_recorded`, `refund.entitlement_revised`.
- Applicable tracks: source, fact, commitment.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_REVERSAL; see the projection definitions in the JSON crosswalk.
- Normalization: Separate refund owed to a paid customer from a credit cancelling an unpaid receivable or agreed store credit.
- Open proof: Need explicit approved policy/allocation evidence; not every credit creates a cash refund obligation.
- Question coverage: reversal-02, reversal-03.

<a id="data-refunds"></a>
### refunds

- Required fields: `refund_id`, `original_transaction_id`, `order_id`, `amount_minor`, `currency`, `status`, `destination`, `economic_effect_id`.
- Journal events: `refund.pending`, `refund.completed`, `refund.failed`, `refund.reversed`.
- Applicable tracks: source, fact, movement, reservation.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_PAYMENT, P_REVERSAL, P_PROVIDER; see the projection definitions in the JSON crosswalk.
- Normalization: Only confirmed cash refunds affect cash; store credit, pending and failed outcomes are separate.
- Open proof: Shop/provider duplicate observations require identity reconciliation, not two debits.
- Question coverage: reversal-01, reversal-02, reversal-03, reversal-04.

<a id="data-disputes"></a>
### disputes

- Required fields: `dispute_id`, `original_transaction_id`, `order_id`, `amount_minor`, `currency`, `state`, `debit_posting_id`, `debit_minor`, `reversal_minor`, `evidence_id`.
- Journal events: `dispute.opened`, `dispute.resolved`, `chargeback.debit_posted`, `chargeback.reversed`.
- Applicable tracks: source, fact, movement, reservation.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_REVERSAL, P_PROVIDER; see the projection definitions in the JSON crosswalk.
- Normalization: Open dispute is a risk flag; booked debit and reversal are distinct money effects. Match exact original transaction and case lifecycle.
- Open proof: Order link is insufficient where multiple captures exist. Booked chargeback mapping remains a provider-specific proof obligation.
- Question coverage: reversal-04.

<a id="data-coverage"></a>
### coverage

- Required fields: `connection_id`, `capability`, `entity_scope`, `history_start`, `backfill_complete`, `complete_through`, `cursor`, `fetched_at`, `committed_cursor`, `applied_cursor`, `missing_fields`, `failure_state`, `retention_state`, `coverage_basis`, `verification_evidence`.
- Journal events: `coverage.observed`, `coverage.gap_recorded`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_COVERAGE; see the projection definitions in the JSON crosswalk.
- Normalization: Every answer reports bounded population/time/source coverage and projection lag; empty does not mean complete. Only the authorized runtime derives verified coverage from completed pagination/import/reconciliation and actual grants. A signed producer may declare its source interval, but that declaration is labeled declared, not independently verified; it cannot mark unrelated sources complete.
- Open proof: Operational sync state may be mutable; retain immutable observations used to support historical completeness assertions.
- Question coverage: order-01, order-02, order-03, order-04, delivery-01, delivery-02, delivery-03, delivery-04, invoice-01, invoice-02, invoice-03, invoice-04, collection-01, collection-02, collection-03, collection-04, settlement-01, settlement-02, settlement-03, settlement-04, reversal-01, reversal-02, reversal-03, reversal-04.

<a id="data-identity"></a>
### identity

- Required fields: `entity_type`, `entity_id`, `connection_id`, `account_namespace`, `external_id`, `relationship_type`, `target_id`, `evidence_id`, `confidence`, `revision`.
- Journal events: `entity.link_recorded`, `entity.link_revised`, `entity.link_conflict`.
- Applicable tracks: source, fact.
- PostgreSQL: Immutable typed payload and entity/evidence links in the canonical PostgreSQL journal; mutable current state only in rebuildable projections. Event family determines which listed tracks apply; never emit all tracks blindly.
- Rust / RAM: P_COVERAGE; see the projection definitions in the JSON crosswalk.
- Normalization: Namespace every ID; ambiguous joins remain separate. Correct links append and trigger incremental recomputation.
- Open proof: SKU/email/order number alone never establishes cross-source identity.
- Question coverage: order-01, order-02, order-03, order-04, delivery-01, delivery-02, delivery-03, delivery-04, invoice-01, invoice-02, invoice-03, invoice-04, collection-01, collection-02, collection-03, collection-04, settlement-01, settlement-02, settlement-03, settlement-04, reversal-01, reversal-02, reversal-03, reversal-04.

## Verification boundary

Register checks prove structural consistency, immutable evidence references and recorded approval requirements. They do not prove that a person really ran a test or that an external account exposes every field. Inspect evidence and reproduce tests. Git branch protection / required checks must be configured separately by a repository administrator; this file alone cannot prevent an administrator from bypassing the workflow.

# Source operations, first implemented subset

This increment covers scheduled Shopify orders, payments and refunds. The remaining selected Shopify and Shopify Payments capabilities remain implementation work, not unsupported provider claims. All provider proof here is synthetic. Authorized account access and independent review remain unavailable.

## Authority and durable boundaries

Owner-only `/v1/sources/shopify` validates an installed app token or same-organization client-credentials grant against Shopify Admin GraphQL 2026-10. A second session check occurs after provider IO. The shop's immutable GID is compared during reconnect and on each import page. A different shop needs a new connection. Source credentials are AES-256-GCM encrypted with tenant/connection associated data; only API/worker roles can read the protected table. Tokens never enter URLs, canonical business payloads, browser persistence or diagnostics. This is a local outbound flow; no public callback, gateway or remote mode is installed.

`/preview` resolves a proposed range and shows known restrictions. `/import` resolves the confirmation once and appends a versioned plan. The first workspace suggestion remains fixed. Thirty days means 720 hours; calendar-month subtraction clamps the day; custom dates start at local midnight. Strict from-now requires all three explicit context flags and cannot backfill older parents implicitly. History expansion appends a plan and separate run, preserving earlier coverage and business history.

Migration 004 separates immutable plans/checks from mutable secrets/jobs/cohorts/health. RLS and composite tenant foreign keys cover every table. One running job per tenant/connection/capability is enforced by a partial unique index. A 60-second fenced lease protects each page. The journal/outbox and logical object's progress are committed in one transaction after checking lease, connection state and credential revision. The next provider cursor is saved only after the page's objects are durably committed. Duplicate replays retain the object's original committed outcome. Failed/expired workers cannot advance a new lease's progress.

The independent background source loop processes at most two tenants concurrently, one page at a time. Delta collection is scheduled separately from initial history, with a fixed page-chain cutoff, five-minute overlap and durable deduplication. Default polling is 120 seconds plus 0–10% positive jitter; reconciliation is six hours. Provider HTTP/GraphQL throttles honor Retry-After/cost recovery and bounded exponential retry attempts. Eight consecutive failures require owner retry. Pausing a historical run does not pause the separate live job. Pausing the connection fences future commits. Cancellation preserves journal history.

## Actual provider selections and normalization

- Identity: `shop.id`, `shop.ianaTimezone`, `currentAppInstallation.accessScopes.handle`. Required base grant: read_orders (or write_orders); history beyond the normal 60-day order scope requires read_all_orders. No token implies a grant.
- Orders: updated-time bounded outer pagination (`first:10`), `id`, `createdAt`, `updatedAt`, `test`, `currencyCode`, `closed`, `cancelledAt`, `taxesIncluded`, `totalPriceSet.shopMoney`, and nested line-item pagination (`first:100`, explicit 500-line budget). Order total uses the before-returns total, not `currentTotalPriceSet`.
- Lines: stable line/inventory-item GIDs, `quantity`, `currentQuantity`, `originalTotalSet`, `discountAllocations.allocatedAmountSet`, and `taxLines.priceSet`. Gross normalization subtracts exact minor-unit discounts and adds taxes only for tax-exclusive prices. Missing inventory identity, ambiguous refunded/removed line quantities, currency disagreement or arithmetic overflow is quarantined, never replaced with zero.
- Payments/refunds: the untruncated `transactions` array plus exact `transactionsCount` must agree (explicit 200-transaction budget). `id`, `kind`, `status`, `processedAt`, `test`, `amountSet`, and `parentTransaction.id` map to typed records. Authorization is separate from capture. Successful SALE/CAPTURE is cash; VOID is not cash. Refunds retain the original payment record ID and do not become credit entitlements. Unmapped statuses, missing times and missing refund parents are visible quarantines.
- Accessible older context uses an explicit open/unsettled order search. It cannot certify every unresolved obligation; this restriction is retained. Initial/live/reconciliation requests never imply lossless intermediate transition history.

Malformed object evidence remains encrypted and linked to a review case. Page-level schema/pagination errors retain the checkpoint and retry state. No silent truncation is accepted as completion. The original P1 adapter remains available for its preserved synthetic regression; the new scheduled adapter is `packages/connectors/shopify-source.ts`.

## Snapshot scope and truthful progress

Each fully validated entity snapshot can append declared, entity-specific coverage at the fixed run cutoff. `history_kind=snapshot_only` is accepted by questions-v5 only for that exact instant and without a historical `from` window. The record does not assert a full event history. Historical-as-known queries retain both their recorded cutoff and effective/as-of scope. All provider coverage remains declared, not independently verified; answers remain partial. Changes to query semantics have a new rule version.

Cohorts count orders or transactions, not HTTP calls or internal journal rows. `discovered`, `committed_objects`, `processed_objects`, `duplicates`, `skipped` and `quarantined` come from durable rows. Processed means the required journal cursor was applied; it is not a claim that every question has all dependencies. No exact total or fabricated percentage is shown. Successful empty polls advance the scoped check timestamp but not the last-new timestamp. The Sources screen shows the same durable capability/run state as the owner readiness service, with EN/DE date selection, limitations, pause/resume/retry/cancel and reconnect controls.

Remaining work includes the other selected provider capabilities, provider-wide coverage slices, shared per-answer source-health metadata, bounded operational retention, credential/key rotation, reviewed quarantine repair and complete source acceptance evidence. Full IMPORT/HEALTH/PILOT acceptance has not been claimed.

## Reproduction

With the isolated native developer stack already built and running:

```sh
pnpm typecheck
pnpm test
python3 scripts/verify-sources.py --output .runtime/source-evidence.json
python3 scripts/verify-questions.py --output .runtime/questions-v3-evidence.json
```

The source runner drives actual local provider HTTP, PostgreSQL, Rust, API, Chrome and SDK MCP. It restarts the local processes and database between seed and recovery; then the real worker completes an import after the browser is closed. Fixtures are synthetic. Native fallback runs do not certify Compose installation, a release archive, performance targets or live Shopify.

Schema sources consulted on 2026-10-31: [Order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order), [LineItem](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem), [TaxLine](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/TaxLine), [same-organization authentication](https://shopify.dev/docs/apps/build/authentication-authorization/client-credentials-grant). Exact per-capability register mapping artifacts and independent confirmation are still required.

## Provider revision conflicts

Orders use a stable provider revision identity (record plus updated time); transactions add their lifecycle kind. Changed content at the same provider revision is quarantined and retains both encrypted claims. Under the journal head lock, older content-addressed identities are reused, so upgrading and replaying cannot duplicate previously accepted business records. Current entity coverage carries an explicit source conflict; questions-v5 exposes it while keeping fixed-cutoff answers and original source payloads unchanged.

Quarantined runs do not advance successful-check/reconciliation times. Unresolved review objects keep capability health in needs-review even after a later successful empty check. That later check describes only its own scope; it cannot repair the earlier gap. The conflict verification uses real PostgreSQL/API/SDK MCP, including an old-identity compatibility case.

The owner review subset now supports evidenced typed corrections, proposed links and retained-source retry; see owner-review.md. Structured conflicts also have an immutable scoped coverage assertion, preserving historical-as-known conflict visibility. Transaction evidence retains its minimal order context for isolated reprocessing. Full failed-derivation, lifecycle and policy operations remain active work.

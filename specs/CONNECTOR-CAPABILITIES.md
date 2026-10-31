# Connector capability audit for the question catalogue

The central implementation and evidence work list is [INTEGRATIONS.md](../INTEGRATIONS.md). Follow [its update and verification rules](../integrations/README.md); this specification supplies requirements, while the register owns source-capability progress and confirmation.

Reviewed on 2026-10-31 against the public sources linked below. The implementation repository still contains specifications and a static prototype. **No merchant API credentials were used, no live business API calls were made and no connector is implemented by this audit.** Public schema inspection is not account, integration or end-to-end verification.

The [JSON contract](question-data-contracts.json) contains the exact candidate source-field mappings and normalized required fields. The [question matrix](QUESTION-DATA-COVERAGE.md) links them to journal tracks, RAM projections and query tests. Exact adapter selection sets, payload schemas and per-field account coverage remain implementation proof obligations.

## Launch and supplemental inputs

| Source | Intended first-release input | Unresolved proof before a complete live answer |
| --- | --- | --- |
| Shopify | Orders/lines, quantity states, fulfillments, payment attempts, returns and refund observations | Permissions, historical coverage, line versions and identity joins; reservation and receipt semantics |
| Shopify Payments | Ledger entries, fees, payout membership, provider balances and disputes | Detailed holds/availability, original-transaction linkage, booked chargeback semantics; independent bank evidence |
| easybill | Document chains/lines, reported payment markers, dispatch records | Correction signs, order/line links, version completeness, account field population and external sending |
| DHL | Tracking scans and forecasts for known shipment references | Correct API product/access, source coverage, mapping to shop shipment and permitted retention/use |
| Bank CSV | Independent booked bank entries and statement coverage | Actual merchant statement and unique payout matching; no automatic live bank feed |
| Signed generic API | Structured allocations, promises, warehouse evidence, communication/case context, holds and entitlements | A real authorized producer must supply these inputs; a schema is not a data source |
| Workspace rules | Allocation priority, invoice timing, delivery risk and review policy | Merchant-approved versioned rules; no silent guessed business policy |
| Replay | Synthetic positive and adversarial acceptance fixtures | Proves only the implementation path exercised, not a provider integration |

## Material mapping findings

1. Shopify exposes several named inventory states. The application must choose a coherent basis and prevent subtracting commitments from an already-net available quantity. A fulfillment location assignment is also not automatically a stock reservation. [Inventory states](https://shopify.dev/docs/apps/build/inventory-management-apps/manage-quantities-states), [fulfillment orders](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/FulfillmentOrder).
2. Capturing order history requires declared coverage: Shopify’s default order access is limited to a recent window; older access needs approval. Backfill does not recreate every historical revision that a provider no longer supplies. [Order access](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order).
3. Finance APIs provide ledger and payout candidates, but a total balance does not establish every desired balance component. Hold reasons/release promises and chargeback-to-original-payment links remain explicit gaps until verified. These are conclusions of this mapping review, not claims that no API/product can provide them. [Account](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAccount), [ledger](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsBalanceTransaction), [disputes](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsDispute).
4. easybill has document, payment-marker and postbox resources. Do not use Document.status as invoice payment status, and do not turn a reported payment marker into a second capture. Optional external/order references require validated association. The reviewed schema documents Europe/Berlin date-time interpretation; normalize deliberately. [Official OpenAPI](https://api.easybill.de/rest/v1/swagger.json).
5. A return request and a recorded disposition are distinct observations; validate the merchant’s actual warehouse workflow before claiming a received or sellable quantity. Unknown or missing disposition remains explicit. [Return](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Return), [disposition types](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/ReverseFulfillmentOrderDispositionType).
6. DHL Unified Tracking’s published conditions include a default deletion period after delivery unless otherwise agreed. This is a concrete deployment blocker for unrestricted perpetual tracking retention: confirm the chosen product/agreement and which raw/derived fields may remain. Do not assume a hash, derived fact or separate raw store automatically resolves it. The journal invariant remains; unsupported live storage must not be enabled. [DHL conditions and product coverage](https://developer.dhl.com/tracking).

## Required adapter evidence for every mapped field

The builder must record: pinned API/version and resource/JSON or GraphQL path; required grants; observed nullable/absent cases; normalization and units; canonical event and entity identity; raw evidence pointer; rule/projection owner; initial backfill and historical window; incremental/reconciliation cursor; deduplication and same-ID conflict handling; permitted retention; sanitized provider-shaped fixture; positive/negative contract test; authorized account result or exact blocker. Missing fields must disable the corresponding complete-answer capability, not silently become zero.

Coverage and identity checkpoints are produced by tenant-scoped internal ingestion/reconciliation services. External declarations of complete coverage remain labeled assertions until validated; a generic producer cannot mark another source complete.

Webhook receipt alone is not completeness. Verify authenticity against documented mechanisms and use authenticated re-fetch where necessary, overlap/reconcile polling windows, resume nested pagination and distinguish observed_at from effective time. Respect actual provider quotas and retry signals. The adapter capture interval determines data freshness; fast RAM queries cannot make unsynchronized data current.

Shared IDs and relationship rules are mandatory: store/account-scoped shop IDs; inventory item/location/unit mapping; order-line-to-fulfillment and tracking-number links; invoice/credit/line associations; original transaction and economic-effect identity; explicit invoice-payment allocation; payout member postings and bank matching. Preserve ambiguity and corrections in the journal.

## Source-by-source ingest plan

### Shopify

**Transport:** GraphQL Admin API: paginated backfill and reconciliation; verified HTTPS webhooks trigger durable receipt and re-fetch. Pin an API version and fixture schema; consume all nested pages.

**Prerequisites and open proof:** read_orders; older order access needs read_all_orders approval. read_inventory and appropriate fulfillment-order scopes; read_returns for return objects. Prove actual grants and protected customer-data access. Record history start and every missing scope.

Candidate resource families: Order / LineItem; LineItem pricing/quantity fields; InventoryLevel; FulfillmentOrder / FulfillmentOrderLineItem; Fulfillment; OrderTransaction; Return / Refund / ReverseFulfillmentOrderDisposition. See their source-to-canonical fields and caveats in the JSON contract.

Official references: [shopify_order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Order), [shopify_line](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/LineItem), [shopify_inventory](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/InventoryLevel), [shopify_inventory_states](https://shopify.dev/docs/apps/build/inventory-management-apps/manage-quantities-states), [shopify_fulfillment_order](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/FulfillmentOrder), [shopify_fulfillment_line](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/FulfillmentOrderLineItem), [shopify_fulfillment](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Fulfillment), [shopify_transaction](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/OrderTransaction), [shopify_return](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Return), [shopify_refund](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/Refund), [shopify_disposition](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ReverseFulfillmentOrderDisposition), [shopify_disposition_types](https://shopify.dev/docs/api/admin-graphql/2026-10/enums/ReverseFulfillmentOrderDispositionType), [shopify_webhooks](https://shopify.dev/docs/apps/build/webhooks/verify-deliveries).

### Shopify Payments

**Transport:** Query ShopifyPaymentsAccount balanceTransactions, payouts and disputes with pagination; reconcile provider balances independently of order ingestion.

**Prerequisites and open proof:** An eligible Shopify Payments account and actual finance/dispute grants. Account docs list read_shopify_payments or read_shopify_payments_accounts; payout objects require view_payouts permission and disputes require read_shopify_payments_disputes. Validate all field-level access in the pinned schema/account.

Candidate resource families: ShopifyPaymentsBalanceTransaction; ShopifyPaymentsPayout; ShopifyPaymentsAccount; ShopifyPaymentsDispute. See their source-to-canonical fields and caveats in the JSON contract.

Official references: [shopify_account](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAccount), [shopify_ledger](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsBalanceTransaction), [shopify_payout](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsPayout), [shopify_dispute](https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsDispute).

### easybill

**Transport:** GET /documents and /documents/{id}; /document-payments; /post-boxes; document versions where available. Reconcile edited_at with overlap and stable page handling. Webhook notifications can trigger authenticated re-fetch; verify the documented signature scheme before trusting payloads.

**Prerequisites and open proof:** Authorized account/API credential and actual plan limits. Schema reviewed: REST v1, info.version 1.103.1, SHA256 6d532f96a7fe82fcbd556178f8bd2a11f364061690f67ccb932d3722ac2b1e86. Verify signs, correction linkage, historical version completeness and account-specific field population in fixtures and an authorized account.

Candidate resource families: GET /documents/{id}; GET /document-payments; GET /post-boxes. See their source-to-canonical fields and caveats in the JSON contract.

Official references: [easybill](https://api.easybill.de/rest/v1/swagger.json).

### DHL Unified Tracking

**Transport:** GET https://api-eu.dhl.com/track/shipments?trackingNumber=... for known shop shipment references; optional authorized push subscriptions with reconciliation. Back off and stop/slow polling terminal shipments according to the actual contract.

**Prerequisites and open proof:** Eligible tracking numbers, API subscription key, product coverage and quotas. Published Unified Tracking terms include deletion 30 days after delivery unless otherwise agreed. Resolve retention and permitted downstream use before live append-only ingestion; raw-data separation alone does not establish rights to retain derived tracking facts indefinitely.

Candidate resource families: Unified Tracking shipment response. See their source-to-canonical fields and caveats in the JSON contract.

Official references: [dhl](https://developer.dhl.com/tracking), [dhl_push](https://developer.dhl.com/api-reference/shipment-tracking-unified-push).

### Validated bank statement CSV

**Transport:** Authorized upload -> versioned mapping/validation -> durable import records -> same journal/outbox/engine path.

**Prerequisites and open proof:** A statement supplied by the merchant, explicit account/currency/date/sign mapping and declared coverage interval. No live bank API is included.

Candidate resource families: Versioned bank CSV profile. See their source-to-canonical fields and caveats in the JSON contract.

### Signed typed business-event API

**Transport:** Versioned authenticated event envelope with idempotency key, tenant-bound connection, source identity, occurred_at and typed payload.

**Prerequisites and open proof:** Must be implemented and actually supplied by an authorized merchant system/operator. A defined schema does not collect data by itself.

Candidate resource families: Required supplemental event families. See their source-to-canonical fields and caveats in the JSON contract.

### Deterministic synthetic replay

**Transport:** Replay typed observations through the same tenant-scoped ingestion path.

**Prerequisites and open proof:** Clearly synthetic isolated workspace; no provider access claimed.

### Versioned workspace rules

**Transport:** Authorized settings/import appends rule-change evidence; runtime query reads the version effective at its cutoff.

**Prerequisites and open proof:** Owner-supplied allocation, invoicing, delivery-risk and reminder policy; no undocumented defaults that decide business obligations.

## Visible providers beyond the launch set

The following retain roadmap status. This audit does not claim field coverage or live connectivity for them: Shopware 6, WooCommerce, Mailbox, Lexware Office, sevdesk, Billbee, Sufio, Stripe standalone account, PayPal, Mollie, DPD, UPS, Klaviyo. They must each implement the same capability/field/fixture contract before being advertised as connected. Xentral remains absent. Shipping providers remain ordinary inputs to the shared recorder.

For a first complete implementation, build all 24 queries against the controlled synthetic/generic path, then prove the launch adapters capability by capability. Complete live answers require the tenant’s relevant supplementary feeds and rules as well as the shop/payment/invoice/carrier connections.

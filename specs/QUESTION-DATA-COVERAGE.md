# Question-to-data coverage contract

Status: **specification and public API documentation checked; software and real integrations not implemented or tested**. This supplements the existing build brief, journal/MCP and performance contracts. The original 24 question texts remain unchanged.

The earlier question catalogue described needs, methods and results, while architecture described the common pipeline. It did not yet join every question to provider fields, journal families, RAM projections and specific acceptance examples. This catalogue supplies that crosswalk. It does not turn documented APIs into verified integrations.

## Read and build from these artifacts

- [Machine-readable contract](question-data-contracts.json): 24 stable intent IDs, 26 input datasets, 11 logical projections, provider field mappings, 24 positive and 24 missing-data cases, and additional adversarial cases.
- [Provider audit and boundaries](CONNECTOR-CAPABILITIES.md): launch candidates, supplemental feeds, account/coverage limitations and roadmap providers.
- [Per-question execution register](../reports/question-coverage.json): design review separated from actual adapter, query, API/MCP, recovery and live verification.
- [Original question catalogue](../reference/questions.json), [journal contract](JOURNAL-AND-MCP.md) and [performance contract](PERFORMANCE-ARCHITECTURE.md) remain binding.

## One durable path for every question

```text
authenticated source / validated import / authorized rule change
  -> TypeScript adapter: validate, preserve source identity, normalize syntax
  -> PostgreSQL: append source observations + immutable evidence links + durable dispatch
  -> Rust: deterministic interpretation, linked facts/commitments/movements/reservations
  -> commit required derived journal records and projection/checkpoint state
  -> atomically publish bounded RAM projections at a coherent applied cursor
  -> shared authorized query -> UI or MCP -> result + calculation + evidence + coverage
```

There must be no independently acknowledged PostgreSQL/RAM dual write. Every published business effect is recoverable from committed journal records and versioned rules. Use the existing durability/checkpoint contract and document transaction boundaries for derived entries. Raw source, financial effect and overlapping provider observation are not three separate cash movements. Reads requiring a committed cursor wait within a bound or return an explicit lag/recovery result.

The logical durable relations are canonical entries, immutable entity/evidence links, provider-identity mappings and versioned projection/checkpoint data. The builder supplies concrete DDL/migrations; this is not an installed schema. Index `(tenant_id, journal_sequence)`, entity-to-entry locators `(tenant_id, entity_type, entity_id, journal_sequence)`, record history and provider/account/external identity. Keep immutable records separate from mutable operational cursors/caches. No per-order full journal scan or N+1 evidence lookup.

RAM stores typed current values, relationships, open-work indexes and bounded summaries, with tenant and currency/unit keys. PostgreSQL serves indexed cold history and batch hydration. Every logical projection below has a durable/checkpoint and cold-read path; no requirement to put every historical JSON/PDF/email into memory. Broad plans and scans are bounded/paginated or asynchronous, and are not covered by the hot point-lookup latency claim.

## Current data feasibility findings

- **9 questions** have documented launch-provider candidate paths, still conditional on scopes, links, coverage and semantic tests.
- **11 questions** need explicit additional merchant rules, allocations, promises, communication, warehouse evidence or refund decisions.
- **3 questions** have unresolved provider-detail assumptions, particularly balance/hold breakdowns and chargeback transaction mapping.
- **1 question** specifically requires independent bank-statement import; bank evidence also contributes to the complete provider-money overview.
- **0 questions are implemented or live-verified in this seed.** These four categories classify the main open data dependency; they do not mean mutually exclusive technical requirements or measured readiness.

The signed generic-event API, validated bank CSV and versioned workspace rules are already in the first-release direction. Use them to close genuine source gaps without silently widening launch to every displayed provider. Replay proves the synthetic pipeline only. A merchant must actually supply the corresponding source data; otherwise the answer exposes missing inputs. All 24 positive paths remain required in isolated synthetic acceptance.

## Question matrix

All rows also require scoped identity and coverage, coherent committed/applied cursors, exact evidence and the shared output envelope. Dataset and projection IDs resolve in the JSON contract.

| ID / question | Required datasets | RAM projections | Primary data dependency |
| --- | --- | --- | --- |
| `order-01` — Can I still sell 100 Olive Cups? | stock | P_STOCK, P_PROMISE | documented_provider_path: Validate inventory state basis and scope; optional incoming supply is separately unknown if absent. |
| `order-02` — Which open orders can be fulfilled entirely from available stock? | orders, stock, allocations, policy | P_ORDER, P_STOCK, P_CONTEXT | supplemental_data_required: Explicit reservations or declared derived allocation and merchant priority policy. |
| `order-03` — Which orders have a mismatch between promised and reserved quantities? | orders, allocations, fulfillments | P_ORDER, P_STOCK, P_SHIPMENT | supplemental_data_required: Line-level reservation ownership cannot be inferred from an aggregate stock number. |
| `order-04` — Which open orders are affected by a delayed incoming delivery? | orders, supply, allocations, promises | P_ORDER, P_PROMISE, P_STOCK | supplemental_data_required: Supplier/PO promise revisions and supply-to-order dependencies require a supplemental feed. |
| `delivery-01` — Where are my parcels, and which need attention? | fulfillments, tracking, policy | P_SHIPMENT, P_CONTEXT | documented_provider_path: DHL entitlement/retention and exact shop shipment link; merchant stale-scan threshold is configurable. |
| `delivery-02` — Which customer delivery commitments are overdue or at risk? | orders, promises, fulfillments, tracking, policy | P_PROMISE, P_SHIPMENT, P_CONTEXT | supplemental_data_required: Explicit customer deadline and timezone; carrier ETA is not that promise. |
| `delivery-03` — Which partial deliveries still have missing items? | orders, fulfillments, tracking | P_ORDER, P_SHIPMENT | documented_provider_path: Per-line shipment association and handover/delivery evidence; packing gaps remain explicit. |
| `delivery-04` — What can I reliably tell this customer about their delivery status? | orders, fulfillments, tracking, communications | P_ORDER, P_SHIPMENT, P_CONTEXT, P_PROMISE | supplemental_data_required: Prior communication needs a reviewed feed or later mailbox/helpdesk integration. |
| `invoice-01` — Which invoices are still outstanding? | invoices | P_INVOICE | documented_provider_path: Correction chain, payment markers and invoice/order links must be validated per account. |
| `invoice-02` — Which orders still need an invoice under our invoicing rule? | orders, fulfillments, invoices, policy | P_ORDER, P_INVOICE, P_SHIPMENT, P_CONTEXT | supplemental_data_required: Merchant invoicing trigger plus complete invoice population and confirmed cross-system links. |
| `invoice-03` — Where does the invoice amount differ from the agreed order amount? | orders, invoices | P_ORDER, P_INVOICE | documented_provider_path: Version-aligned line equivalence and currency basis; unmatched shipping/tax/discount allocation stays unresolved. |
| `invoice-04` — Which invoices were created but have no evidence of being sent? | invoices, invoice_dispatch | P_INVOICE | documented_provider_path: easybill postbox coverage must include external-send limitations; sending is not receipt. |
| `collection-01` — Which orders are only authorized, actually paid or still awaiting payment? | orders, payments | P_ORDER, P_PAYMENT | documented_provider_path: Successful transaction amounts and gateway/account identity, not just order financial labels. |
| `collection-02` — Which failed payments have since been completed successfully? | orders, payments | P_ORDER, P_PAYMENT | documented_provider_path: Complete attempt history and same-order identity; later success can still be only partial. |
| `collection-03` — Which invoices have a mismatch between partial payments and the remaining amount? | invoices, payments, payment_allocations | P_INVOICE, P_PAYMENT | supplemental_data_required: Proven invoice-to-payment allocation; multiple invoices and manual payments need explicit association. |
| `collection-04` — Which due receivables should Finance review today? | invoices, payment_allocations, payments, policy, cases | P_INVOICE, P_PAYMENT, P_CONTEXT | supplemental_data_required: Reminder policy, investigations and agreed extensions require explicit business context. |
| `settlement-01` — Where is my money across payment providers? | provider_ledger, positions, payouts, bank, holds | P_PROVIDER, P_BANK | provider_detail_unverified: Detailed held/processing/available breakdown and independent bank coverage are not implied by the default finance API. |
| `settlement-02` — Why is the payout lower than captured customer payments? | provider_ledger, payouts | P_PROVIDER | documented_provider_path: Complete payout member postings and signed adjustments; do not explain using all payments in a date window. |
| `settlement-03` — Which announced or sent payouts still lack bank evidence? | payouts, bank | P_PROVIDER, P_BANK | bank_import_required: A real validated bank-statement import is required; provider payout status alone is insufficient. |
| `settlement-04` — Which amounts are held, and which releases are only announced? | holds, positions | P_PROVIDER | provider_detail_unverified: A verified source for hold identity/reason/amount and release promise is still needed. |
| `reversal-01` — Which returns are announced, received or already refunded? | returns, receipts, refunds | P_REVERSAL, P_STOCK, P_PAYMENT | supplemental_data_required: Actual line-level warehouse receipt/disposition and refund links; a return request is only intent. |
| `reversal-02` — Which credit notes are missing their corresponding refund? | invoices, payments, entitlements, refunds | P_INVOICE, P_PAYMENT, P_REVERSAL | supplemental_data_required: Explicit refund entitlement, original payment and destination; an unpaid invoice credit may only reduce debt. |
| `reversal-03` — What still needs correcting in stock, invoicing and payment after a cancellation? | orders, allocations, invoices, payments, refunds, entitlements, receipts | P_ORDER, P_STOCK, P_INVOICE, P_PAYMENT, P_REVERSAL | supplemental_data_required: Reservation ownership and financial/warehouse reconciliation context must be available, including explicit not-applicable states. |
| `reversal-04` — Is there a risk of duplicate repayment through both a refund and a chargeback? | payments, refunds, disputes | P_PAYMENT, P_REVERSAL, P_PROVIDER | provider_detail_unverified: Exact original-transaction linkage plus booked chargeback debit/reversal evidence is still unproven for the default adapter. |

## Required RAM access structures

| ID | State | Main access path |
| --- | --- | --- |
| `P_ORDER` | Order and line graph | Direct order lookup; active-order index by status/customer/item, then bounded line expansion. |
| `P_STOCK` | Inventory and allocation state | Direct item/location lookup; reverse item-to-open-order index; bounded policy-based allocation simulation. |
| `P_PROMISE` | Current promises and revisions | Open promises by item/due date/order and incoming-supply-to-order adjacency. |
| `P_SHIPMENT` | Shipment and line progress | Order-to-shipments adjacency and status/last-scan/expected-date indexes; bounded scan history pages. |
| `P_INVOICE` | Receivables and document chains | Open receivables by due/customer/currency; order-to-document adjacency; revision locators. |
| `P_PAYMENT` | Payment attempts and allocations | Order-to-attempts and transaction-to-allocation indexes; unresolved/failed-attempt subsets. |
| `P_PROVIDER` | Provider balances and payouts | Per-account/currency rollup; payout-ID-to-postings adjacency; pending payout and active-hold indexes. |
| `P_BANK` | Bank matching | Indexed payout reference plus currency/amount/date candidate lookup; never an unconditional amount-only join. |
| `P_REVERSAL` | Return, refund and dispute graph | Open-return/refund indexes and original-transaction-to-refund/dispute adjacency; bounded per-order checklists. |
| `P_CONTEXT` | Rules and permitted communication context | Direct rule/case lookup and customer-to-evidence locators; raw messages remain outside hot state. |
| `P_COVERAGE` | Coverage, identity and evidence locators | Check on every query; tenant/entity/sequence index for cold history; scope-bound fixed-snapshot pagination. |

## Correctness decisions that must survive implementation

1. **Inventory basis:** distinguish physical, committed, reserved, quarantine/quality control, damaged, safety stock and already-net available quantities. Subtract each unavailable unit once; exclude incoming promises. Preserve the simpler Golden Scenario when its other categories are zero.
2. **Allocation:** distinguish location assignment, observed reservation and a policy-derived plan. A bounded joint fulfillment plan cannot promise the same free units to two orders. It must not mutate upstream reservations.
3. **Promises:** supplier receipt commitments, customer delivery promises and carrier estimates are separate evidence types. Missing promises cannot be replaced by guessed dates.
4. **Money:** separate order capture, invoice-tool payment marker, credit, pending/completed cash refund, provider balance, payout and booked bank entry. Retain currency, original transaction and payout membership; never sum superseded snapshots.
5. **Returns:** request, physical receipt, quarantine, restock, credit and cash refund each need their own evidence. A credit reducing an unpaid invoice need not create a cash refund.
6. **Negative claims:** no invoice, no send, no bank receipt, no prior promise and no remaining work require appropriate complete population/time coverage. Unknown and partial are not empty results.
7. **Evidence access:** raw communications and provider-restricted evidence are separately controlled; a readable journal pointer is not permission to expose content or retain restricted derived data forever.
8. **Provider contract:** validate the chosen DHL product and permitted storage period before enabling perpetual carrier facts. Do not weaken append-only history or assume raw-data deletion resolves every restriction. Capture authorized customer-owned warehouse/dispatch evidence separately when available.

## Acceptance and completion

Run `python3 scripts/validate-question-catalogue.py` to check specification counts, original question identity, dataset/projection/provider references and the coverage register. This consistency check does not execute product behavior.

Under QUERY-01/QUERY-02, turn each row’s sufficient/missing cases into executable fixtures plus the listed edge cases. Assert typed values and exact evidence, not only prose. Replay every positive through the actual tenant-scoped ingest → PostgreSQL → Rust path, query via both API and MCP, restart the engine and query again, then exercise cold hydration and changed quantities/IDs. Enforce the existing tenant, journal and performance suites. Never pass all 24 by returning unknown everywhere.

Under SOURCE-01–04, prove the adapter field mapping with sanitized provider-shaped fixtures and mock HTTP contracts, then separately test a permitted account. Record exact schema/version, grants, missing fields, history window, retention/usage conditions, backfill completeness and rates. Mark external verification pending when access is unavailable. A custom canonical replay event is not a provider-contract fixture.

Populate reports/question-coverage.json and reports/acceptance.json only from actual commands and evidence. Every required input must have a verified production source for a tenant’s complete answer, or that tenant’s result remains partial/insufficient. Supplemental schemas, query plans and examples are prepared; executable fixtures, adapters, SQL migrations, Rust reducers/indexes and runtime proof still have to be built.

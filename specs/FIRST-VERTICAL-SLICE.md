# First persisted Shopify-to-answer slice

Binding implementation sequence after baseline-v13: prove the important path early, then expand. This does not launch either agent or implement the software. Keep the full P0–P4 scope, all prior business/security gates and the stop-for-feedback condition.

## P0: settle the minimum and begin

Record the actual host/runtime/tools, minimal SQL migration and journal/order/transaction schemas, maintained crypto/session choices, TypeScript/Rust RPC schema and one genuine supported Shopify authorization path. Check current provider documentation/grants and account prerequisites; do not assume a universal localhost OAuth flow. Pin the actual API version and record limitations in the central capability mappings. This is a short feasibility check, not a framework project or permission to change a merchant account.

Use an authorized test/development store when available. Merchant/provider credentials and account changes require the existing owner authorization; never create real orders, charges or refunds just to obtain proof without it. Missing access is recorded as blocked_external with the exact grant/account prerequisite. Continue the identical persisted pipeline against a provider-shaped local HTTP fixture; that result is explicitly synthetic.

## P1: prove the complete path before expanding the UI

1. Start the real local PostgreSQL/API/worker/Rust stack with one owner/workspace and a distinct read-only agent principal. Minimal owner setup, diagnostics and source controls are sufficient initially; do not build the full landing/catalog first.
2. Connect a Shopify-shaped provider with an order, order lines and linked transaction/capture/refund observations. Use actual adapter HTTP/pagination/normalization behavior, not direct inserts of precomputed canonical answers. The fixture varies IDs/amounts and includes missing/duplicate/out-of-order input; make test-payment status explicit.
3. Append Source plus the required derived Fact/Movement records through the real transactional journal/outbox boundary. Commit before acknowledging or advancing input progress. Preserve actual currency/quantity semantics, identity joins and evidence.
4. Apply deterministic Rust reducers, persist the checkpoint and publish consistent RAM state. Observe and expose committed versus applied cursor. Query the order's paid/outstanding state and provenance through both the UI/API and real SDK MCP protocol path with current agent authorization.
5. Restart the whole stack, then the engine with its acceleration snapshot removed/corrupt. Repeat the same fixed-cutoff query and compare normalized business values, evidence and authorization; ephemeral timing fields need not match. Query latest_committed separately and disclose any genuinely newer observations. Do not regenerate demo state or lose/double business effects.
6. Demonstrate a late correction, a permission-revoked agent and a second synthetic tenant using colliding external order IDs. Show correct current/historical answers, stale-engine behavior and denial, with safe correlated logs.

SLICE-01 is the provider-shaped persisted acceptance gate. Record its actual passing checkpoint before broad P2 work. If an implementation defect blocks the slice, fix it; a mock or future plan is not a substitute. All five tracks and all 24 intents are still required later; this deliberately small first slice does not reduce those obligations.

## Earliest authorized live proof

SLICE-02 repeats connect/read/commit/apply/query/restart against the actual Shopify API for an authorized store, using its real order and transaction identifiers and recorded grants/version. Read-only proof uses existing authorized data; test/development transactions remain labeled and do not prove real settlement. Capture the exact observed subset and missing fields without committing customer secrets/content to evidence reports. A successful token check alone is insufficient.

Attempt this in P0/P1 as soon as access and the slice permit, before investing in the full interface. If credentials/provider environment are unavailable, keep SLICE-02 blocked/unverified while continuing independent P2/P3 work; it must pass before an unqualified pilot-complete handover. Later SOURCE-01 and selected Shopify Payments ledger/payout/refund/dispute coverage remain separate obligations, with actual account prerequisites and evidence. A Shopify order transaction or synthetic capture is not proof of Shopify Payments payout or bank-settlement access.

For both gates, record commit, reproducible commands, versions, expected/observed results, tenant/principal/cursor boundaries and sanitized artifact paths in reports/acceptance.json. Keep source-capability implementation/test/history/reviewer records honest. Never claim independent review from a self-authored report. This early checkpoint is proof of a narrow vertical path, not completion of the product.

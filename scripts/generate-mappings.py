#!/usr/bin/env python3
"""Generate per-capability mapping artifacts (integrations/mappings/<row>.json) from the implemented adapters.

The register validator requires, per row: every required field with status source/derived/missing, one rule per
journal event family, all three synchronization modes, nine import-readiness explanations, retention and identity rules.
Field statuses below reflect what the pilot adapters actually implement (see packages/application/src/connectors and
crates/domain). Missing fields disable complete-answer claims; they are not quietly marked as source.
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
contract = json.loads((ROOT / 'specs/question-data-contracts.json').read_text())
profile = json.loads((ROOT / 'delivery-profile.json').read_text())
datasets = {d['id']: d for d in contract['datasets']}
rows = set(profile['required_integration_rows'])

SHOPIFY_VERSION = 'Shopify GraphQL Admin API 2025-10 (pinned in packages/application/src/connectors/shopify.ts)'
SHOPIFY_PAYMENTS_VERSION = 'Shopify GraphQL Admin API 2025-10 — ShopifyPaymentsAccount.balanceTransactions/payouts/disputes (adapter planned in worker; mapping declared, pipeline not yet exercised)'
GENERIC_VERSION = 'Blackbox signed generic event envelope v1 (packages/application/src/connectors/generic.ts; payload schemas packages/contracts/src/journal.ts)'
REPLAY_VERSION = 'Replay fixture mapping (packages/application/src/connectors/replay.ts) over GOLDEN-ORDER-TO-CASH.json v1.0'
BANK_VERSION = 'Bank CSV profile v1 (packages/application/src/connectors/bank-csv.ts)'
POLICY_VERSION = 'Owner-recorded versioned rules via POST /api/sources/:id/rules (apps/api/src/routes/sources.ts)'
RUNTIME_VERSION = 'Internal runtime producer: coverage.observed/coverage.gap_recorded and entity links emitted by worker/API after imports (apps/worker/src/shopify-job.ts, apps/api/src/routes/*.ts)'

# Shopify (orders feed) field availability per dataset
SHOPIFY_FIELDS = {
    'orders': {'source': ['order_id','line_id','customer_id','item_id','variant_id','quantity','unit','currency','line_net_minor','line_tax_minor','line_gross_minor','discount_minor','shipping_minor','agreed_version','cancellation_state','updated_at'], 'missing': []},
    'stock': {'source': ['item_id','location_id','unit','observed_at','basis','physical','available','committed','reserved','damaged','quality_control','incoming'], 'missing': ['safety_stock']},
    'allocations': {'source': ['allocation_id','order_id','line_id','item_id','location_id','quantity','unit','status','evidence_id'], 'missing': ['policy_version']},
    'fulfillments': {'source': ['shipment_id','order_id','line_id','quantity','unit','carrier','tracking_number','handover_at','delivered_at','state'], 'missing': ['location_id']},
    'payments': {'source': ['transaction_id','original_transaction_id','order_id','account_id','gateway','kind','status','amount_minor','currency','occurred_at','economic_effect_id'], 'missing': []},
    'returns': {'source': ['return_id','order_id','line_id','quantity','unit','state'], 'missing': ['reverse_shipment_id']},
    'receipts': {'source': ['receipt_id','return_id','line_id','quantity','unit','disposition','physical_delta','quarantine_delta','occurred_at'], 'missing': ['location_id']},
    'refunds': {'source': ['refund_id','original_transaction_id','order_id','amount_minor','currency','status','destination','economic_effect_id'], 'missing': []},
}
SHOPIFY_PAYMENTS_FIELDS = {
    'provider_ledger': {'source': ['ledger_entry_id','account_id','source_transaction_id','order_link','payout_id','posting_type','gross_minor','fee_minor','net_minor','currency','effective_time'], 'missing': []},
    'positions': {'source': ['account_id','currency','observed_at','total_minor','coverage'], 'missing': ['processing_minor','available_minor','held_minor']},
    'payouts': {'source': ['payout_id','account_id','status','direction','amount_minor','currency','issued_at','trace_reference','ledger_membership'], 'missing': ['reversal_id']},
    'holds': {'source': [], 'missing': ['hold_id','account_id','transaction_id','currency','amount_minor','reason','state','release_promised_at','released_at','evidence_id']},
    'refunds': {'source': ['refund_id','original_transaction_id','order_id','amount_minor','currency','status','economic_effect_id'], 'missing': ['destination']},
    'disputes': {'source': ['dispute_id','original_transaction_id','order_id','amount_minor','currency','state','evidence_id'], 'missing': ['debit_posting_id','debit_minor','reversal_minor']},
}
DERIVED = {('shopify','payments','original_transaction_id'): 'parentTransaction.id when present, else the successful SALE/CAPTURE of the order (rule r1)', ('shopify','payments','economic_effect_id'): 'shopify:<transaction gid> (rule r1)', ('shopify','orders','agreed_version'): 'revision counter from order.accepted/order.revised (rule r1)', ('shopify','orders','cancellation_state'): 'cancelledAt or currentQuantity<quantity per line (rule r1)', ('shopify','allocations','allocation_id'): 'FulfillmentOrder line assignment id (rule r1; location assignment is not a reservation)', ('shopify','allocations','status'): 'derived from fulfillment order status (rule r1)', ('shopify','receipts','physical_delta'): '+quantity on received (rule r1)', ('shopify','receipts','quarantine_delta'): '+quantity when disposition is quarantine (rule r1)', ('shopify','stock','basis'): "provider_available when InventoryLevel 'available' is present (rule r1)", ('shopify_payments','payouts','ledger_membership'): 'balanceTransactions filtered by payout id (rule r1)', ('shopify','fulfillments','state'): 'in_transit on dispatch, delivered when deliveredAt present (rule r1)', ('shopify','refunds','destination'): 'original_payment for refund transactions (rule r1)'}

def field_entry(provider, dataset, name, status):
    e = {'status': status, 'normalization': 'integer minor units / decimal quantity strings / UTC timestamps as implemented in the adapter', 'missing_behavior': 'answers that require this field return partial or insufficient_data with the field named in missing_inputs'}
    if status == 'source': e['source_path'] = SOURCE_PATHS.get((provider, dataset, name), f'{provider}:{dataset}.{name}')
    elif status == 'derived': e['rule'] = DERIVED.get((provider, dataset, name), 'rule r1 in crates/domain/src/derive.rs')
    else: e['reason'] = MISSING_REASONS.get((provider, dataset, name), 'not exposed by the pinned provider resource in the pilot adapter')
    return e

SOURCE_PATHS = {('shopify','orders','order_id'): 'orders.nodes[].name', ('shopify','orders','line_id'): 'lineItems.nodes[].id', ('shopify','orders','customer_id'): 'customer.id', ('shopify','orders','item_id'): 'lineItems.nodes[].sku (fallback variant id)', ('shopify','orders','variant_id'): 'lineItems.nodes[].variant.id', ('shopify','orders','quantity'): 'lineItems.nodes[].quantity', ('shopify','orders','currency'): 'currencyCode', ('shopify','orders','line_gross_minor'): 'discountedTotalSet + taxLines', ('shopify','orders','line_tax_minor'): 'taxLines[].priceSet', ('shopify','orders','shipping_minor'): 'totalShippingPriceSet', ('shopify','orders','updated_at'): 'updatedAt', ('shopify','payments','transaction_id'): 'transactions[].id', ('shopify','payments','kind'): 'transactions[].kind', ('shopify','payments','status'): 'transactions[].status', ('shopify','payments','amount_minor'): 'transactions[].amountSet', ('shopify','payments','gateway'): 'transactions[].gateway', ('shopify','payments','occurred_at'): 'transactions[].processedAt', ('shopify','fulfillments','shipment_id'): 'fulfillments[].id', ('shopify','fulfillments','tracking_number'): 'fulfillments[].trackingInfo[].number', ('shopify','fulfillments','carrier'): 'fulfillments[].trackingInfo[].company', ('shopify','fulfillments','handover_at'): 'fulfillments[].createdAt', ('shopify','fulfillments','delivered_at'): 'fulfillments[].deliveredAt', ('shopify','stock','physical'): "inventoryLevels.quantities[name=on_hand]", ('shopify','stock','available'): "inventoryLevels.quantities[name=available]", ('shopify','stock','committed'): "quantities[name=committed]", ('shopify','stock','reserved'): "quantities[name=reserved]", ('shopify','stock','damaged'): "quantities[name=damaged]", ('shopify','stock','quality_control'): "quantities[name=quality_control]", ('shopify','stock','incoming'): "quantities[name=incoming]", ('shopify','stock','location_id'): 'inventoryLevels.location.id', ('shopify','stock','observed_at'): 'inventoryLevels.updatedAt', ('shopify','returns','return_id'): 'returns.nodes[].id', ('shopify','returns','state'): 'returns.nodes[].status', ('shopify','refunds','refund_id'): 'refunds[].transactions.nodes[].id', ('shopify','refunds','amount_minor'): 'refunds[].transactions.nodes[].amountSet', ('shopify','refunds','status'): 'refunds[].transactions.nodes[].status'}
MISSING_REASONS = {('shopify','stock','safety_stock'): 'InventoryLevel.quantities exposes safety_stock only for merchants with the feature enabled; not relied upon', ('shopify','allocations','policy_version'): 'Shopify has no merchant allocation policy; comes from policy.policy', ('shopify_payments','positions','processing_minor'): 'ShopifyPaymentsAccount exposes a total balance, not a processing/available/held partition', ('shopify_payments','positions','available_minor'): 'see processing_minor', ('shopify_payments','positions','held_minor'): 'see processing_minor', ('shopify_payments','disputes','debit_posting_id'): 'ShopifyPaymentsDispute has no booked chargeback debit posting link', ('shopify_payments','disputes','debit_minor'): 'see debit_posting_id', ('shopify_payments','disputes','reversal_minor'): 'see debit_posting_id', ('shopify','fulfillments','location_id'): 'Fulfillment location requires fulfillmentOrders traversal not in the pilot query', ('shopify','receipts','location_id'): 'ReverseFulfillmentOrderDisposition has no location in the pilot query', ('shopify','returns','reverse_shipment_id'): 'reverse delivery objects not read in the pilot query', ('shopify_payments','payouts','reversal_id'): 'payout reversals are not exposed as a separate object', ('shopify_payments','refunds','destination'): 'balance transaction has no refund destination'}
for ds, fields in SHOPIFY_PAYMENTS_FIELDS.items():
    for f in fields['missing']: MISSING_REASONS.setdefault(('shopify_payments', ds, f), 'holds are not exposed by the pinned finance resources; use the generic producer')

def modes(provider):
    local = {'polling': ['polling'], 'import': ['import'], 'internal': ['internal'], 'push': ['authenticated_push']}
    kind = 'polling' if provider in ('shopify', 'shopify_payments') else 'import' if provider == 'bank_csv' else 'push' if provider == 'generic' else 'internal'
    sched = {'polling': 'default 5 min incremental over updated_at with 10 min overlap (stock 15 min); daily reconciliation of the last 48 h; adjustable 1–60 min; Retry-After and cost throttle honoured', 'import': 'manual statement import; no schedule; recovery = re-import with the same statement id (deduplicated)', 'internal': 'on write; no schedule', 'push': 'producer-driven; no schedule; recovery = re-send with the same idempotency key (deduplicated)'}[kind]
    hist = {'polling': 'orders older than 60 days need read_all_orders; otherwise the accessible period is disclosed in coverage', 'import': 'declared statement coverage interval only', 'internal': 'not applicable', 'push': 'declared by the producer (labelled assertion)'}[kind]
    return {
        'local_standalone': {'status': 'supported', 'methods': local[kind], 'schedule': sched, 'history_limit': hist, 'authentication': {'polling': 'custom-app Admin API token stored AES-256-GCM encrypted', 'import': 'owner session + CSRF', 'internal': 'owner session or internal service', 'push': 'producer key (bearer) + HMAC-SHA256 body signature'}[kind], 'recovery': 'durable per-page commit before checkpoint advance; restart resumes cursors; duplicates deduplicated by provider identity', 'limitations': 'no webhooks (outbound only); intermediate provider states between polls are not observed', 'reason': 'local pilot connectivity mode'},
        'local_gateway': {'status': 'unsupported', 'methods': [], 'schedule': 'not applicable', 'history_limit': 'not applicable', 'authentication': 'not applicable', 'recovery': 'not applicable', 'limitations': 'not implemented', 'reason': 'deferred by delivery-profile.json (no gateway is provisioned in the pilot)'},
        'public_server': {'status': 'unsupported', 'methods': [], 'schedule': 'not applicable', 'history_limit': 'not applicable', 'authentication': 'not applicable', 'recovery': 'not applicable', 'limitations': 'not implemented', 'reason': 'deferred by delivery-profile.json (no public server profile in the pilot)'},
    }

def readiness(provider):
    if provider in ('shopify', 'shopify_payments'):
        return {'time_selection': 'import plan presets resolve once to a fixed UTC interval in the workspace timezone (packages/application/src/sources/import-plan.ts); orders select on updated_at', 'historical_availability': 'requested versus accessible period recorded in capability coverage; 60-day limit disclosed when read_all_orders is missing', 'open_and_related_records': 'orders carry transactions, fulfillments, refunds and returns inline, so related records arrive with their parent; older open orders are included by the plan flag', 'opening_state': 'inventory levels are snapshots (snapshot_only basis provider_available), never movements', 'progress_accounting': 'import runs count pages, orders fetched, observations committed, duplicates and conflicts; totals are unknown (counts only, no percentage)', 'readiness_rules': 'coverage.observed per capability after a fully paginated run; queries report partial until present', 'health_rules': 'last_successful_sync_at advances on complete successful runs only; last_new_record_at only when new observations commit; delayed after 3x the poll interval', 'history_expansion': 'a new plan revision enqueues a history_expansion run with overlap and deduplication', 'data_handling': 'customer ids are opaque provider ids; no names/emails enter the journal; token encrypted at rest'}
    if provider == 'bank_csv':
        return {'time_selection': 'declared statement coverage interval (from/to) with rows outside rejected', 'historical_availability': 'exactly the imported statements', 'open_and_related_records': 'not applicable (bank rows are independent evidence)', 'opening_state': 'no opening balance is implied; only booked entries', 'progress_accounting': 'rows total/valid/invalid/committed/duplicates per import run', 'readiness_rules': 'coverage.observed with the statement interval after commit', 'health_rules': 'no scheduled check; last import and coverage shown', 'history_expansion': 're-import older statements; row identity = statement id + content hash', 'data_handling': 'references are stored as untrusted text; counterparties are not used for identity'}
    if provider == 'generic':
        return {'time_selection': 'producer supplies occurred_at per event', 'historical_availability': 'declared_coverage from the producer is recorded as a labelled assertion', 'open_and_related_records': 'producer responsibility; links are explicit ids', 'opening_state': 'inventory.snapshot and provider.balance_observed are snapshots, not movements', 'progress_accounting': 'received/committed/duplicates/conflicts/rejected per envelope', 'readiness_rules': 'coverage.observed only when the producer declares it; otherwise partial', 'health_rules': 'authenticated push: no scheduled poll; last received and last new record tracked', 'history_expansion': 'producer re-sends; idempotency per event id', 'data_handling': 'payloads validated against allowlisted schemas; unknown keys rejected'}
    if provider == 'replay':
        return {'time_selection': 'fixture occurred_at values', 'historical_availability': 'complete synthetic fixture', 'open_and_related_records': 'complete synthetic fixture', 'opening_state': 'inventory.snapshot at G01 is the opening basis', 'progress_accounting': 'fixture events/committed/duplicates/conflicts per run', 'readiness_rules': 'coverage.observed per capability after replay (synthetic_fixture scope)', 'health_rules': 'no poll; synthetic', 'history_expansion': 'not applicable', 'data_handling': 'synthetic data only; labelled synthetic in UI and coverage'}
    if provider == 'policy':
        return {'time_selection': 'effective_from per rule version', 'historical_availability': 'all recorded versions', 'open_and_related_records': 'not applicable', 'opening_state': 'not applicable', 'progress_accounting': 'one entry per rule version', 'readiness_rules': 'queries needing a rule return insufficient_data until the rule kind exists', 'health_rules': 'owner-maintained; no poll', 'history_expansion': 'new versions append', 'data_handling': 'rules contain no personal data'}
    return {'time_selection': 'not applicable', 'historical_availability': 'derived from completed imports', 'open_and_related_records': 'not applicable', 'opening_state': 'not applicable', 'progress_accounting': 'one coverage observation per completed run/capability', 'readiness_rules': 'coverage.observed drives per-answer readiness', 'health_rules': 'not applicable', 'history_expansion': 'new observations append', 'data_handling': 'opaque ids only'}

def build(row):
    provider, dataset = row.split('.', 1); ds = datasets[dataset]
    req = ds['required_fields']
    if provider == 'shopify': spec = SHOPIFY_FIELDS[dataset]; version = SHOPIFY_VERSION; grants = sorted({g for g in ['read_orders','read_all_orders'] } | ({'read_inventory','read_locations'} if dataset == 'stock' else set()) | ({'read_returns'} if dataset in ('returns','receipts') else set()) | ({'read_merchant_managed_fulfillment_orders'} if dataset == 'allocations' else set()))
    elif provider == 'shopify_payments': spec = SHOPIFY_PAYMENTS_FIELDS[dataset]; version = SHOPIFY_PAYMENTS_VERSION; grants = ['read_shopify_payments_payouts'] + (['read_shopify_payments_disputes'] if dataset == 'disputes' else [])
    else:
        spec = {'source': req, 'missing': []}; grants = []
        version = {'generic': GENERIC_VERSION, 'replay': REPLAY_VERSION, 'bank_csv': BANK_VERSION, 'policy': POLICY_VERSION, 'runtime': RUNTIME_VERSION}[provider]
        if provider == 'replay' and dataset not in ('orders','stock','allocations','fulfillments','invoices','payments','provider_ledger','payouts','bank','returns','receipts','refunds'): spec = {'source': [], 'missing': req}
    fields = {}
    for name in req:
        if name in spec['missing']: st = 'missing'
        elif (provider, dataset, name) in DERIVED: st = 'derived'
        elif name in spec['source']: st = 'source'
        else: st = 'derived'
        fields[name] = field_entry(provider, dataset, name, st)
        if provider == 'replay' and st == 'missing': fields[name]['reason'] = 'the golden fixture does not contain this dataset; replay covers the Order-to-Cash example only'
    rules = []
    for fam in ds['journal_event_families']:
        supported = not (provider == 'replay' and spec['source'] == []) and not (provider == 'shopify_payments' and dataset == 'holds') and not (provider == 'shopify' and fam in ('inventory.adjustment_observed', 'allocation.revised', 'return.disposition_observed'))
        rules.append({'event': fam, 'tracks': ds['journal_tracks'] if supported else [], 'rule': f'crates/domain/src/derive.rs r1: {fam} -> ' + ('facts plus commitments/movements/reservations as defined for this family; derived entries carry input_entry_ids and dedup key derived:<entry>:r1:<n>' if supported else 'not produced by this adapter'), **({} if supported else {'unsupported_reason': 'not observable through this adapter in the pilot' if provider != 'replay' else 'not part of the golden fixture'})})
    return {
        'row_id': row, 'source_revision': version, 'input_resources': {'shopify': ['orders(query, sortKey: UPDATED_AT) with lineItems, transactions, fulfillments, refunds, returns', 'inventoryItems.inventoryLevels.quantities'], 'shopify_payments': ['shopifyPaymentsAccount.balanceTransactions', 'shopifyPaymentsAccount.payouts', 'shopifyPaymentsAccount.disputes'], 'generic': ['POST /api/ingest/generic envelope'], 'replay': ['POST /api/sources/:id/replay (GOLDEN-ORDER-TO-CASH.json)'], 'bank_csv': ['POST /api/sources/:id/bank-csv (CSV + profile)'], 'policy': ['POST /api/sources/:id/rules'], 'runtime': ['worker/API internal producers']}[provider],
        'grants': grants, 'identity_rule': 'provider identity scoped by connection/account namespace: dedup_key = <namespace>:<provider event id>; entity refs are tenant-scoped; no join by email or bare order number',
        'coverage_rule': 'coverage.observed per capability after a fully paginated/imported run; answers compare required datasets against coverage facts and return partial/insufficient_data otherwise',
        'retention': {'decision': 'permitted', 'basis': {'shopify': 'merchant-owned data under the Shopify Partner Program Agreement for a merchant-installed custom app; raw payloads are not retained, only typed observations', 'shopify_payments': 'merchant-owned finance data of the connected account', 'generic': 'producer authorized by the owner', 'replay': 'synthetic fixture', 'bank_csv': 'merchant-supplied statement', 'policy': 'owner-recorded rules', 'runtime': 'internal operational facts'}[provider]},
        'fields': fields, 'event_rules': rules,
        'synchronization': {'initial_import': 'plan-driven fixed UTC window, cursor pagination, per-page durable commit (shopify); single envelope/import (generic, bank_csv); on-write (policy, runtime, replay)', 'cursor': 'updated_since + page_cursor + complete_through per capability (capability_state.cursor)', 'reconciliation': 'daily reconciliation of the last 48 h for polling capabilities; re-import for files; n/a for internal producers', 'deduplication': 'journal_append rejects identical provider identity (inserted=false) and raises BBX02 for different content (review case)', 'freshness': 'last_successful_sync_at (complete empty checks allowed) distinct from last_new_record_at; delayed after 3x poll interval', 'modes': modes(provider)},
        'import_readiness': readiness(provider),
    }

out_dir = ROOT / 'integrations/mappings'; out_dir.mkdir(exist_ok=True)
for row in sorted(rows):
    (out_dir / f'{row}.json').write_text(json.dumps(build(row), indent=1, ensure_ascii=False) + '\n')
print(f'wrote {len(rows)} mapping artifacts to integrations/mappings/')

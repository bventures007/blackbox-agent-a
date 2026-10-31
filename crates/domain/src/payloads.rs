//! Typed source observation payloads (schema_version 1). Field names match packages/contracts/src/journal.ts.
use serde::{Deserialize, Serialize};
use serde_json::Value;

fn d_default_loc() -> String { "default".into() }
fn d_one() -> i64 { 1 }
fn d_true() -> bool { true }
fn d_physical_components() -> String { "physical_components".into() }
fn d_sale() -> String { "sale".into() }
fn d_confirmed() -> String { "confirmed".into() }
fn d_final() -> String { "final".into() }
fn d_original_payment() -> String { "original_payment".into() }
fn d_quarantine() -> String { "quarantine".into() }
fn d_booked() -> String { "booked".into() }
fn d_bank() -> String { "bank".into() }
fn d_internal() -> String { "internal".into() }
fn d_workspace() -> String { "workspace".into() }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrderLine {
    pub line_id: String, pub item_id: String, #[serde(default)] pub variant_id: Option<String>,
    pub quantity: String, pub unit: String,
    #[serde(default)] pub unit_gross_minor: Option<i64>, #[serde(default)] pub line_net_minor: Option<i64>,
    #[serde(default)] pub line_tax_minor: Option<i64>, pub line_gross_minor: i64, #[serde(default)] pub discount_minor: Option<i64>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrderAccepted { pub order_id: String, #[serde(default)] pub customer_id: Option<String>, pub currency: String, pub lines: Vec<OrderLine>,
    #[serde(default)] pub shipping_minor: Option<i64>, pub gross_minor: i64, #[serde(default = "d_one")] pub agreed_version: i64, #[serde(default)] pub placed_at: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrderRevised { pub order_id: String, pub agreed_version: i64, pub currency: String, pub lines: Vec<OrderLine>, pub gross_minor: i64, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CancelLine { pub line_id: String, pub quantity: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct OrderCancelled { pub order_id: String, #[serde(default)] pub lines: Option<Vec<CancelLine>>, #[serde(default = "d_true")] pub full: bool, #[serde(default)] pub reason: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InventorySnapshot { pub item_id: String, #[serde(default = "d_default_loc")] pub location_id: String, pub unit: String,
    #[serde(default = "d_physical_components")] pub basis: String,
    #[serde(default)] pub physical: Option<String>, #[serde(default)] pub available: Option<String>, #[serde(default)] pub committed: Option<String>,
    #[serde(default)] pub reserved: Option<String>, #[serde(default)] pub damaged: Option<String>, #[serde(default)] pub safety_stock: Option<String>,
    #[serde(default)] pub quality_control: Option<String>, #[serde(default)] pub incoming: Option<String>, #[serde(default)] pub observed_at: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InventoryAdjustment { pub item_id: String, #[serde(default = "d_default_loc")] pub location_id: String, pub unit: String, pub physical_delta: String, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InventoryReserved { pub reservation_id: String, pub order_id: String, #[serde(default)] pub line_id: Option<String>, pub item_id: String,
    #[serde(default = "d_default_loc")] pub location_id: String, pub quantity: String, pub unit: String, #[serde(default)] pub policy_version: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReservationReleased { pub reservation_id: String, pub quantity: String, pub unit: String, pub reason: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AllocationRevised { pub reservation_id: String, pub quantity: String, pub unit: String, pub revision: i64 }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SupplyCommitment { pub promise_id: String, pub supplier_id: String, pub item_id: String, #[serde(default = "d_default_loc")] pub location_id: String,
    pub quantity: String, pub unit: String, pub promised_at: String, pub timezone: String, #[serde(default = "d_one")] pub revision: i64, #[serde(default)] pub allocation_links: Vec<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct SupplyRevised { pub promise_id: String, #[serde(default)] pub quantity: Option<String>, #[serde(default)] pub unit: Option<String>, pub promised_at: String, pub timezone: String, pub revision: i64, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CustomerCommitment { pub promise_id: String, pub order_id: String, #[serde(default)] pub line_id: Option<String>, pub promised_at: String, pub timezone: String,
    pub promise_kind: String, #[serde(default = "d_one")] pub revision: i64, #[serde(default)] pub evidence_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CustomerRevised { pub promise_id: String, pub promised_at: String, pub timezone: String, pub revision: i64, #[serde(default)] pub evidence_id: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShipLine { pub line_id: String, #[serde(default)] pub item_id: Option<String>, pub quantity: String, pub unit: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShipmentObserved { pub shipment_id: String, pub order_id: String, pub lines: Vec<ShipLine>, #[serde(default)] pub carrier: Option<String>,
    #[serde(default)] pub tracking_number: Option<String>, pub state: String, #[serde(default)] pub location_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DispatchLine { pub line_id: String, pub item_id: String, pub quantity: String, pub unit: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShipmentDispatched { pub shipment_id: String, pub order_id: String, pub lines: Vec<DispatchLine>, #[serde(default = "d_default_loc")] pub location_id: String,
    #[serde(default)] pub carrier: Option<String>, #[serde(default)] pub tracking_number: Option<String>, #[serde(default)] pub reservation_id: Option<String>, #[serde(default)] pub handover_at: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShipmentDelivered { pub shipment_id: String, #[serde(default)] pub order_id: Option<String>, #[serde(default)] pub delivered_at: Option<String>, #[serde(default)] pub carrier_status: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ShipmentCancelled { pub shipment_id: String, #[serde(default)] pub order_id: Option<String>, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CarrierScan { pub carrier_service: String, pub tracking_number: String, pub scan_identity: String, pub status_code: String, pub effective_time: String, #[serde(default)] pub timezone: Option<String>, #[serde(default)] pub shipment_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CarrierForecast { pub carrier_service: String, pub tracking_number: String, pub forecast: Option<String>, #[serde(default)] pub shipment_id: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CommunicationObserved { pub message_id: String, #[serde(default)] pub customer_id: Option<String>, #[serde(default)] pub order_id: Option<String>, pub sent_at: String, pub actor: String, pub evidence_id: String, #[serde(default = "d_internal")] pub visibility_scope: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReviewedCommitment { pub promise_id: String, pub promised_at: String, pub kind: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ExtractionReviewed { pub message_id: String, pub reviewed_commitments: Vec<ReviewedCommitment>, pub reviewer: String }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InvoiceLineLink { pub line_id: String, #[serde(default)] pub quantity: Option<String>, #[serde(default)] pub gross_minor: Option<i64> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InvoiceIssued { pub document_id: String, pub invoice_id: String, #[serde(default)] pub order_id: Option<String>, #[serde(default)] pub customer_id: Option<String>, pub currency: String, pub gross_minor: i64,
    #[serde(default)] pub due_date: Option<String>, #[serde(default)] pub line_links: Vec<InvoiceLineLink>, #[serde(default = "d_one")] pub revision: i64, #[serde(default = "d_final")] pub draft_state: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InvoiceRevised { pub document_id: String, pub invoice_id: String, pub revision: i64, pub gross_minor: i64, pub currency: String, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CreditIssued { pub document_id: String, pub invoice_id: String, pub credit_id: String, pub currency: String, pub credit_minor: i64, #[serde(default)] pub cash_refund_confirmed: bool }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct InvoiceCancelled { pub document_id: String, pub invoice_id: String, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PaymentMarked { pub invoice_id: String, #[serde(default)] pub transaction_id: Option<String>, pub paid_minor: i64, pub currency: String, #[serde(default)] pub is_new_cash_movement: bool, #[serde(default)] pub marked_at: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DispatchObserved { pub dispatch_id: String, pub document_id: String, pub channel: String, pub status: String, #[serde(default)] pub processed_at: Option<String>, #[serde(default)] pub source_scope: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PaymentAuthorized { pub transaction_id: String, pub order_id: String, #[serde(default)] pub account_id: Option<String>, #[serde(default)] pub gateway: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default)] pub test: bool }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PaymentCaptured { pub transaction_id: String, #[serde(default)] pub parent_transaction_id: Option<String>, pub order_id: String, #[serde(default)] pub account_id: Option<String>, #[serde(default)] pub gateway: Option<String>,
    pub amount_minor: i64, pub currency: String, #[serde(default)] pub test: bool, #[serde(default)] pub economic_effect_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PaymentFailed { pub transaction_id: String, pub order_id: String, pub amount_minor: i64, pub currency: String, #[serde(default = "d_sale")] pub kind: String, #[serde(default)] pub error_code: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PaymentVoided { pub transaction_id: String, pub parent_transaction_id: String, pub order_id: String, pub amount_minor: i64, pub currency: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AllocationRecorded { pub allocation_id: String, pub invoice_id: String, pub transaction_id: String, pub amount_minor: i64, pub currency: String, #[serde(default = "d_confirmed")] pub confidence: String, #[serde(default = "d_one")] pub revision: i64, #[serde(default)] pub evidence_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct AllocationRevisedPay { pub allocation_id: String, pub amount_minor: i64, pub currency: String, pub revision: i64, pub confidence: String }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RuleRecorded { pub rule_id: String, pub rule_kind: String, pub version: i64, pub effective_from: String, #[serde(default = "d_workspace")] pub scope: String,
    #[serde(default)] pub priority_method: Option<String>, #[serde(default)] pub invoicing_trigger: Option<String>, #[serde(default)] pub tolerance: Option<Value>,
    #[serde(default)] pub currency: Option<String>, #[serde(default)] pub timezone: Option<String>, #[serde(default)] pub reminder_policy: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RuleRevised { pub rule_id: String, pub version: i64, pub effective_from: String, pub changes: Value }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CaseRecorded { pub case_id: String, #[serde(default)] pub customer_id: Option<String>, #[serde(default)] pub invoice_id: Option<String>, #[serde(default)] pub transaction_id: Option<String>, pub status: String, #[serde(default)] pub agreed_extension_until: Option<String>, #[serde(default)] pub evidence_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CaseRevised { pub case_id: String, pub status: String, #[serde(default)] pub agreed_extension_until: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LedgerPosted { pub ledger_entry_id: String, pub account_id: String, #[serde(default)] pub source_transaction_id: Option<String>, #[serde(default)] pub order_id: Option<String>, #[serde(default)] pub payout_id: Option<String>,
    pub posting_type: String, pub gross_minor: i64, #[serde(default)] pub fee_minor: i64, pub net_minor: i64, pub currency: String, #[serde(default)] pub effective_time: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct FeeBooked { pub transaction_id: String, #[serde(default)] pub account_id: Option<String>, pub fee_minor: i64, pub currency: String, #[serde(default)] pub ledger_entry_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BalanceObserved { pub account_id: String, pub currency: String, pub observed_at: String, #[serde(default)] pub total_minor: Option<i64>, #[serde(default)] pub processing_minor: Option<i64>,
    #[serde(default)] pub available_minor: Option<i64>, #[serde(default)] pub held_minor: Option<i64>, pub coverage: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PayoutAnnounced { pub payout_id: String, #[serde(default)] pub account_id: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default)] pub expected_at: Option<String>, #[serde(default)] pub trace_reference: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PayoutSent { pub payout_id: String, #[serde(default)] pub account_id: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default)] pub issued_at: Option<String>, #[serde(default)] pub trace_reference: Option<String>, #[serde(default)] pub ledger_membership: Option<Vec<String>> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PayoutFailed { pub payout_id: String, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct PayoutReversed { pub payout_id: String, pub reversal_id: String, pub amount_minor: i64, pub currency: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BankCredit { pub entry_id: String, #[serde(default)] pub statement_id: Option<String>, #[serde(default = "d_bank")] pub account_id: String, #[serde(default)] pub booked_at: Option<String>, #[serde(default)] pub value_at: Option<String>,
    pub amount_minor: i64, pub currency: String, #[serde(default)] pub reference: Option<String>, #[serde(default)] pub payout_id: Option<String>, #[serde(default = "d_booked")] pub booking_status: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BankDebit { pub entry_id: String, #[serde(default)] pub statement_id: Option<String>, #[serde(default = "d_bank")] pub account_id: String, #[serde(default)] pub booked_at: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default)] pub reference: Option<String>, #[serde(default = "d_booked")] pub booking_status: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BankMatch { pub entry_id: String, pub payout_id: String, pub confidence: String, #[serde(default)] pub evidence_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct BankMatchRevised { pub entry_id: String, pub payout_id: Option<String>, pub confidence: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HoldRecorded { pub hold_id: String, pub account_id: String, #[serde(default)] pub transaction_id: Option<String>, pub currency: String, pub amount_minor: i64, pub reason: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct HoldReleased { pub hold_id: String, pub amount_minor: i64, pub currency: String, #[serde(default)] pub released_at: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReleasePromised { pub hold_id: String, pub release_promised_at: String }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReturnLine { #[serde(default)] pub line_id: Option<String>, pub item_id: String, pub quantity: String, pub unit: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReturnApproved { pub return_id: String, pub order_id: String, pub lines: Vec<ReturnLine>, #[serde(default)] pub expected_credit_minor: Option<i64>, #[serde(default)] pub currency: Option<String>, #[serde(default)] pub reverse_shipment_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReturnRevised { pub return_id: String, pub lines: Vec<ReturnLine> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReturnCancelled { pub return_id: String, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReturnReceived { pub receipt_id: String, pub return_id: String, pub item_id: String, #[serde(default = "d_default_loc")] pub location_id: String, pub quantity: String, pub unit: String, #[serde(default = "d_quarantine")] pub disposition: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReturnRestocked { pub receipt_id: String, pub return_id: String, pub item_id: String, #[serde(default = "d_default_loc")] pub location_id: String, pub quantity: String, pub unit: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DispositionObserved { pub receipt_id: String, pub return_id: String, pub item_id: String, pub quantity: String, pub unit: String, pub disposition: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EntitlementRecorded { pub entitlement_id: String, #[serde(default)] pub order_id: Option<String>, #[serde(default)] pub invoice_id: Option<String>, #[serde(default)] pub credit_id: Option<String>, pub original_transaction_id: String,
    pub amount_minor: i64, pub currency: String, pub destination: String, #[serde(default)] pub approved_at: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EntitlementRevised { pub entitlement_id: String, pub amount_minor: i64, pub currency: String, pub state: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RefundPending { pub refund_id: String, pub original_transaction_id: String, #[serde(default)] pub order_id: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default = "d_original_payment")] pub destination: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RefundCompleted { pub refund_id: String, pub original_transaction_id: String, #[serde(default)] pub order_id: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default)] pub economic_effect_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RefundFailed { pub refund_id: String, pub original_transaction_id: String, pub amount_minor: i64, pub currency: String, #[serde(default)] pub error_code: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RefundReversed { pub refund_id: String, pub original_transaction_id: String, pub amount_minor: i64, pub currency: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DisputeOpened { pub dispute_id: String, pub original_transaction_id: String, #[serde(default)] pub order_id: Option<String>, pub amount_minor: i64, pub currency: String, #[serde(default)] pub reason: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct DisputeResolved { pub dispute_id: String, pub outcome: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ChargebackDebit { pub dispute_id: String, pub debit_posting_id: String, pub original_transaction_id: String, pub debit_minor: i64, #[serde(default)] pub fee_minor: i64, pub currency: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ChargebackReversed { pub dispute_id: String, pub reversal_posting_id: String, pub reversal_minor: i64, pub currency: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CoverageObserved { pub capability: String, pub entity_scope: String, pub history_start: Option<String>, pub complete_through: Option<String>, pub backfill_complete: bool, pub coverage_basis: String, #[serde(default)] pub missing_fields: Vec<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CoverageGap { pub capability: String, pub from: String, pub to: Option<String>, pub reason: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LinkRecorded { pub entity_type: String, pub entity_id: String, pub relationship_type: String, pub target_type: String, pub target_id: String, pub confidence: String, #[serde(default = "d_one")] pub revision: i64, #[serde(default)] pub evidence_id: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LinkRevised { pub entity_type: String, pub entity_id: String, pub relationship_type: String, pub target_type: String, pub target_id: Option<String>, pub confidence: String, pub revision: i64 }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LinkConflict { pub entity_type: String, pub entity_id: String, pub relationship_type: String, pub candidates: Vec<String>, pub reason: String }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ReviewDecision { pub case_id: String, pub decision: String, pub reason: String, pub actor_kind: String, #[serde(default)] pub asserted: Option<Value> }

/// Every supported source observation, parsed from (event_type, payload).
#[derive(Clone, Debug, PartialEq)]
pub enum Source {
    OrderAccepted(OrderAccepted), OrderRevised(OrderRevised), OrderCancelled(OrderCancelled),
    InventorySnapshot(InventorySnapshot), InventoryAdjustment(InventoryAdjustment),
    InventoryReserved(InventoryReserved), ReservationReleased(ReservationReleased), AllocationRevised(AllocationRevised),
    SupplyCommitment(SupplyCommitment), SupplyRevised(SupplyRevised), CustomerCommitment(CustomerCommitment), CustomerRevised(CustomerRevised),
    ShipmentObserved(ShipmentObserved), ShipmentDispatched(ShipmentDispatched), ShipmentDelivered(ShipmentDelivered), ShipmentCancelled(ShipmentCancelled),
    CarrierScan(CarrierScan), CarrierForecast(CarrierForecast), CommunicationObserved(CommunicationObserved), ExtractionReviewed(ExtractionReviewed),
    InvoiceIssued(InvoiceIssued), InvoiceRevised(InvoiceRevised), CreditIssued(CreditIssued), InvoiceCancelled(InvoiceCancelled), PaymentMarked(PaymentMarked), DispatchObserved(DispatchObserved),
    PaymentAuthorized(PaymentAuthorized), PaymentCaptured(PaymentCaptured), PaymentFailed(PaymentFailed), PaymentVoided(PaymentVoided),
    AllocationRecorded(AllocationRecorded), AllocationRevisedPay(AllocationRevisedPay),
    RuleRecorded(RuleRecorded), RuleRevised(RuleRevised), CaseRecorded(CaseRecorded), CaseRevised(CaseRevised),
    LedgerPosted(LedgerPosted), FeeBooked(FeeBooked), BalanceObserved(BalanceObserved),
    PayoutAnnounced(PayoutAnnounced), PayoutSent(PayoutSent), PayoutFailed(PayoutFailed), PayoutReversed(PayoutReversed),
    BankCredit(BankCredit), BankDebit(BankDebit), BankMatch(BankMatch), BankMatchRevised(BankMatchRevised),
    HoldRecorded(HoldRecorded), HoldReleased(HoldReleased), ReleasePromised(ReleasePromised),
    ReturnApproved(ReturnApproved), ReturnRevised(ReturnRevised), ReturnCancelled(ReturnCancelled), ReturnReceived(ReturnReceived), ReturnRestocked(ReturnRestocked), DispositionObserved(DispositionObserved),
    EntitlementRecorded(EntitlementRecorded), EntitlementRevised(EntitlementRevised),
    RefundPending(RefundPending), RefundCompleted(RefundCompleted), RefundFailed(RefundFailed), RefundReversed(RefundReversed),
    DisputeOpened(DisputeOpened), DisputeResolved(DisputeResolved), ChargebackDebit(ChargebackDebit), ChargebackReversed(ChargebackReversed),
    CoverageObserved(CoverageObserved), CoverageGap(CoverageGap), LinkRecorded(LinkRecorded), LinkRevised(LinkRevised), LinkConflict(LinkConflict),
    ReviewDecision(ReviewDecision),
}

#[derive(Debug, thiserror::Error)]
pub enum ParseError {
    #[error("unsupported event type {0}")] Unsupported(String),
    #[error("invalid payload for {0}: {1}")] Invalid(String, String),
}

macro_rules! p { ($t:ty, $v:ident, $payload:expr, $et:expr) => { serde_json::from_value::<$t>($payload.clone()).map(Source::$v).map_err(|e| ParseError::Invalid($et.to_string(), e.to_string())) }; }

impl Source {
    pub fn parse(event_type: &str, payload: &Value) -> Result<Source, ParseError> {
        match event_type {
            "order.accepted" => p!(OrderAccepted, OrderAccepted, payload, event_type), "order.revised" => p!(OrderRevised, OrderRevised, payload, event_type),
            "order.cancelled" => p!(OrderCancelled, OrderCancelled, payload, event_type),
            "inventory.snapshot" => p!(InventorySnapshot, InventorySnapshot, payload, event_type), "inventory.adjustment_observed" => p!(InventoryAdjustment, InventoryAdjustment, payload, event_type),
            "inventory.reserved" => p!(InventoryReserved, InventoryReserved, payload, event_type), "inventory.reservation_released" => p!(ReservationReleased, ReservationReleased, payload, event_type),
            "allocation.revised" => p!(AllocationRevised, AllocationRevised, payload, event_type),
            "supply.commitment_recorded" => p!(SupplyCommitment, SupplyCommitment, payload, event_type), "supply.commitment_revised" => p!(SupplyRevised, SupplyRevised, payload, event_type),
            "customer.commitment_recorded" => p!(CustomerCommitment, CustomerCommitment, payload, event_type), "customer.commitment_revised" => p!(CustomerRevised, CustomerRevised, payload, event_type),
            "shipment.observed" => p!(ShipmentObserved, ShipmentObserved, payload, event_type), "shipment.dispatched" => p!(ShipmentDispatched, ShipmentDispatched, payload, event_type),
            "shipment.delivered" => p!(ShipmentDelivered, ShipmentDelivered, payload, event_type), "shipment.cancelled" => p!(ShipmentCancelled, ShipmentCancelled, payload, event_type),
            "carrier.scan_observed" => p!(CarrierScan, CarrierScan, payload, event_type), "carrier.forecast_observed" => p!(CarrierForecast, CarrierForecast, payload, event_type),
            "communication.observed" => p!(CommunicationObserved, CommunicationObserved, payload, event_type), "communication.extraction_reviewed" => p!(ExtractionReviewed, ExtractionReviewed, payload, event_type),
            "invoice.issued" => p!(InvoiceIssued, InvoiceIssued, payload, event_type), "invoice.revised" => p!(InvoiceRevised, InvoiceRevised, payload, event_type),
            "invoice.credit_issued" => p!(CreditIssued, CreditIssued, payload, event_type), "invoice.cancelled" => p!(InvoiceCancelled, InvoiceCancelled, payload, event_type),
            "invoice.payment_marked" => p!(PaymentMarked, PaymentMarked, payload, event_type), "invoice.dispatch_observed" => p!(DispatchObserved, DispatchObserved, payload, event_type),
            "payment.authorized" => p!(PaymentAuthorized, PaymentAuthorized, payload, event_type), "payment.captured" => p!(PaymentCaptured, PaymentCaptured, payload, event_type),
            "payment.failed" => p!(PaymentFailed, PaymentFailed, payload, event_type), "payment.voided" => p!(PaymentVoided, PaymentVoided, payload, event_type),
            "payment.allocation_recorded" => p!(AllocationRecorded, AllocationRecorded, payload, event_type), "payment.allocation_revised" => p!(AllocationRevisedPay, AllocationRevisedPay, payload, event_type),
            "business.rule_recorded" => p!(RuleRecorded, RuleRecorded, payload, event_type), "business.rule_revised" => p!(RuleRevised, RuleRevised, payload, event_type),
            "business.case_recorded" => p!(CaseRecorded, CaseRecorded, payload, event_type), "business.case_revised" => p!(CaseRevised, CaseRevised, payload, event_type),
            "provider.ledger_posted" => p!(LedgerPosted, LedgerPosted, payload, event_type), "payment.fee_booked" => p!(FeeBooked, FeeBooked, payload, event_type),
            "provider.balance_observed" => p!(BalanceObserved, BalanceObserved, payload, event_type),
            "payout.announced" => p!(PayoutAnnounced, PayoutAnnounced, payload, event_type), "payout.sent" => p!(PayoutSent, PayoutSent, payload, event_type),
            "payout.failed" => p!(PayoutFailed, PayoutFailed, payload, event_type), "payout.reversed" => p!(PayoutReversed, PayoutReversed, payload, event_type),
            "bank.credit_booked" => p!(BankCredit, BankCredit, payload, event_type), "bank.debit_booked" => p!(BankDebit, BankDebit, payload, event_type),
            "bank.match_recorded" => p!(BankMatch, BankMatch, payload, event_type), "bank.match_revised" => p!(BankMatchRevised, BankMatchRevised, payload, event_type),
            "provider.hold_recorded" => p!(HoldRecorded, HoldRecorded, payload, event_type), "provider.hold_released" => p!(HoldReleased, HoldReleased, payload, event_type),
            "provider.release_promised" => p!(ReleasePromised, ReleasePromised, payload, event_type),
            "return.approved" => p!(ReturnApproved, ReturnApproved, payload, event_type), "return.revised" => p!(ReturnRevised, ReturnRevised, payload, event_type),
            "return.cancelled" => p!(ReturnCancelled, ReturnCancelled, payload, event_type), "return.received" => p!(ReturnReceived, ReturnReceived, payload, event_type),
            "return.restocked" => p!(ReturnRestocked, ReturnRestocked, payload, event_type), "return.disposition_observed" => p!(DispositionObserved, DispositionObserved, payload, event_type),
            "refund.entitlement_recorded" => p!(EntitlementRecorded, EntitlementRecorded, payload, event_type), "refund.entitlement_revised" => p!(EntitlementRevised, EntitlementRevised, payload, event_type),
            "refund.pending" => p!(RefundPending, RefundPending, payload, event_type), "refund.completed" => p!(RefundCompleted, RefundCompleted, payload, event_type),
            "refund.failed" => p!(RefundFailed, RefundFailed, payload, event_type), "refund.reversed" => p!(RefundReversed, RefundReversed, payload, event_type),
            "dispute.opened" => p!(DisputeOpened, DisputeOpened, payload, event_type), "dispute.resolved" => p!(DisputeResolved, DisputeResolved, payload, event_type),
            "chargeback.debit_posted" => p!(ChargebackDebit, ChargebackDebit, payload, event_type), "chargeback.reversed" => p!(ChargebackReversed, ChargebackReversed, payload, event_type),
            "coverage.observed" => p!(CoverageObserved, CoverageObserved, payload, event_type), "coverage.gap_recorded" => p!(CoverageGap, CoverageGap, payload, event_type),
            "entity.link_recorded" => p!(LinkRecorded, LinkRecorded, payload, event_type), "entity.link_revised" => p!(LinkRevised, LinkRevised, payload, event_type),
            "entity.link_conflict" => p!(LinkConflict, LinkConflict, payload, event_type), "review.decision_recorded" => p!(ReviewDecision, ReviewDecision, payload, event_type),
            other => Err(ParseError::Unsupported(other.to_string())),
        }
    }
}

pub const SOURCE_EVENT_TYPES: &[&str] = &[
    "order.accepted","order.revised","order.cancelled","inventory.snapshot","inventory.adjustment_observed","inventory.reserved","inventory.reservation_released","allocation.revised",
    "supply.commitment_recorded","supply.commitment_revised","customer.commitment_recorded","customer.commitment_revised","shipment.observed","shipment.dispatched","shipment.delivered","shipment.cancelled",
    "carrier.scan_observed","carrier.forecast_observed","communication.observed","communication.extraction_reviewed","invoice.issued","invoice.revised","invoice.credit_issued","invoice.cancelled","invoice.payment_marked",
    "invoice.dispatch_observed","payment.authorized","payment.captured","payment.failed","payment.voided","payment.allocation_recorded","payment.allocation_revised","business.rule_recorded","business.rule_revised",
    "business.case_recorded","business.case_revised","provider.ledger_posted","payment.fee_booked","provider.balance_observed","payout.announced","payout.sent","payout.failed","payout.reversed",
    "bank.credit_booked","bank.debit_booked","bank.match_recorded","bank.match_revised","provider.hold_recorded","provider.hold_released","provider.release_promised","return.approved","return.revised","return.cancelled",
    "return.received","return.restocked","return.disposition_observed","refund.entitlement_recorded","refund.entitlement_revised","refund.pending","refund.completed","refund.failed","refund.reversed",
    "dispute.opened","dispute.resolved","chargeback.debit_posted","chargeback.reversed","coverage.observed","coverage.gap_recorded","entity.link_recorded","entity.link_revised","entity.link_conflict","review.decision_recorded",
];

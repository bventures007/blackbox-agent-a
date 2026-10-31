//! Derived journal payloads produced by the deterministic rules in `derive.rs` and folded by `state.rs`.
//! Each variant is one appended Fact/Commitment/Movement/Reservation entry; `kind` is the serialized tag.
use crate::payloads::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct QtyLine { pub line_id: String, pub item_id: String, pub quantity: String, pub unit: String, pub line_gross_minor: i64 }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum PaymentKind { Authorized, Captured, Failed, Voided }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum CashKind { Capture, Fee, Refund, PayoutTransfer, PayoutReversal, ChargebackDebit, ChargebackReversal, ChargebackFee, LedgerAdjustment }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum StockCause { Dispatch, ReturnReceipt, Restock, Adjustment, DispositionDamaged, DispositionMissing }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "derived", rename_all = "snake_case")]
pub enum Derived {
    // ---- facts (observed record state) ----
    OrderObserved { order_id: String, customer_id: Option<String>, currency: String, lines: Vec<QtyLine>, gross_minor: i64, shipping_minor: Option<i64>, agreed_version: i64, change: String },
    OrderCancellation { order_id: String, lines: Option<Vec<CancelLine>>, full: bool },
    StockSnapshot { item_id: String, location_id: String, unit: String, basis: String, physical: Option<String>, available: Option<String>, committed: Option<String>, reserved: Option<String>,
        damaged: Option<String>, safety_stock: Option<String>, quality_control: Option<String>, incoming: Option<String> },
    InvoiceDocument { document_id: String, invoice_id: String, order_id: Option<String>, customer_id: Option<String>, currency: String, gross_minor: i64, due_date: Option<String>, line_links: Vec<InvoiceLineLink>, revision: i64, draft: bool },
    InvoiceRevision { document_id: String, invoice_id: String, revision: i64, gross_minor: i64, currency: String },
    CreditNote { document_id: String, invoice_id: String, credit_id: String, currency: String, credit_minor: i64, cash_refund_confirmed: bool },
    InvoiceCancellation { document_id: String, invoice_id: String },
    PaymentMarker { invoice_id: String, transaction_id: Option<String>, paid_minor: i64, currency: String },
    DispatchEvidence { dispatch_id: String, document_id: String, channel: String, status: String, processed_at: Option<String> },
    PaymentAttempt { transaction_id: String, parent_transaction_id: Option<String>, order_id: String, account_id: String, gateway: Option<String>, kind: PaymentKind, amount_minor: i64, currency: String, test: bool, error_code: Option<String>, economic_effect_id: Option<String> },
    PaymentAllocation { allocation_id: String, invoice_id: Option<String>, transaction_id: Option<String>, amount_minor: i64, currency: String, confidence: String, revision: i64 },
    ShipmentObservation { shipment_id: String, order_id: Option<String>, lines: Vec<ShipLine>, state: String, carrier: Option<String>, tracking_number: Option<String>, handover_at: Option<String>, delivered_at: Option<String>, carrier_status: Option<String> },
    CarrierScanFact { carrier_service: String, tracking_number: String, scan_identity: String, status_code: String, effective_time: String, shipment_id: Option<String> },
    CarrierForecastFact { carrier_service: String, tracking_number: String, forecast: Option<String>, shipment_id: Option<String> },
    ReturnRequest { return_id: String, order_id: Option<String>, lines: Vec<ReturnLine>, state: String, expected_credit_minor: Option<i64>, currency: Option<String> },
    ReturnReceipt { receipt_id: String, return_id: String, item_id: String, location_id: String, quantity: String, unit: String, disposition: String, stage: String },
    RefundObservation { refund_id: String, original_transaction_id: String, order_id: Option<String>, amount_minor: i64, currency: String, state: String, destination: String },
    DisputeObservation { dispute_id: String, original_transaction_id: Option<String>, order_id: Option<String>, amount_minor: Option<i64>, currency: Option<String>, state: String, outcome: Option<String>, debit_minor: Option<i64>, fee_minor: Option<i64>, reversal_minor: Option<i64>, posting_id: Option<String> },
    PayoutObservation { payout_id: String, account_id: String, amount_minor: Option<i64>, currency: Option<String>, state: String, trace_reference: Option<String>, expected_at: Option<String>, issued_at: Option<String>, ledger_membership: Option<Vec<String>>, reversal_id: Option<String> },
    BankEntryFact { entry_id: String, statement_id: Option<String>, account_id: String, direction: String, amount_minor: i64, currency: String, booking_status: String, booked_at: Option<String>, reference: Option<String>, payout_hint: Option<String> },
    BankMatchDecision { entry_id: String, payout_id: Option<String>, confidence: String, provider_account: Option<String> },
    HoldObservation { hold_id: String, account_id: Option<String>, transaction_id: Option<String>, currency: Option<String>, amount_minor: Option<i64>, reason: Option<String>, state: String, release_promised_at: Option<String>, released_at: Option<String> },
    LedgerPostingFact { ledger_entry_id: String, account_id: String, source_transaction_id: Option<String>, order_id: Option<String>, payout_id: Option<String>, posting_type: String, gross_minor: i64, fee_minor: i64, net_minor: i64, currency: String, effective_time: Option<String> },
    BalanceObservation { account_id: String, currency: String, observed_at: String, total_minor: Option<i64>, processing_minor: Option<i64>, available_minor: Option<i64>, held_minor: Option<i64>, coverage: String },
    FeeObservation { transaction_id: String, account_id: String, fee_minor: i64, currency: String, ledger_entry_id: Option<String> },
    RuleFact { rule_id: String, rule_kind: Option<String>, version: i64, effective_from: String, priority_method: Option<String>, invoicing_trigger: Option<String>, tolerance: Option<Value>, reminder_policy: Option<String>, changes: Option<Value>, timezone: Option<String> },
    CaseFact { case_id: String, customer_id: Option<String>, invoice_id: Option<String>, transaction_id: Option<String>, status: String, agreed_extension_until: Option<String> },
    CommunicationFact { message_id: String, customer_id: Option<String>, order_id: Option<String>, sent_at: String, actor: String, evidence_id: String, visibility_scope: String },
    ReviewedCommitmentsFact { message_id: String, reviewed: Vec<ReviewedCommitment>, reviewer: String },
    LinkFact { entity_type: String, entity_id: String, relationship_type: String, target_type: String, target_id: Option<String>, confidence: String, revision: i64 },
    LinkConflictFact { entity_type: String, entity_id: String, relationship_type: String, candidates: Vec<String>, reason: String },
    CoverageFact { capability: String, entity_scope: String, history_start: Option<String>, complete_through: Option<String>, backfill_complete: bool, coverage_basis: String, missing_fields: Vec<String> },
    CoverageGapFact { capability: String, from: String, to: Option<String>, reason: String },
    ReviewDecisionFact { case_id: String, decision: String, reason: String, asserted: Option<Value> },
    AllocationObservation { reservation_id: String, order_id: Option<String>, line_id: Option<String>, item_id: Option<String>, location_id: Option<String>, quantity: String, unit: String, state: String, reason: Option<String>, revision: Option<i64> },
    // ---- commitments (obligations and promises) ----
    OrderObligation { order_id: String, currency: String, lines: Vec<QtyLine>, gross_minor: i64, agreed_version: i64 },
    OrderObligationCancelled { order_id: String, lines: Option<Vec<CancelLine>>, full: bool },
    ReceivableAsserted { invoice_id: String, order_id: Option<String>, customer_id: Option<String>, currency: String, gross_minor: i64, due_date: Option<String>, revision: i64 },
    ReceivableAdjusted { invoice_id: String, delta_minor: i64, currency: String, cause: String, reference: String },
    RefundObligation { obligation_id: String, invoice_id: Option<String>, credit_id: Option<String>, original_transaction_id: Option<String>, amount_minor: i64, currency: String, basis: String, destination: String },
    RefundObligationRevised { obligation_id: String, amount_minor: i64, currency: String, state: String },
    PromiseAsserted { promise_id: String, kind: String, item_id: Option<String>, supplier_id: Option<String>, order_id: Option<String>, line_id: Option<String>, quantity: Option<String>, unit: Option<String>, promised_at: String, timezone: String, revision: i64, allocation_links: Vec<String>, promise_kind: Option<String> },
    PayoutAnnouncedCommitment { payout_id: String, account_id: String, amount_minor: i64, currency: String, expected_at: Option<String> },
    HoldReleasePromise { hold_id: String, release_promised_at: String },
    // ---- movements (physical stock and cash) ----
    StockMovement { item_id: String, location_id: String, unit: String, physical_delta: String, quarantine_delta: String, damaged_delta: String, cause: StockCause, reference: String, order_id: Option<String> },
    CashMovement { account_id: String, currency: String, amount_minor: i64, kind: CashKind, transaction_id: Option<String>, payout_id: Option<String>, reference: String, economic_effect_id: Option<String>, order_id: Option<String> },
    BankMovement { entry_id: String, account_id: String, amount_minor: i64, currency: String, direction: String, payout_id: Option<String>, booked_at: Option<String>, provider_account: Option<String> },
    // ---- reservations (stock reservations and cash holds) ----
    StockReservation { reservation_id: String, order_id: Option<String>, line_id: Option<String>, item_id: Option<String>, location_id: Option<String>, quantity: String, unit: String, state: String, reason: Option<String> },
    CashHold { hold_id: String, account_id: String, currency: String, amount_minor: i64, state: String, reason: String, source: String, transaction_id: Option<String> },
}

impl Derived {
    pub fn record_type(&self) -> crate::entry::RecordType {
        use crate::entry::RecordType as R; use Derived::*;
        match self {
            OrderObligation { .. } | OrderObligationCancelled { .. } | ReceivableAsserted { .. } | ReceivableAdjusted { .. } | RefundObligation { .. } | RefundObligationRevised { .. }
            | PromiseAsserted { .. } | PayoutAnnouncedCommitment { .. } | HoldReleasePromise { .. } => R::Commitment,
            StockMovement { .. } | CashMovement { .. } | BankMovement { .. } => R::Movement,
            StockReservation { .. } | CashHold { .. } => R::Reservation,
            _ => R::Fact,
        }
    }
    pub fn event_type(&self) -> String {
        let v = serde_json::to_value(self).expect("serializable");
        let kind = v.get("derived").and_then(|k| k.as_str()).unwrap_or("unknown");
        format!("{}.{}", self.record_type().as_str(), kind)
    }
    /// The entities whose projections must fold this entry, in a stable order.
    pub fn touched(&self) -> Vec<(EntityKind, String)> {
        use Derived::*; use EntityKind as K;
        let mut t: Vec<(K, String)> = Vec::new();
        let mut add = |k: K, id: &Option<String>| if let Some(i) = id { t.push((k, i.clone())) };
        let s = |x: &str| Some(x.to_string());
        match self {
            OrderObserved { order_id, customer_id, lines, .. } => { add(K::Order, &s(order_id)); add(K::Customer, customer_id); for l in lines { add(K::Item, &s(&l.item_id)); } }
            OrderObligation { order_id, lines, .. } => { add(K::Order, &s(order_id)); for l in lines { add(K::Item, &s(&l.item_id)); } }
            OrderCancellation { order_id, .. } | OrderObligationCancelled { order_id, .. } => add(K::Order, &s(order_id)),
            StockSnapshot { item_id, .. } => add(K::Item, &s(item_id)),
            InvoiceDocument { invoice_id, order_id, customer_id, .. } => { add(K::Invoice, &s(invoice_id)); add(K::Order, order_id); add(K::Customer, customer_id); }
            InvoiceRevision { invoice_id, .. } | InvoiceCancellation { invoice_id, .. } | CreditNote { invoice_id, .. } | PaymentMarker { invoice_id, .. } => add(K::Invoice, &s(invoice_id)),
            DispatchEvidence { document_id, .. } => add(K::Invoice, &s(document_id)),
            PaymentAttempt { transaction_id, order_id, account_id, currency, .. } => { add(K::Transaction, &s(transaction_id)); add(K::Order, &s(order_id)); add(K::Account, &s(&format!("{}/{}", account_id, currency))); }
            PaymentAllocation { invoice_id, transaction_id, .. } => { add(K::Invoice, invoice_id); add(K::Transaction, transaction_id); }
            ShipmentObservation { shipment_id, order_id, .. } => { add(K::Shipment, &s(shipment_id)); add(K::Order, order_id); }
            CarrierScanFact { shipment_id, tracking_number, .. } | CarrierForecastFact { shipment_id, tracking_number, .. } => { add(K::Shipment, shipment_id); add(K::Tracking, &s(tracking_number)); }
            ReturnRequest { return_id, order_id, .. } => { add(K::Return, &s(return_id)); add(K::Order, order_id); }
            ReturnReceipt { return_id, item_id, .. } => { add(K::Return, &s(return_id)); add(K::Item, &s(item_id)); }
            RefundObservation { refund_id, original_transaction_id, order_id, .. } => { add(K::Refund, &s(refund_id)); add(K::Transaction, &s(original_transaction_id)); add(K::Order, order_id); }
            DisputeObservation { dispute_id, original_transaction_id, order_id, .. } => { add(K::Dispute, &s(dispute_id)); add(K::Transaction, original_transaction_id); add(K::Order, order_id); }
            PayoutObservation { payout_id, account_id, currency, .. } => { add(K::Payout, &s(payout_id)); if let Some(c) = currency { add(K::Account, &s(&format!("{}/{}", account_id, c))); } }
            BankEntryFact { entry_id, payout_hint, .. } => { add(K::BankEntry, &s(entry_id)); add(K::Payout, payout_hint); }
            BankMatchDecision { entry_id, payout_id, provider_account, .. } => { add(K::BankEntry, &s(entry_id)); add(K::Payout, payout_id); add(K::Account, provider_account); }
            HoldObservation { hold_id, .. } => add(K::Hold, &s(hold_id)),
            LedgerPostingFact { ledger_entry_id, account_id, currency, payout_id, source_transaction_id, .. } => { add(K::LedgerEntry, &s(ledger_entry_id)); add(K::Account, &s(&format!("{}/{}", account_id, currency))); add(K::Payout, payout_id); add(K::Transaction, source_transaction_id); }
            BalanceObservation { account_id, currency, .. } => add(K::Account, &s(&format!("{}/{}", account_id, currency))),
            FeeObservation { transaction_id, account_id, currency, .. } => { add(K::Transaction, &s(transaction_id)); add(K::Account, &s(&format!("{}/{}", account_id, currency))); }
            RuleFact { rule_id, .. } => add(K::Rule, &s(rule_id)),
            CaseFact { case_id, invoice_id, .. } => { add(K::Case, &s(case_id)); add(K::Invoice, invoice_id); }
            CommunicationFact { message_id, order_id, customer_id, .. } => { add(K::Message, &s(message_id)); add(K::Order, order_id); add(K::Customer, customer_id); }
            ReviewedCommitmentsFact { message_id, .. } => add(K::Message, &s(message_id)),
            LinkFact { entity_type, entity_id, .. } | LinkConflictFact { entity_type, entity_id, .. } => { if let Some(k) = EntityKind::parse(entity_type) { add(k, &s(entity_id)); } }
            CoverageFact { capability, .. } | CoverageGapFact { capability, .. } => add(K::Coverage, &s(capability)),
            ReviewDecisionFact { case_id, .. } => add(K::ReviewCase, &s(case_id)),
            AllocationObservation { reservation_id, order_id, item_id, .. } | StockReservation { reservation_id, order_id, item_id, .. } => { add(K::Reservation, &s(reservation_id)); add(K::Order, order_id); add(K::Item, item_id); }
            ReceivableAsserted { invoice_id, order_id, customer_id, .. } => { add(K::Invoice, &s(invoice_id)); add(K::Order, order_id); add(K::Customer, customer_id); }
            ReceivableAdjusted { invoice_id, .. } => add(K::Invoice, &s(invoice_id)),
            RefundObligation { obligation_id, invoice_id, original_transaction_id, .. } => { add(K::RefundObligation, &s(obligation_id)); add(K::Invoice, invoice_id); add(K::Transaction, original_transaction_id); }
            RefundObligationRevised { obligation_id, .. } => add(K::RefundObligation, &s(obligation_id)),
            PromiseAsserted { promise_id, item_id, order_id, .. } => { add(K::Promise, &s(promise_id)); add(K::Item, item_id); add(K::Order, order_id); }
            PayoutAnnouncedCommitment { payout_id, account_id, currency, .. } => { add(K::Payout, &s(payout_id)); add(K::Account, &s(&format!("{}/{}", account_id, currency))); }
            HoldReleasePromise { hold_id, .. } => add(K::Hold, &s(hold_id)),
            StockMovement { item_id, order_id, .. } => { add(K::Item, &s(item_id)); add(K::Order, order_id); }
            CashMovement { account_id, currency, transaction_id, payout_id, order_id, .. } => { add(K::Account, &s(&format!("{}/{}", account_id, currency))); add(K::Transaction, transaction_id); add(K::Payout, payout_id); add(K::Order, order_id); }
            BankMovement { entry_id, payout_id, account_id, currency, provider_account, .. } => { add(K::BankEntry, &s(entry_id)); add(K::Payout, payout_id); add(K::Account, &s(&format!("{}/{}", account_id, currency))); add(K::Account, provider_account); }
            CashHold { hold_id, account_id, currency, transaction_id, .. } => { add(K::Hold, &s(hold_id)); add(K::Account, &s(&format!("{}/{}", account_id, currency))); add(K::Transaction, transaction_id); }
        }
        t.dedup();
        t
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum EntityKind { Order, Customer, Item, Invoice, Transaction, Account, Shipment, Tracking, Return, Refund, Dispute, Payout, BankEntry, Hold, LedgerEntry, Rule, Case, Message, Coverage, ReviewCase, Reservation, RefundObligation, Promise }

impl EntityKind {
    pub fn as_str(&self) -> &'static str {
        match self { EntityKind::Order => "order", EntityKind::Customer => "customer", EntityKind::Item => "item", EntityKind::Invoice => "invoice", EntityKind::Transaction => "transaction", EntityKind::Account => "account",
            EntityKind::Shipment => "shipment", EntityKind::Tracking => "tracking", EntityKind::Return => "return", EntityKind::Refund => "refund", EntityKind::Dispute => "dispute", EntityKind::Payout => "payout",
            EntityKind::BankEntry => "bank_entry", EntityKind::Hold => "hold", EntityKind::LedgerEntry => "ledger_entry", EntityKind::Rule => "rule", EntityKind::Case => "case", EntityKind::Message => "message",
            EntityKind::Coverage => "coverage", EntityKind::ReviewCase => "review_case", EntityKind::Reservation => "reservation", EntityKind::RefundObligation => "refund_obligation", EntityKind::Promise => "promise" }
    }
    pub fn parse(s: &str) -> Option<EntityKind> {
        Some(match s { "order" => EntityKind::Order, "customer" => EntityKind::Customer, "item" => EntityKind::Item, "invoice" => EntityKind::Invoice, "transaction" => EntityKind::Transaction, "account" => EntityKind::Account,
            "shipment" => EntityKind::Shipment, "tracking" => EntityKind::Tracking, "return" => EntityKind::Return, "refund" => EntityKind::Refund, "dispute" => EntityKind::Dispute, "payout" => EntityKind::Payout,
            "bank_entry" => EntityKind::BankEntry, "hold" => EntityKind::Hold, "ledger_entry" => EntityKind::LedgerEntry, "rule" => EntityKind::Rule, "case" => EntityKind::Case, "message" => EntityKind::Message,
            "coverage" => EntityKind::Coverage, "review_case" => EntityKind::ReviewCase, "reservation" => EntityKind::Reservation, "refund_obligation" => EntityKind::RefundObligation, "promise" => EntityKind::Promise, _ => return None })
    }
}

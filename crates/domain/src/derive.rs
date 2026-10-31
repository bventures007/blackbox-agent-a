//! Deterministic derivation rules (rule_version r1): one source observation -> Fact/Commitment/Movement/Reservation entries.
//! Stateless on purpose: every derived entry can be reproduced from its single input entry.
use crate::derived::*;
use crate::entry::{EntityRef, EntryInput, JournalEntry, RecordType};
use crate::money::Qty;
use crate::payloads::{ParseError, Source};
use crate::{RULE_VERSION, SCHEMA_VERSION};

fn acct(a: &Option<String>) -> String { a.clone().unwrap_or_else(|| "default".to_string()) }

/// Context an engine supplies so that release/reversal observations that only name an id can be linked to their
/// owning item/order/account at derivation time. Resolution reflects state at the input's journal position.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ReservationRef { pub item_id: Option<String>, pub order_id: Option<String>, pub line_id: Option<String>, pub location_id: Option<String> }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct HoldRef { pub account_id: Option<String>, pub currency: Option<String>, pub transaction_id: Option<String> }
#[derive(Clone, Debug, Default, PartialEq)]
pub struct PayoutRef { pub account_id: Option<String>, pub currency: Option<String>, pub amount_minor: Option<i64> }
pub trait Resolver {
    fn reservation(&self, _id: &str) -> Option<ReservationRef> { None }
    fn hold(&self, _id: &str) -> Option<HoldRef> { None }
    fn payout(&self, _id: &str) -> Option<PayoutRef> { None }
    fn dispute_transaction(&self, _id: &str) -> Option<String> { None }
    /// provider account that collected a transaction (refund holds and refund cash movements land on it)
    fn transaction_account(&self, _id: &str) -> Option<String> { None }
}
pub struct NoResolver;
impl Resolver for NoResolver {}
fn zero() -> String { "0".to_string() }
fn neg(q: &str) -> String { Qty::parse(q).map(|v| Qty(-v.0).to_string()).unwrap_or_else(|_| format!("-{}", q)) }

pub fn derive(entry: &JournalEntry, rs: &dyn Resolver) -> Result<Vec<Derived>, ParseError> {
    if entry.record_type != RecordType::Source { return Ok(vec![]); }
    let src = Source::parse(&entry.event_type, &entry.payload)?;
    use Derived as D;
    let out: Vec<Derived> = match src {
        Source::OrderAccepted(o) => {
            let lines: Vec<QtyLine> = o.lines.iter().map(|l| QtyLine { line_id: l.line_id.clone(), item_id: l.item_id.clone(), quantity: l.quantity.clone(), unit: l.unit.clone(), line_gross_minor: l.line_gross_minor }).collect();
            vec![D::OrderObserved { order_id: o.order_id.clone(), customer_id: o.customer_id.clone(), currency: o.currency.clone(), lines: lines.clone(), gross_minor: o.gross_minor, shipping_minor: o.shipping_minor, agreed_version: o.agreed_version, change: "accepted".into() },
                 D::OrderObligation { order_id: o.order_id, currency: o.currency, lines, gross_minor: o.gross_minor, agreed_version: o.agreed_version }]
        }
        Source::OrderRevised(o) => {
            let lines: Vec<QtyLine> = o.lines.iter().map(|l| QtyLine { line_id: l.line_id.clone(), item_id: l.item_id.clone(), quantity: l.quantity.clone(), unit: l.unit.clone(), line_gross_minor: l.line_gross_minor }).collect();
            vec![D::OrderObserved { order_id: o.order_id.clone(), customer_id: None, currency: o.currency.clone(), lines: lines.clone(), gross_minor: o.gross_minor, shipping_minor: None, agreed_version: o.agreed_version, change: "revised".into() },
                 D::OrderObligation { order_id: o.order_id, currency: o.currency, lines, gross_minor: o.gross_minor, agreed_version: o.agreed_version }]
        }
        Source::OrderCancelled(o) => vec![D::OrderCancellation { order_id: o.order_id.clone(), lines: o.lines.clone(), full: o.full }, D::OrderObligationCancelled { order_id: o.order_id, lines: o.lines, full: o.full }],
        Source::InventorySnapshot(s) => vec![D::StockSnapshot { item_id: s.item_id, location_id: s.location_id, unit: s.unit, basis: s.basis, physical: s.physical, available: s.available, committed: s.committed, reserved: s.reserved, damaged: s.damaged, safety_stock: s.safety_stock, quality_control: s.quality_control, incoming: s.incoming }],
        Source::InventoryAdjustment(a) => vec![D::StockMovement { item_id: a.item_id, location_id: a.location_id, unit: a.unit, physical_delta: a.physical_delta, quarantine_delta: zero(), damaged_delta: zero(), cause: StockCause::Adjustment, reference: entry.record_id.clone(), order_id: None }],
        Source::InventoryReserved(r) => vec![
            D::AllocationObservation { reservation_id: r.reservation_id.clone(), order_id: Some(r.order_id.clone()), line_id: r.line_id.clone(), item_id: Some(r.item_id.clone()), location_id: Some(r.location_id.clone()), quantity: r.quantity.clone(), unit: r.unit.clone(), state: "reserved".into(), reason: None, revision: None },
            D::StockReservation { reservation_id: r.reservation_id, order_id: Some(r.order_id), line_id: r.line_id, item_id: Some(r.item_id), location_id: Some(r.location_id), quantity: r.quantity, unit: r.unit, state: "reserved".into(), reason: None }],
        Source::ReservationReleased(r) => { let x = rs.reservation(&r.reservation_id).unwrap_or_default(); vec![
            D::AllocationObservation { reservation_id: r.reservation_id.clone(), order_id: x.order_id.clone(), line_id: x.line_id.clone(), item_id: x.item_id.clone(), location_id: x.location_id.clone(), quantity: r.quantity.clone(), unit: r.unit.clone(), state: "released".into(), reason: Some(r.reason.clone()), revision: None },
            D::StockReservation { reservation_id: r.reservation_id, order_id: x.order_id, line_id: x.line_id, item_id: x.item_id, location_id: x.location_id, quantity: r.quantity, unit: r.unit, state: "released".into(), reason: Some(r.reason) }] }
        Source::AllocationRevised(r) => { let x = rs.reservation(&r.reservation_id).unwrap_or_default(); vec![
            D::AllocationObservation { reservation_id: r.reservation_id.clone(), order_id: x.order_id.clone(), line_id: x.line_id.clone(), item_id: x.item_id.clone(), location_id: x.location_id.clone(), quantity: r.quantity.clone(), unit: r.unit.clone(), state: "revised".into(), reason: None, revision: Some(r.revision) },
            D::StockReservation { reservation_id: r.reservation_id, order_id: x.order_id, line_id: x.line_id, item_id: x.item_id, location_id: x.location_id, quantity: r.quantity, unit: r.unit, state: "revised".into(), reason: None }] }
        Source::SupplyCommitment(p) => vec![D::PromiseAsserted { promise_id: p.promise_id, kind: "supply".into(), item_id: Some(p.item_id), supplier_id: Some(p.supplier_id), order_id: None, line_id: None, quantity: Some(p.quantity), unit: Some(p.unit), promised_at: p.promised_at, timezone: p.timezone, revision: p.revision, allocation_links: p.allocation_links, promise_kind: Some("receipt".into()) }],
        Source::SupplyRevised(p) => vec![D::PromiseAsserted { promise_id: p.promise_id, kind: "supply".into(), item_id: None, supplier_id: None, order_id: None, line_id: None, quantity: p.quantity, unit: p.unit, promised_at: p.promised_at, timezone: p.timezone, revision: p.revision, allocation_links: vec![], promise_kind: Some("receipt".into()) }],
        Source::CustomerCommitment(p) => vec![D::PromiseAsserted { promise_id: p.promise_id, kind: "customer".into(), item_id: None, supplier_id: None, order_id: Some(p.order_id), line_id: p.line_id, quantity: None, unit: None, promised_at: p.promised_at, timezone: p.timezone, revision: p.revision, allocation_links: vec![], promise_kind: Some(p.promise_kind) }],
        Source::CustomerRevised(p) => vec![D::PromiseAsserted { promise_id: p.promise_id, kind: "customer".into(), item_id: None, supplier_id: None, order_id: None, line_id: None, quantity: None, unit: None, promised_at: p.promised_at, timezone: p.timezone, revision: p.revision, allocation_links: vec![], promise_kind: None }],
        Source::ShipmentObserved(s) => vec![D::ShipmentObservation { shipment_id: s.shipment_id, order_id: Some(s.order_id), lines: s.lines, state: s.state, carrier: s.carrier, tracking_number: s.tracking_number, handover_at: None, delivered_at: None, carrier_status: None }],
        Source::ShipmentDispatched(s) => {
            let mut v = vec![D::ShipmentObservation { shipment_id: s.shipment_id.clone(), order_id: Some(s.order_id.clone()), lines: s.lines.iter().map(|l| crate::payloads::ShipLine { line_id: l.line_id.clone(), item_id: Some(l.item_id.clone()), quantity: l.quantity.clone(), unit: l.unit.clone() }).collect(), state: "in_transit".into(), carrier: s.carrier.clone(), tracking_number: s.tracking_number.clone(), handover_at: s.handover_at.clone().or_else(|| Some(entry.occurred_at.to_rfc3339())), delivered_at: None, carrier_status: None }];
            for l in &s.lines {
                v.push(D::StockMovement { item_id: l.item_id.clone(), location_id: s.location_id.clone(), unit: l.unit.clone(), physical_delta: neg(&l.quantity), quarantine_delta: zero(), damaged_delta: zero(), cause: StockCause::Dispatch, reference: s.shipment_id.clone(), order_id: Some(s.order_id.clone()) });
                if let Some(res) = &s.reservation_id { v.push(D::StockReservation { reservation_id: res.clone(), order_id: Some(s.order_id.clone()), line_id: Some(l.line_id.clone()), item_id: Some(l.item_id.clone()), location_id: Some(s.location_id.clone()), quantity: l.quantity.clone(), unit: l.unit.clone(), state: "released".into(), reason: Some("shipped".into()) }); }
            }
            v
        }
        Source::ShipmentDelivered(s) => vec![D::ShipmentObservation { shipment_id: s.shipment_id, order_id: s.order_id, lines: vec![], state: "delivered".into(), carrier: None, tracking_number: None, handover_at: None, delivered_at: s.delivered_at.or_else(|| Some(entry.occurred_at.to_rfc3339())), carrier_status: s.carrier_status }],
        Source::ShipmentCancelled(s) => vec![D::ShipmentObservation { shipment_id: s.shipment_id, order_id: s.order_id, lines: vec![], state: "cancelled".into(), carrier: None, tracking_number: None, handover_at: None, delivered_at: None, carrier_status: None }],
        Source::CarrierScan(c) => vec![D::CarrierScanFact { carrier_service: c.carrier_service, tracking_number: c.tracking_number, scan_identity: c.scan_identity, status_code: c.status_code, effective_time: c.effective_time, shipment_id: c.shipment_id }],
        Source::CarrierForecast(c) => vec![D::CarrierForecastFact { carrier_service: c.carrier_service, tracking_number: c.tracking_number, forecast: c.forecast, shipment_id: c.shipment_id }],
        Source::CommunicationObserved(c) => vec![D::CommunicationFact { message_id: c.message_id, customer_id: c.customer_id, order_id: c.order_id, sent_at: c.sent_at, actor: c.actor, evidence_id: c.evidence_id, visibility_scope: c.visibility_scope }],
        Source::ExtractionReviewed(c) => {
            let mut v = vec![D::ReviewedCommitmentsFact { message_id: c.message_id.clone(), reviewed: c.reviewed_commitments.clone(), reviewer: c.reviewer }];
            for rc in c.reviewed_commitments { v.push(D::PromiseAsserted { promise_id: rc.promise_id, kind: "customer".into(), item_id: None, supplier_id: None, order_id: None, line_id: None, quantity: None, unit: None, promised_at: rc.promised_at, timezone: "UTC".into(), revision: 1, allocation_links: vec![], promise_kind: Some(rc.kind) }); }
            v
        }
        Source::InvoiceIssued(i) => {
            let draft = i.draft_state == "draft";
            let mut v = vec![D::InvoiceDocument { document_id: i.document_id.clone(), invoice_id: i.invoice_id.clone(), order_id: i.order_id.clone(), customer_id: i.customer_id.clone(), currency: i.currency.clone(), gross_minor: i.gross_minor, due_date: i.due_date.clone(), line_links: i.line_links.clone(), revision: i.revision, draft }];
            if !draft { v.push(D::ReceivableAsserted { invoice_id: i.invoice_id, order_id: i.order_id, customer_id: i.customer_id, currency: i.currency, gross_minor: i.gross_minor, due_date: i.due_date, revision: i.revision }); }
            v
        }
        Source::InvoiceRevised(i) => vec![D::InvoiceRevision { document_id: i.document_id, invoice_id: i.invoice_id.clone(), revision: i.revision, gross_minor: i.gross_minor, currency: i.currency.clone() },
            D::ReceivableAsserted { invoice_id: i.invoice_id, order_id: None, customer_id: None, currency: i.currency, gross_minor: i.gross_minor, due_date: None, revision: i.revision }],
        Source::CreditIssued(c) => vec![D::CreditNote { document_id: c.document_id.clone(), invoice_id: c.invoice_id.clone(), credit_id: c.credit_id.clone(), currency: c.currency.clone(), credit_minor: c.credit_minor, cash_refund_confirmed: c.cash_refund_confirmed },
            D::ReceivableAdjusted { invoice_id: c.invoice_id, delta_minor: -c.credit_minor, currency: c.currency, cause: "credit".into(), reference: c.credit_id }],
        Source::InvoiceCancelled(c) => vec![D::InvoiceCancellation { document_id: c.document_id.clone(), invoice_id: c.invoice_id.clone() },
            D::ReceivableAdjusted { invoice_id: c.invoice_id, delta_minor: 0, currency: String::new(), cause: "cancelled".into(), reference: c.document_id }],
        Source::PaymentMarked(m) => vec![D::PaymentMarker { invoice_id: m.invoice_id, transaction_id: m.transaction_id, paid_minor: m.paid_minor, currency: m.currency }],
        Source::DispatchObserved(d) => vec![D::DispatchEvidence { dispatch_id: d.dispatch_id, document_id: d.document_id, channel: d.channel, status: d.status, processed_at: d.processed_at }],
        Source::PaymentAuthorized(p) => vec![D::PaymentAttempt { transaction_id: p.transaction_id, parent_transaction_id: None, order_id: p.order_id, account_id: acct(&p.account_id), gateway: p.gateway, kind: PaymentKind::Authorized, amount_minor: p.amount_minor, currency: p.currency, test: p.test, error_code: None, economic_effect_id: None }],
        Source::PaymentCaptured(p) => {
            let eff = p.economic_effect_id.clone().unwrap_or_else(|| format!("capture:{}", p.transaction_id));
            vec![D::PaymentAttempt { transaction_id: p.transaction_id.clone(), parent_transaction_id: p.parent_transaction_id.clone(), order_id: p.order_id.clone(), account_id: acct(&p.account_id), gateway: p.gateway.clone(), kind: PaymentKind::Captured, amount_minor: p.amount_minor, currency: p.currency.clone(), test: p.test, error_code: None, economic_effect_id: Some(eff.clone()) },
                 D::CashMovement { account_id: acct(&p.account_id), currency: p.currency, amount_minor: p.amount_minor, kind: CashKind::Capture, transaction_id: Some(p.transaction_id.clone()), payout_id: None, reference: p.transaction_id, economic_effect_id: Some(eff), order_id: Some(p.order_id) }]
        }
        Source::PaymentFailed(p) => vec![D::PaymentAttempt { transaction_id: p.transaction_id, parent_transaction_id: None, order_id: p.order_id, account_id: "default".into(), gateway: None, kind: PaymentKind::Failed, amount_minor: p.amount_minor, currency: p.currency, test: false, error_code: p.error_code, economic_effect_id: None }],
        Source::PaymentVoided(p) => vec![D::PaymentAttempt { transaction_id: p.transaction_id, parent_transaction_id: Some(p.parent_transaction_id), order_id: p.order_id, account_id: "default".into(), gateway: None, kind: PaymentKind::Voided, amount_minor: p.amount_minor, currency: p.currency, test: false, error_code: None, economic_effect_id: None }],
        Source::AllocationRecorded(a) => vec![D::PaymentAllocation { allocation_id: a.allocation_id, invoice_id: Some(a.invoice_id), transaction_id: Some(a.transaction_id), amount_minor: a.amount_minor, currency: a.currency, confidence: a.confidence, revision: a.revision }],
        Source::AllocationRevisedPay(a) => vec![D::PaymentAllocation { allocation_id: a.allocation_id, invoice_id: None, transaction_id: None, amount_minor: a.amount_minor, currency: a.currency, confidence: a.confidence, revision: a.revision }],
        Source::RuleRecorded(r) => vec![D::RuleFact { rule_id: r.rule_id, rule_kind: Some(r.rule_kind), version: r.version, effective_from: r.effective_from, priority_method: r.priority_method, invoicing_trigger: r.invoicing_trigger, tolerance: r.tolerance, reminder_policy: r.reminder_policy, changes: None, timezone: r.timezone }],
        Source::RuleRevised(r) => vec![D::RuleFact { rule_id: r.rule_id, rule_kind: None, version: r.version, effective_from: r.effective_from, priority_method: None, invoicing_trigger: None, tolerance: None, reminder_policy: None, changes: Some(r.changes), timezone: None }],
        Source::CaseRecorded(c) => vec![D::CaseFact { case_id: c.case_id, customer_id: c.customer_id, invoice_id: c.invoice_id, transaction_id: c.transaction_id, status: c.status, agreed_extension_until: c.agreed_extension_until }],
        Source::CaseRevised(c) => vec![D::CaseFact { case_id: c.case_id, customer_id: None, invoice_id: None, transaction_id: None, status: c.status, agreed_extension_until: c.agreed_extension_until }],
        Source::LedgerPosted(l) => {
            let mut v = vec![D::LedgerPostingFact { ledger_entry_id: l.ledger_entry_id.clone(), account_id: l.account_id.clone(), source_transaction_id: l.source_transaction_id.clone(), order_id: l.order_id.clone(), payout_id: l.payout_id.clone(), posting_type: l.posting_type.clone(), gross_minor: l.gross_minor, fee_minor: l.fee_minor, net_minor: l.net_minor, currency: l.currency.clone(), effective_time: l.effective_time.clone() }];
            // a charge posting carries the provider fee: the same economic effect as payment.fee_booked for that transaction (deduplicated by effect id in the account reducer)
            if l.posting_type == "charge" && l.fee_minor > 0 {
                let effect = match &l.source_transaction_id { Some(t) => format!("fee:{t}"), None => format!("fee:ledger:{}", l.ledger_entry_id) };
                v.push(D::CashMovement { account_id: l.account_id.clone(), currency: l.currency.clone(), amount_minor: -l.fee_minor, kind: CashKind::Fee, transaction_id: l.source_transaction_id.clone(), payout_id: l.payout_id.clone(), reference: l.ledger_entry_id.clone(), economic_effect_id: Some(effect), order_id: l.order_id.clone() });
            }
            if matches!(l.posting_type.as_str(), "adjustment" | "reserve" | "transfer") {
                v.push(D::CashMovement { account_id: l.account_id, currency: l.currency, amount_minor: l.net_minor, kind: CashKind::LedgerAdjustment, transaction_id: l.source_transaction_id, payout_id: l.payout_id, reference: l.ledger_entry_id.clone(), economic_effect_id: Some(format!("ledger:{}", l.ledger_entry_id)), order_id: l.order_id });
            }
            v
        }
        Source::FeeBooked(f) => vec![D::FeeObservation { transaction_id: f.transaction_id.clone(), account_id: acct(&f.account_id), fee_minor: f.fee_minor, currency: f.currency.clone(), ledger_entry_id: f.ledger_entry_id.clone() },
            D::CashMovement { account_id: acct(&f.account_id), currency: f.currency, amount_minor: -f.fee_minor, kind: CashKind::Fee, transaction_id: Some(f.transaction_id.clone()), payout_id: None, reference: f.ledger_entry_id.unwrap_or_else(|| format!("fee:{}", f.transaction_id)), economic_effect_id: Some(format!("fee:{}", f.transaction_id)), order_id: None }],
        Source::BalanceObserved(b) => vec![D::BalanceObservation { account_id: b.account_id, currency: b.currency, observed_at: b.observed_at, total_minor: b.total_minor, processing_minor: b.processing_minor, available_minor: b.available_minor, held_minor: b.held_minor, coverage: b.coverage }],
        Source::PayoutAnnounced(p) => vec![D::PayoutObservation { payout_id: p.payout_id.clone(), account_id: acct(&p.account_id), amount_minor: Some(p.amount_minor), currency: Some(p.currency.clone()), state: "announced".into(), trace_reference: p.trace_reference, expected_at: p.expected_at.clone(), issued_at: None, ledger_membership: None, reversal_id: None },
            D::PayoutAnnouncedCommitment { payout_id: p.payout_id, account_id: acct(&p.account_id), amount_minor: p.amount_minor, currency: p.currency, expected_at: p.expected_at }],
        Source::PayoutSent(p) => vec![D::PayoutObservation { payout_id: p.payout_id.clone(), account_id: acct(&p.account_id), amount_minor: Some(p.amount_minor), currency: Some(p.currency.clone()), state: "sent".into(), trace_reference: p.trace_reference, expected_at: None, issued_at: p.issued_at.clone().or_else(|| Some(entry.occurred_at.to_rfc3339())), ledger_membership: p.ledger_membership, reversal_id: None },
            D::CashMovement { account_id: acct(&p.account_id), currency: p.currency, amount_minor: -p.amount_minor, kind: CashKind::PayoutTransfer, transaction_id: None, payout_id: Some(p.payout_id.clone()), reference: p.payout_id.clone(), economic_effect_id: Some(format!("payout:{}", p.payout_id)), order_id: None }],
        Source::PayoutFailed(p) => { let x = rs.payout(&p.payout_id).unwrap_or_default(); vec![D::PayoutObservation { payout_id: p.payout_id, account_id: x.account_id.unwrap_or_else(|| "default".into()), amount_minor: x.amount_minor, currency: x.currency, state: "failed".into(), trace_reference: None, expected_at: None, issued_at: None, ledger_membership: None, reversal_id: None }] }
        Source::PayoutReversed(p) => { let x = rs.payout(&p.payout_id).unwrap_or_default(); let a = x.account_id.unwrap_or_else(|| "default".into()); vec![D::PayoutObservation { payout_id: p.payout_id.clone(), account_id: a.clone(), amount_minor: Some(p.amount_minor), currency: Some(p.currency.clone()), state: "reversed".into(), trace_reference: None, expected_at: None, issued_at: None, ledger_membership: None, reversal_id: Some(p.reversal_id.clone()) },
            D::CashMovement { account_id: a, currency: p.currency, amount_minor: p.amount_minor, kind: CashKind::PayoutReversal, transaction_id: None, payout_id: Some(p.payout_id), reference: p.reversal_id.clone(), economic_effect_id: Some(format!("payout_reversal:{}", p.reversal_id)), order_id: None }] }
        Source::BankCredit(b) => {
            let mut v = vec![D::BankEntryFact { entry_id: b.entry_id.clone(), statement_id: b.statement_id, account_id: b.account_id.clone(), direction: "credit".into(), amount_minor: b.amount_minor, currency: b.currency.clone(), booking_status: b.booking_status.clone(), booked_at: b.booked_at.clone(), reference: b.reference, payout_hint: b.payout_id.clone() }];
            let provider_account = b.payout_id.as_deref().and_then(|p| rs.payout(p)).and_then(|x| Some(format!("{}/{}", x.account_id?, x.currency?)));
            if b.booking_status == "booked" { v.push(D::BankMovement { entry_id: b.entry_id, account_id: b.account_id, amount_minor: b.amount_minor, currency: b.currency, direction: "credit".into(), payout_id: b.payout_id, booked_at: b.booked_at, provider_account }); }
            v
        }
        Source::BankDebit(b) => {
            let mut v = vec![D::BankEntryFact { entry_id: b.entry_id.clone(), statement_id: b.statement_id, account_id: b.account_id.clone(), direction: "debit".into(), amount_minor: b.amount_minor, currency: b.currency.clone(), booking_status: b.booking_status.clone(), booked_at: b.booked_at.clone(), reference: b.reference, payout_hint: None }];
            if b.booking_status == "booked" { v.push(D::BankMovement { entry_id: b.entry_id, account_id: b.account_id, amount_minor: -b.amount_minor, currency: b.currency, direction: "debit".into(), payout_id: None, booked_at: b.booked_at, provider_account: None }); }
            v
        }
        Source::BankMatch(m) => { let pa = rs.payout(&m.payout_id).and_then(|x| Some(format!("{}/{}", x.account_id?, x.currency?))); vec![D::BankMatchDecision { entry_id: m.entry_id, payout_id: Some(m.payout_id), confidence: m.confidence, provider_account: pa }] }
        Source::BankMatchRevised(m) => { let pa = m.payout_id.as_deref().and_then(|p| rs.payout(p)).and_then(|x| Some(format!("{}/{}", x.account_id?, x.currency?))); vec![D::BankMatchDecision { entry_id: m.entry_id, payout_id: m.payout_id, confidence: m.confidence, provider_account: pa }] }
        Source::HoldRecorded(h) => vec![D::HoldObservation { hold_id: h.hold_id.clone(), account_id: Some(h.account_id.clone()), transaction_id: h.transaction_id.clone(), currency: Some(h.currency.clone()), amount_minor: Some(h.amount_minor), reason: Some(h.reason.clone()), state: "active".into(), release_promised_at: None, released_at: None },
            D::CashHold { hold_id: h.hold_id, account_id: h.account_id, currency: h.currency, amount_minor: h.amount_minor, state: "placed".into(), reason: h.reason, source: "provider_hold".into(), transaction_id: h.transaction_id }],
        Source::HoldReleased(h) => { let x = rs.hold(&h.hold_id).unwrap_or_default(); vec![D::HoldObservation { hold_id: h.hold_id.clone(), account_id: x.account_id.clone(), transaction_id: x.transaction_id.clone(), currency: Some(h.currency.clone()), amount_minor: Some(h.amount_minor), reason: None, state: "released".into(), release_promised_at: None, released_at: h.released_at.clone().or_else(|| Some(entry.occurred_at.to_rfc3339())) },
            D::CashHold { hold_id: h.hold_id, account_id: x.account_id.unwrap_or_else(|| "default".into()), currency: h.currency, amount_minor: h.amount_minor, state: "released".into(), reason: String::new(), source: "provider_hold".into(), transaction_id: x.transaction_id }] }
        Source::ReleasePromised(h) => vec![D::HoldObservation { hold_id: h.hold_id.clone(), account_id: None, transaction_id: None, currency: None, amount_minor: None, reason: None, state: "release_promised".into(), release_promised_at: Some(h.release_promised_at.clone()), released_at: None },
            D::HoldReleasePromise { hold_id: h.hold_id, release_promised_at: h.release_promised_at }],
        Source::ReturnApproved(r) => vec![D::ReturnRequest { return_id: r.return_id, order_id: Some(r.order_id), lines: r.lines, state: "approved".into(), expected_credit_minor: r.expected_credit_minor, currency: r.currency }],
        Source::ReturnRevised(r) => vec![D::ReturnRequest { return_id: r.return_id, order_id: None, lines: r.lines, state: "revised".into(), expected_credit_minor: None, currency: None }],
        Source::ReturnCancelled(r) => vec![D::ReturnRequest { return_id: r.return_id, order_id: None, lines: vec![], state: "cancelled".into(), expected_credit_minor: None, currency: None }],
        Source::ReturnReceived(r) => {
            let (phys, quar, dmg) = match r.disposition.as_str() { "quarantine" => (r.quantity.clone(), r.quantity.clone(), zero()), "restocked" => (r.quantity.clone(), zero(), zero()), "damaged" => (r.quantity.clone(), zero(), r.quantity.clone()), _ => (zero(), zero(), zero()) };
            vec![D::ReturnReceipt { receipt_id: r.receipt_id.clone(), return_id: r.return_id.clone(), item_id: r.item_id.clone(), location_id: r.location_id.clone(), quantity: r.quantity.clone(), unit: r.unit.clone(), disposition: r.disposition.clone(), stage: "received".into() },
                 D::StockMovement { item_id: r.item_id, location_id: r.location_id, unit: r.unit, physical_delta: phys, quarantine_delta: quar, damaged_delta: dmg, cause: StockCause::ReturnReceipt, reference: r.receipt_id, order_id: None }]
        }
        Source::ReturnRestocked(r) => vec![D::ReturnReceipt { receipt_id: r.receipt_id.clone(), return_id: r.return_id.clone(), item_id: r.item_id.clone(), location_id: r.location_id.clone(), quantity: r.quantity.clone(), unit: r.unit.clone(), disposition: "restocked".into(), stage: "restocked".into() },
            D::StockMovement { item_id: r.item_id, location_id: r.location_id, unit: r.unit, physical_delta: zero(), quarantine_delta: neg(&r.quantity), damaged_delta: zero(), cause: StockCause::Restock, reference: r.receipt_id, order_id: None }],
        Source::DispositionObserved(r) => {
            let mut v = vec![D::ReturnReceipt { receipt_id: r.receipt_id.clone(), return_id: r.return_id.clone(), item_id: r.item_id.clone(), location_id: "default".into(), quantity: r.quantity.clone(), unit: r.unit.clone(), disposition: r.disposition.clone(), stage: "disposition".into() }];
            match r.disposition.as_str() {
                "restocked" => v.push(D::StockMovement { item_id: r.item_id, location_id: "default".into(), unit: r.unit, physical_delta: zero(), quarantine_delta: neg(&r.quantity), damaged_delta: zero(), cause: StockCause::Restock, reference: r.receipt_id, order_id: None }),
                "damaged" => v.push(D::StockMovement { item_id: r.item_id, location_id: "default".into(), unit: r.unit, physical_delta: zero(), quarantine_delta: neg(&r.quantity), damaged_delta: r.quantity.clone(), cause: StockCause::DispositionDamaged, reference: r.receipt_id, order_id: None }),
                "missing" => v.push(D::StockMovement { item_id: r.item_id, location_id: "default".into(), unit: r.unit, physical_delta: neg(&r.quantity), quarantine_delta: neg(&r.quantity), damaged_delta: zero(), cause: StockCause::DispositionMissing, reference: r.receipt_id, order_id: None }),
                _ => {}
            }
            v
        }
        Source::EntitlementRecorded(e) => vec![D::RefundObligation { obligation_id: e.entitlement_id, invoice_id: e.invoice_id, credit_id: e.credit_id, original_transaction_id: Some(e.original_transaction_id), amount_minor: e.amount_minor, currency: e.currency, basis: "explicit_entitlement".into(), destination: e.destination }],
        Source::EntitlementRevised(e) => vec![D::RefundObligationRevised { obligation_id: e.entitlement_id, amount_minor: e.amount_minor, currency: e.currency, state: e.state }],
        Source::RefundPending(r) => vec![D::RefundObservation { refund_id: r.refund_id.clone(), original_transaction_id: r.original_transaction_id.clone(), order_id: r.order_id, amount_minor: r.amount_minor, currency: r.currency.clone(), state: "pending".into(), destination: r.destination },
            D::CashHold { hold_id: format!("refund:{}", r.refund_id), account_id: rs.transaction_account(&r.original_transaction_id).unwrap_or_else(|| "default".into()), currency: r.currency, amount_minor: r.amount_minor, state: "placed".into(), reason: "pending_refund".into(), source: "pending_refund".into(), transaction_id: Some(r.original_transaction_id) }],
        Source::RefundCompleted(r) => {
            let eff = r.economic_effect_id.clone().unwrap_or_else(|| format!("refund:{}", r.refund_id));
            let account = rs.transaction_account(&r.original_transaction_id).unwrap_or_else(|| "default".into());
            vec![D::RefundObservation { refund_id: r.refund_id.clone(), original_transaction_id: r.original_transaction_id.clone(), order_id: r.order_id.clone(), amount_minor: r.amount_minor, currency: r.currency.clone(), state: "completed".into(), destination: "original_payment".into() },
                 D::CashMovement { account_id: account.clone(), currency: r.currency.clone(), amount_minor: -r.amount_minor, kind: CashKind::Refund, transaction_id: Some(r.original_transaction_id.clone()), payout_id: None, reference: r.refund_id.clone(), economic_effect_id: Some(eff), order_id: r.order_id },
                 D::CashHold { hold_id: format!("refund:{}", r.refund_id), account_id: account, currency: r.currency, amount_minor: r.amount_minor, state: "released".into(), reason: "refund_completed".into(), source: "pending_refund".into(), transaction_id: Some(r.original_transaction_id) }]
        }
        Source::RefundFailed(r) => vec![D::RefundObservation { refund_id: r.refund_id.clone(), original_transaction_id: r.original_transaction_id.clone(), order_id: None, amount_minor: r.amount_minor, currency: r.currency.clone(), state: "failed".into(), destination: "original_payment".into() },
            D::CashHold { hold_id: format!("refund:{}", r.refund_id), account_id: "default".into(), currency: r.currency, amount_minor: r.amount_minor, state: "released".into(), reason: "refund_failed".into(), source: "pending_refund".into(), transaction_id: Some(r.original_transaction_id) }],
        Source::RefundReversed(r) => vec![D::RefundObservation { refund_id: r.refund_id.clone(), original_transaction_id: r.original_transaction_id.clone(), order_id: None, amount_minor: r.amount_minor, currency: r.currency.clone(), state: "reversed".into(), destination: "original_payment".into() },
            D::CashMovement { account_id: rs.transaction_account(&r.original_transaction_id).unwrap_or_else(|| "default".into()), currency: r.currency, amount_minor: r.amount_minor, kind: CashKind::Refund, transaction_id: Some(r.original_transaction_id), payout_id: None, reference: format!("reversal:{}", r.refund_id), economic_effect_id: Some(format!("refund_reversal:{}", r.refund_id)), order_id: None }],
        Source::DisputeOpened(d) => vec![D::DisputeObservation { dispute_id: d.dispute_id, original_transaction_id: Some(d.original_transaction_id), order_id: d.order_id, amount_minor: Some(d.amount_minor), currency: Some(d.currency), state: "open".into(), outcome: None, debit_minor: None, fee_minor: None, reversal_minor: None, posting_id: None }],
        Source::DisputeResolved(d) => vec![D::DisputeObservation { original_transaction_id: rs.dispute_transaction(&d.dispute_id), dispute_id: d.dispute_id, order_id: None, amount_minor: None, currency: None, state: "resolved".into(), outcome: Some(d.outcome), debit_minor: None, fee_minor: None, reversal_minor: None, posting_id: None }],
        Source::ChargebackDebit(c) => {
            let mut v = vec![D::DisputeObservation { dispute_id: c.dispute_id.clone(), original_transaction_id: Some(c.original_transaction_id.clone()), order_id: None, amount_minor: None, currency: Some(c.currency.clone()), state: "debit_posted".into(), outcome: None, debit_minor: Some(c.debit_minor), fee_minor: Some(c.fee_minor), reversal_minor: None, posting_id: Some(c.debit_posting_id.clone()) },
                D::CashMovement { account_id: "default".into(), currency: c.currency.clone(), amount_minor: -c.debit_minor, kind: CashKind::ChargebackDebit, transaction_id: Some(c.original_transaction_id.clone()), payout_id: None, reference: c.debit_posting_id.clone(), economic_effect_id: Some(format!("chargeback:{}", c.debit_posting_id)), order_id: None }];
            if c.fee_minor != 0 { v.push(D::CashMovement { account_id: "default".into(), currency: c.currency, amount_minor: -c.fee_minor, kind: CashKind::ChargebackFee, transaction_id: Some(c.original_transaction_id), payout_id: None, reference: format!("fee:{}", c.debit_posting_id), economic_effect_id: Some(format!("chargeback_fee:{}", c.debit_posting_id)), order_id: None }); }
            v
        }
        Source::ChargebackReversed(c) => vec![D::DisputeObservation { original_transaction_id: rs.dispute_transaction(&c.dispute_id), dispute_id: c.dispute_id.clone(), order_id: None, amount_minor: None, currency: Some(c.currency.clone()), state: "reversed".into(), outcome: None, debit_minor: None, fee_minor: None, reversal_minor: Some(c.reversal_minor), posting_id: Some(c.reversal_posting_id.clone()) },
            D::CashMovement { account_id: "default".into(), currency: c.currency, amount_minor: c.reversal_minor, kind: CashKind::ChargebackReversal, transaction_id: rs.dispute_transaction(&c.dispute_id), payout_id: None, reference: c.reversal_posting_id.clone(), economic_effect_id: Some(format!("chargeback_reversal:{}", c.reversal_posting_id)), order_id: None }],
        Source::CoverageObserved(c) => vec![D::CoverageFact { capability: c.capability, entity_scope: c.entity_scope, history_start: c.history_start, complete_through: c.complete_through, backfill_complete: c.backfill_complete, coverage_basis: c.coverage_basis, missing_fields: c.missing_fields }],
        Source::CoverageGap(c) => vec![D::CoverageGapFact { capability: c.capability, from: c.from, to: c.to, reason: c.reason }],
        Source::LinkRecorded(l) => vec![D::LinkFact { entity_type: l.entity_type, entity_id: l.entity_id, relationship_type: l.relationship_type, target_type: l.target_type, target_id: Some(l.target_id), confidence: l.confidence, revision: l.revision }],
        Source::LinkRevised(l) => vec![D::LinkFact { entity_type: l.entity_type, entity_id: l.entity_id, relationship_type: l.relationship_type, target_type: l.target_type, target_id: l.target_id, confidence: l.confidence, revision: l.revision }],
        Source::LinkConflict(l) => vec![D::LinkConflictFact { entity_type: l.entity_type, entity_id: l.entity_id, relationship_type: l.relationship_type, candidates: l.candidates, reason: l.reason }],
        Source::ReviewDecision(r) => vec![D::ReviewDecisionFact { case_id: r.case_id, decision: r.decision, reason: r.reason, asserted: r.asserted }],
    };
    Ok(out)
}

/// Turn derived payloads into appendable entries with provenance, deterministic dedup keys and entity links.
pub fn to_inputs(source: &JournalEntry, derived: &[Derived]) -> Vec<EntryInput> {
    derived.iter().enumerate().map(|(i, d)| {
        let refs: Vec<EntityRef> = d.touched().into_iter().map(|(k, id)| EntityRef { kind: k.as_str().to_string(), id }).collect();
        let record_id = refs.first().map(|r| format!("{}:{}", r.kind, r.id)).unwrap_or_else(|| source.record_id.clone());
        EntryInput {
            record_type: d.record_type(), record_id, event_type: d.event_type(), schema_version: SCHEMA_VERSION,
            connection_id: source.connection_id, provider_namespace: source.provider_namespace.clone(),
            dedup_key: format!("derived:{}:{}:{}", source.entry_id, RULE_VERSION, i), occurred_at: source.occurred_at,
            entity_refs: refs, payload: serde_json::to_value(d).expect("serializable"), evidence_refs: source.evidence_refs.clone(),
            input_entry_ids: vec![source.entry_id], rule_version: Some(RULE_VERSION.to_string()), supersedes_entry_id: None,
            correlation_id: source.correlation_id.clone().or_else(|| Some(source.entry_id.to_string())), causation_id: Some(source.entry_id.to_string()),
        }
    }).collect()
}

//! Per-entity projections folded from derived entries. Deterministic and order-dependent only on journal sequence.
use crate::derived::*;
use crate::money::Qty;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct ApplyMeta { pub entry_id: Uuid, pub sequence: i64, pub occurred_at: chrono::DateTime<chrono::Utc>, pub recorded_at: chrono::DateTime<chrono::Utc> }

fn q(s: &str) -> Qty { Qty::parse(s).unwrap_or(Qty::ZERO) }
fn qo(s: &Option<String>) -> Option<Qty> { s.as_deref().map(q) }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct Provenance { pub entry_ids: Vec<Uuid>, pub last_sequence: i64, pub last_occurred_at: Option<chrono::DateTime<chrono::Utc>> }
impl Provenance { fn touch(&mut self, m: &ApplyMeta) { if self.entry_ids.len() < 2000 { self.entry_ids.push(m.entry_id); } self.last_sequence = m.sequence; self.last_occurred_at = Some(self.last_occurred_at.map_or(m.occurred_at, |p| p.max(m.occurred_at))); } }

// ------------------------------------------------------------------ order
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct LineState { pub line_id: String, pub item_id: String, pub unit: String, pub quantity: Qty, pub line_gross_minor: i64, pub cancelled: Qty, pub dispatched: Qty, pub delivered: Qty, pub reserved: Qty, pub returned_requested: Qty, pub returned_received: Qty }
impl LineState { pub fn remaining_obligation(&self) -> Qty { self.quantity.saturating_sub_floor0(self.cancelled).saturating_sub_floor0(self.dispatched) } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct OrderState {
    pub order_id: String, pub customer_id: Option<String>, pub currency: String, pub agreed_version: i64, pub gross_minor: i64, pub shipping_minor: Option<i64>,
    pub lines: Vec<LineState>, pub cancelled: bool, pub accepted_at: Option<chrono::DateTime<chrono::Utc>>,
    pub invoices: BTreeSet<String>, pub transactions: BTreeSet<String>, pub shipments: BTreeSet<String>, pub returns: BTreeSet<String>, pub refunds: BTreeSet<String>, pub disputes: BTreeSet<String>, pub reservations: BTreeSet<String>,
    pub authorized_minor: i64, pub captured_minor: i64, pub voided_minor: i64, pub failed_attempts: Vec<String>, pub refunded_minor: i64, pub pending_refund_minor: i64,
    pub dispatched_all: bool, pub delivered_all: bool, pub prov: Provenance,
}
impl OrderState {
    pub fn remaining_minor(&self) -> i64 { (self.gross_minor - self.captured_minor).max(0) }
    pub fn payment_state(&self) -> &'static str {
        if self.captured_minor >= self.gross_minor && self.gross_minor > 0 { "paid" } else if self.captured_minor > 0 { "partially_collected" } else if self.authorized_minor > 0 && self.voided_minor < self.authorized_minor { "authorized_only" } else if !self.failed_attempts.is_empty() { "failed" } else { "awaiting_payment" }
    }
    pub fn is_open(&self) -> bool { !self.cancelled && self.lines.iter().any(|l| !l.remaining_obligation().is_zero()) }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) {
        match d {
            Derived::OrderObserved { order_id, customer_id, currency, lines, gross_minor, shipping_minor, agreed_version, change } => {
                self.order_id = order_id.clone(); if customer_id.is_some() { self.customer_id = customer_id.clone(); } self.currency = currency.clone();
                if *agreed_version >= self.agreed_version { self.agreed_version = *agreed_version; self.gross_minor = *gross_minor; if shipping_minor.is_some() { self.shipping_minor = *shipping_minor; }
                    for l in lines { let qv = q(&l.quantity); match self.lines.iter_mut().find(|x| x.line_id == l.line_id) { Some(x) => { x.quantity = qv; x.line_gross_minor = l.line_gross_minor; x.item_id = l.item_id.clone(); x.unit = l.unit.clone(); }
                        None => self.lines.push(LineState { line_id: l.line_id.clone(), item_id: l.item_id.clone(), unit: l.unit.clone(), quantity: qv, line_gross_minor: l.line_gross_minor, ..Default::default() }) } }
                    if change == "revised" { let keep: BTreeSet<&str> = lines.iter().map(|l| l.line_id.as_str()).collect(); for x in self.lines.iter_mut() { if !keep.contains(x.line_id.as_str()) { x.cancelled = x.quantity; } } }
                }
                if change == "accepted" && self.accepted_at.is_none() { self.accepted_at = Some(m.occurred_at); }
            }
            Derived::OrderCancellation { lines, full, .. } => { if *full && lines.is_none() { self.cancelled = true; for l in self.lines.iter_mut() { l.cancelled = l.quantity; } } else if let Some(ls) = lines { for c in ls { if let Some(x) = self.lines.iter_mut().find(|x| x.line_id == c.line_id) { x.cancelled = x.cancelled.checked_add(q(&c.quantity)).unwrap_or(x.cancelled).min(x.quantity); } } self.cancelled = self.lines.iter().all(|l| l.cancelled >= l.quantity); } }
            Derived::InvoiceDocument { invoice_id, .. } | Derived::ReceivableAsserted { invoice_id, .. } => { self.invoices.insert(invoice_id.clone()); }
            Derived::PaymentAttempt { transaction_id, kind, amount_minor, .. } => { self.transactions.insert(transaction_id.clone()); match kind { PaymentKind::Authorized => self.authorized_minor += amount_minor, PaymentKind::Captured => self.captured_minor += amount_minor, PaymentKind::Voided => self.voided_minor += amount_minor, PaymentKind::Failed => self.failed_attempts.push(transaction_id.clone()) } }
            Derived::ShipmentObservation { shipment_id, lines, state, .. } => {
                self.shipments.insert(shipment_id.clone());
                if state == "in_transit" { for l in lines { if let Some(x) = self.lines.iter_mut().find(|x| x.line_id == l.line_id) { x.dispatched = x.dispatched.checked_add(q(&l.quantity)).unwrap_or(x.dispatched); } } }
                if state == "delivered" { for x in self.lines.iter_mut() { x.delivered = x.dispatched; } }
                self.dispatched_all = !self.lines.is_empty() && self.lines.iter().all(|l| l.remaining_obligation().is_zero()); self.delivered_all = self.dispatched_all && state == "delivered";
            }
            Derived::ReturnRequest { return_id, lines, .. } => { self.returns.insert(return_id.clone()); for l in lines { if let Some(x) = self.lines.iter_mut().find(|x| Some(&x.line_id) == l.line_id.as_ref() || x.item_id == l.item_id) { x.returned_requested = x.returned_requested.checked_add(q(&l.quantity)).unwrap_or(x.returned_requested); } } }
            Derived::RefundObservation { refund_id, amount_minor, state, .. } => { self.refunds.insert(refund_id.clone()); match state.as_str() { "pending" => self.pending_refund_minor += amount_minor, "completed" => { self.refunded_minor += amount_minor; self.pending_refund_minor = (self.pending_refund_minor - amount_minor).max(0); } "failed" => self.pending_refund_minor = (self.pending_refund_minor - amount_minor).max(0), "reversed" => self.refunded_minor -= amount_minor, _ => {} } }
            Derived::DisputeObservation { dispute_id, .. } => { self.disputes.insert(dispute_id.clone()); }
            Derived::StockReservation { reservation_id, line_id, item_id, quantity, state, .. } => { self.reservations.insert(reservation_id.clone()); let qv = q(quantity); let target = self.lines.iter_mut().find(|x| Some(&x.line_id) == line_id.as_ref()).or_else(|| None);
                let idx = match target { Some(t) => Some(t.line_id.clone()), None => item_id.as_ref().and_then(|i| self.lines.iter().find(|x| &x.item_id == i).map(|x| x.line_id.clone())).or_else(|| self.lines.first().map(|x| x.line_id.clone())) };
                if let Some(id) = idx { if let Some(x) = self.lines.iter_mut().find(|x| x.line_id == id) { match state.as_str() { "reserved" => x.reserved = x.reserved.checked_add(qv).unwrap_or(x.reserved), "released" => x.reserved = x.reserved.saturating_sub_floor0(qv), "revised" => x.reserved = qv, _ => {} } } } }
            Derived::StockMovement { .. } | Derived::CashMovement { .. } | Derived::OrderObligation { .. } | Derived::OrderObligationCancelled { .. } | Derived::CommunicationFact { .. } | Derived::PromiseAsserted { .. } | Derived::AllocationObservation { .. } => {}
            _ => {}
        }
        self.prov.touch(m);
    }
}

// ------------------------------------------------------------------ item / stock
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct LocationStock { pub basis: Option<String>, pub physical: Option<Qty>, pub provider_available: Option<Qty>, pub committed: Option<Qty>, pub snapshot_reserved: Option<Qty>, pub damaged: Qty, pub safety_stock: Qty, pub quality_control: Qty, pub quarantined: Qty, pub incoming: Option<Qty>, pub snapshot_sequence: i64,
    /// effective time of the authoritative snapshot: movements effective at or before it are already included in the basis and are not applied twice
    #[serde(default)] pub basis_effective_at: Option<chrono::DateTime<chrono::Utc>>, #[serde(default)] pub movements_before_basis_skipped: u64 }
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ItemState { pub item_id: String, pub unit: Option<String>, pub locations: BTreeMap<String, LocationStock>, pub active_reservations: BTreeMap<String, Qty>, pub open_orders: BTreeSet<String>, pub supply_promises: BTreeSet<String>, pub prov: Provenance }
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Availability { pub basis_known: bool, pub basis: String, pub physical: Option<Qty>, pub quarantined: Qty, pub damaged: Qty, pub safety_stock: Qty, pub quality_control: Qty, pub reserved: Qty, pub available: Option<Qty>, pub incoming: Option<Qty>, pub unit: Option<String> }
impl ItemState {
    pub fn reserved_total(&self) -> Qty { self.active_reservations.values().fold(Qty::ZERO, |a, b| a.checked_add(*b).unwrap_or(a)) }
    pub fn availability(&self) -> Availability {
        let reserved = self.reserved_total();
        let mut phys: Option<Qty> = None; let mut quar = Qty::ZERO; let mut dmg = Qty::ZERO; let mut safety = Qty::ZERO; let mut qc = Qty::ZERO; let mut incoming: Option<Qty> = None; let mut provider_available: Option<Qty> = None; let mut basis = String::from("unknown"); let mut known = false;
        for l in self.locations.values() {
            if let Some(b) = &l.basis { known = true; basis = b.clone(); }
            if let Some(p) = l.physical { phys = Some(phys.unwrap_or(Qty::ZERO).checked_add(p).unwrap_or(p)); }
            if let Some(a) = l.provider_available { provider_available = Some(provider_available.unwrap_or(Qty::ZERO).checked_add(a).unwrap_or(a)); }
            quar = quar.checked_add(l.quarantined).unwrap_or(quar); dmg = dmg.checked_add(l.damaged).unwrap_or(dmg); safety = safety.checked_add(l.safety_stock).unwrap_or(safety); qc = qc.checked_add(l.quality_control).unwrap_or(qc);
            if let Some(i) = l.incoming { incoming = Some(incoming.unwrap_or(Qty::ZERO).checked_add(i).unwrap_or(i)); }
        }
        let available = if !known { None } else if basis == "provider_available" { provider_available } else { phys.map(|p| Qty(p.0 - quar.0 - dmg.0 - safety.0 - qc.0 - reserved.0)) };
        Availability { basis_known: known, basis, physical: phys, quarantined: quar, damaged: dmg, safety_stock: safety, quality_control: qc, reserved, available, incoming, unit: self.unit.clone() }
    }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) {
        match d {
            Derived::StockSnapshot { item_id, location_id, unit, basis, physical, available, committed, reserved, damaged, safety_stock, quality_control, incoming } => {
                self.item_id = item_id.clone(); self.unit = Some(unit.clone());
                let loc = self.locations.entry(location_id.clone()).or_default();
                loc.basis = Some(basis.clone()); loc.physical = qo(physical); loc.provider_available = qo(available); loc.committed = qo(committed); loc.snapshot_reserved = qo(reserved);
                loc.damaged = qo(damaged).unwrap_or(Qty::ZERO); loc.safety_stock = qo(safety_stock).unwrap_or(Qty::ZERO); loc.quality_control = qo(quality_control).unwrap_or(Qty::ZERO); loc.quarantined = loc.quality_control; loc.incoming = qo(incoming); loc.snapshot_sequence = m.sequence; loc.basis_effective_at = Some(m.occurred_at);
            }
            Derived::StockMovement { item_id, location_id, unit, physical_delta, quarantine_delta, damaged_delta, .. } => {
                self.item_id = item_id.clone(); if self.unit.is_none() { self.unit = Some(unit.clone()); }
                let loc = self.locations.entry(location_id.clone()).or_default();
                // a movement whose effective time is not after the snapshot's effective time is already part of the snapshot basis (bitemporal: late-recorded, earlier-effective)
                if let Some(b) = loc.basis_effective_at { if m.occurred_at <= b { loc.movements_before_basis_skipped += 1; return; } }
                if let Some(p) = loc.physical { loc.physical = Some(p.checked_add(q(physical_delta)).unwrap_or(p)); }
                if let Some(a) = loc.provider_available { if loc.basis.as_deref() == Some("provider_available") { loc.provider_available = Some(a.checked_add(q(physical_delta)).unwrap_or(a)); } }
                loc.quarantined = loc.quarantined.checked_add(q(quarantine_delta)).unwrap_or(loc.quarantined); loc.damaged = loc.damaged.checked_add(q(damaged_delta)).unwrap_or(loc.damaged);
            }
            Derived::StockReservation { reservation_id, quantity, state, .. } => { match state.as_str() { "reserved" => { self.active_reservations.insert(reservation_id.clone(), q(quantity)); } "revised" => { self.active_reservations.insert(reservation_id.clone(), q(quantity)); } "released" => { if let Some(cur) = self.active_reservations.get(reservation_id).copied() { let rest = cur.saturating_sub_floor0(q(quantity)); if rest.is_zero() { self.active_reservations.remove(reservation_id); } else { self.active_reservations.insert(reservation_id.clone(), rest); } } } _ => {} } }
            Derived::OrderObserved { order_id, .. } | Derived::OrderObligation { order_id, .. } => { self.open_orders.insert(order_id.clone()); }
            Derived::OrderCancellation { order_id, full: true, lines: None } => { self.open_orders.remove(order_id); }
            Derived::PromiseAsserted { promise_id, kind, .. } if kind == "supply" => { self.supply_promises.insert(promise_id.clone()); }
            _ => {}
        }
        self.prov.touch(m);
    }
}

// ------------------------------------------------------------------ invoice / receivable
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct InvoiceState {
    pub invoice_id: String, pub document_ids: BTreeSet<String>, pub order_id: Option<String>, pub customer_id: Option<String>, pub currency: String, pub gross_minor: i64, pub revision: i64, pub draft: bool, pub due_date: Option<String>,
    pub credits: Vec<(String, i64, bool)>, pub cancelled: bool, pub reported_paid_minor: i64, pub payment_markers: Vec<(Option<String>, i64)>, pub allocations: BTreeMap<String, (i64, String)>, pub dispatch: Vec<(String, String, Option<String>)>,
    pub line_links: Vec<crate::payloads::InvoiceLineLink>, pub cases: BTreeSet<String>, pub finalized: bool, pub prov: Provenance,
}
impl InvoiceState {
    pub fn credits_minor(&self) -> i64 { self.credits.iter().map(|c| c.1).sum() }
    pub fn net_minor(&self) -> i64 { if self.cancelled { 0 } else { self.gross_minor - self.credits_minor() } }
    /// Open receivable as reported by the invoicing tool (payment markers are not bank evidence).
    pub fn reported_open_minor(&self) -> i64 { (self.net_minor() - self.reported_paid_minor).max(0) }
    pub fn allocated_minor(&self) -> i64 { self.allocations.values().filter(|a| a.1 == "confirmed").map(|a| a.0).sum() }
    /// Refund owed to a paid customer because of credits issued on paid portions. Cash-confirmed credits and unpaid portions create no refund.
    pub fn refund_payable_from_credits(&self) -> i64 { let paid = self.reported_paid_minor.min(self.gross_minor); let credit_cash = self.credits.iter().filter(|c| !c.2).map(|c| c.1).sum::<i64>(); credit_cash.min((paid - (self.gross_minor - credit_cash).max(0)).max(0)) }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) {
        match d {
            Derived::InvoiceDocument { document_id, invoice_id, order_id, customer_id, currency, gross_minor, due_date, line_links, revision, draft } => { self.invoice_id = invoice_id.clone(); self.document_ids.insert(document_id.clone()); if order_id.is_some() { self.order_id = order_id.clone(); } if customer_id.is_some() { self.customer_id = customer_id.clone(); } self.currency = currency.clone(); if *revision >= self.revision { self.revision = *revision; self.gross_minor = *gross_minor; self.draft = *draft; if due_date.is_some() { self.due_date = due_date.clone(); } self.line_links = line_links.clone(); } if !draft { self.finalized = true; } }
            Derived::InvoiceRevision { document_id, revision, gross_minor, .. } => { self.document_ids.insert(document_id.clone()); if *revision >= self.revision { self.revision = *revision; self.gross_minor = *gross_minor; } }
            Derived::CreditNote { document_id, credit_id, credit_minor, cash_refund_confirmed, .. } => { self.document_ids.insert(document_id.clone()); if !self.credits.iter().any(|c| &c.0 == credit_id) { self.credits.push((credit_id.clone(), *credit_minor, *cash_refund_confirmed)); } }
            Derived::InvoiceCancellation { document_id, .. } => { self.document_ids.insert(document_id.clone()); self.cancelled = true; }
            Derived::PaymentMarker { transaction_id, paid_minor, .. } => { self.payment_markers.push((transaction_id.clone(), *paid_minor)); self.reported_paid_minor = self.payment_markers.iter().map(|p| p.1).sum(); }
            Derived::PaymentAllocation { allocation_id, amount_minor, confidence, .. } => { self.allocations.insert(allocation_id.clone(), (*amount_minor, confidence.clone())); }
            Derived::DispatchEvidence { dispatch_id, status, processed_at, .. } => { if !self.dispatch.iter().any(|x| &x.0 == dispatch_id) { self.dispatch.push((dispatch_id.clone(), status.clone(), processed_at.clone())); } }
            Derived::CaseFact { case_id, .. } => { self.cases.insert(case_id.clone()); }
            Derived::ReceivableAsserted { invoice_id, order_id, customer_id, currency, gross_minor, due_date, revision } => { self.invoice_id = invoice_id.clone(); if order_id.is_some() { self.order_id = order_id.clone(); } if customer_id.is_some() { self.customer_id = customer_id.clone(); } self.currency = currency.clone(); if *revision >= self.revision { self.revision = *revision; self.gross_minor = *gross_minor; if due_date.is_some() { self.due_date = due_date.clone(); } } self.finalized = true; }
            _ => {}
        }
        self.prov.touch(m);
    }
}

// ------------------------------------------------------------------ transaction (payment attempts + refunds/disputes on the same original)
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct TransactionState {
    pub transaction_id: String, pub order_id: Option<String>, pub account_id: String, pub gateway: Option<String>, pub currency: String, pub test: bool,
    pub authorized_minor: i64, pub captured_minor: i64, pub voided_minor: i64, pub failed: Vec<(String, i64, Option<String>)>, pub fee_minor: i64, pub parent_transaction_id: Option<String>, pub children: BTreeSet<String>,
    pub refunds: BTreeMap<String, (i64, String)>, pub disputes: BTreeMap<String, (i64, String)>, pub chargeback_debit_minor: i64, pub chargeback_fee_minor: i64, pub chargeback_reversed_minor: i64, pub holds: BTreeSet<String>, pub refund_obligations: BTreeSet<String>, pub prov: Provenance,
}
impl TransactionState {
    pub fn refunded_minor(&self) -> i64 { self.refunds.values().filter(|r| r.1 == "completed").map(|r| r.0).sum() }
    pub fn pending_refund_minor(&self) -> i64 { self.refunds.values().filter(|r| r.1 == "pending").map(|r| r.0).sum() }
    pub fn status(&self) -> &'static str { if self.captured_minor > 0 { "captured" } else if self.voided_minor > 0 { "voided" } else if self.authorized_minor > 0 { "authorized" } else if !self.failed.is_empty() { "failed" } else { "unknown" } }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) {
        match d {
            Derived::PaymentAttempt { transaction_id, parent_transaction_id, order_id, account_id, gateway, kind, amount_minor, currency, test, error_code, .. } => {
                if self.transaction_id.is_empty() || &self.transaction_id == transaction_id { self.transaction_id = transaction_id.clone(); self.order_id = Some(order_id.clone()); self.account_id = account_id.clone(); if gateway.is_some() { self.gateway = gateway.clone(); } self.currency = currency.clone(); self.test |= *test; if parent_transaction_id.is_some() { self.parent_transaction_id = parent_transaction_id.clone(); }
                    match kind { PaymentKind::Authorized => self.authorized_minor += amount_minor, PaymentKind::Captured => self.captured_minor += amount_minor, PaymentKind::Voided => self.voided_minor += amount_minor, PaymentKind::Failed => self.failed.push((transaction_id.clone(), *amount_minor, error_code.clone())) }
                } else { self.children.insert(transaction_id.clone()); match kind { PaymentKind::Captured => self.captured_minor += amount_minor, PaymentKind::Voided => self.voided_minor += amount_minor, _ => {} } }
            }
            Derived::FeeObservation { fee_minor, .. } => self.fee_minor += fee_minor,
            Derived::RefundObservation { refund_id, amount_minor, state, .. } => { self.refunds.insert(refund_id.clone(), (*amount_minor, state.clone())); }
            Derived::DisputeObservation { dispute_id, amount_minor, state, debit_minor, fee_minor, reversal_minor, .. } => { let e = self.disputes.entry(dispute_id.clone()).or_insert((0, String::new())); if let Some(a) = amount_minor { e.0 = *a; } e.1 = state.clone(); if let Some(dm) = debit_minor { self.chargeback_debit_minor += dm; } if let Some(f) = fee_minor { self.chargeback_fee_minor += f; } if let Some(r) = reversal_minor { self.chargeback_reversed_minor += r; } }
            Derived::CashHold { hold_id, .. } => { self.holds.insert(hold_id.clone()); }
            Derived::RefundObligation { obligation_id, .. } => { self.refund_obligations.insert(obligation_id.clone()); }
            _ => {}
        }
        self.prov.touch(m);
    }
}

// ------------------------------------------------------------------ provider account (per account/currency)
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct AccountState {
    pub account_id: String, pub currency: String, pub captured_minor: i64, pub fees_minor: i64, pub refunded_minor: i64, pub chargeback_minor: i64, pub chargeback_fee_minor: i64, pub chargeback_reversed_minor: i64, pub adjustments_minor: i64,
    pub payout_sent_minor: i64, pub payout_reversed_minor: i64, pub payouts: BTreeMap<String, (i64, String)>, pub holds: BTreeMap<String, (i64, String)>, pub bank_confirmed_minor: i64, pub bank_matched_payouts: BTreeSet<String>,
    pub ledger: BTreeMap<String, (String, i64, i64, i64, Option<String>)>, pub last_balance: Option<(String, Option<i64>, Option<i64>, Option<i64>, Option<i64>, String)>, pub prov: Provenance, #[serde(default)] pub effects_seen: BTreeSet<String> }
impl AccountState {
    pub fn balance_minor(&self) -> i64 { self.captured_minor - self.fees_minor - self.refunded_minor - self.chargeback_minor - self.chargeback_fee_minor + self.chargeback_reversed_minor + self.adjustments_minor - self.payout_sent_minor + self.payout_reversed_minor }
    pub fn held_minor(&self) -> i64 { self.holds.values().filter(|h| h.1 == "placed").map(|h| h.0).sum() }
    pub fn available_minor(&self) -> i64 { self.balance_minor() - self.held_minor() }
    pub fn announced_minor(&self) -> i64 { self.payouts.values().filter(|p| p.1 == "announced").map(|p| p.0).sum() }
    pub fn in_transit_minor(&self) -> i64 { self.payouts.iter().filter(|(id, p)| p.1 == "sent" && !self.bank_matched_payouts.contains(*id)).map(|(_, p)| p.0).sum() }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) {
        match d {
            Derived::CashMovement { account_id, currency, amount_minor, kind, payout_id, economic_effect_id, .. } => { self.account_id = account_id.clone(); self.currency = currency.clone();
                // one economic effect (e.g. the fee of a capture reported by the gateway and again by the provider ledger) counts once
                if let Some(e) = economic_effect_id { if !self.effects_seen.insert(e.clone()) { return; } }
                match kind {
                CashKind::Capture => self.captured_minor += amount_minor, CashKind::Fee => self.fees_minor += -amount_minor, CashKind::Refund => self.refunded_minor += -amount_minor,
                CashKind::PayoutTransfer => { self.payout_sent_minor += -amount_minor; if let Some(p) = payout_id { self.payouts.insert(p.clone(), (-amount_minor, "sent".into())); } }
                CashKind::PayoutReversal => { self.payout_reversed_minor += amount_minor; if let Some(p) = payout_id { if let Some(e) = self.payouts.get_mut(p) { e.1 = "reversed".into(); } } }
                CashKind::ChargebackDebit => self.chargeback_minor += -amount_minor, CashKind::ChargebackFee => self.chargeback_fee_minor += -amount_minor, CashKind::ChargebackReversal => self.chargeback_reversed_minor += amount_minor, CashKind::LedgerAdjustment => self.adjustments_minor += amount_minor } }
            Derived::PayoutObservation { payout_id, account_id, amount_minor, currency, state, .. } => { if !account_id.is_empty() && account_id != "default" || self.account_id.is_empty() { self.account_id = account_id.clone(); } if let Some(c) = currency { self.currency = c.clone(); } let e = self.payouts.entry(payout_id.clone()).or_insert((0, String::new())); if let Some(a) = amount_minor { e.0 = *a; } if state == "announced" && e.1 == "sent" { } else { e.1 = state.clone(); } }
            Derived::PayoutAnnouncedCommitment { .. } => {}
            Derived::CashHold { hold_id, amount_minor, state, .. } => { match state.as_str() { "placed" => { self.holds.insert(hold_id.clone(), (*amount_minor, "placed".into())); } "released" => { if let Some(h) = self.holds.get_mut(hold_id) { let rest = h.0 - amount_minor; if rest <= 0 { h.1 = "released".into(); h.0 = 0; } else { h.0 = rest; } } } _ => {} } }
            Derived::BankMovement { payout_id: Some(p), amount_minor, direction, .. } if direction == "credit" => { if self.payouts.contains_key(p) && self.bank_matched_payouts.insert(p.clone()) { self.bank_confirmed_minor += amount_minor; } }
            Derived::BankMatchDecision { payout_id: Some(p), confidence, .. } if confidence == "confirmed" => { if let Some(e) = self.payouts.get(p) { if self.bank_matched_payouts.insert(p.clone()) { self.bank_confirmed_minor += e.0; } } }
            Derived::LedgerPostingFact { ledger_entry_id, posting_type, gross_minor, fee_minor, net_minor, payout_id, .. } => { self.ledger.insert(ledger_entry_id.clone(), (posting_type.clone(), *gross_minor, *fee_minor, *net_minor, payout_id.clone())); }
            Derived::BalanceObservation { observed_at, total_minor, processing_minor, available_minor, held_minor, coverage, .. } => { self.last_balance = Some((observed_at.clone(), *total_minor, *processing_minor, *available_minor, *held_minor, coverage.clone())); }
            _ => {}
        }
        self.prov.touch(m);
    }
}

// ------------------------------------------------------------------ payouts, bank entries, shipments, returns, refunds, disputes, holds, promises, rules, cases, misc
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct PayoutState { pub payout_id: String, pub account_id: String, pub amount_minor: i64, pub currency: String, pub state: String, pub trace_reference: Option<String>, pub expected_at: Option<String>, pub issued_at: Option<String>, pub ledger_membership: Vec<String>, pub bank_entries: BTreeSet<String>, pub bank_confirmed: bool, pub prov: Provenance }
impl PayoutState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { match d {
    Derived::PayoutObservation { payout_id, account_id, amount_minor, currency, state, trace_reference, expected_at, issued_at, ledger_membership, .. } => { self.payout_id = payout_id.clone(); if account_id != "default" || self.account_id.is_empty() { self.account_id = account_id.clone(); } if let Some(a) = amount_minor { self.amount_minor = *a; } if let Some(c) = currency { self.currency = c.clone(); } if !(state == "announced" && self.state == "sent") { self.state = state.clone(); } if trace_reference.is_some() { self.trace_reference = trace_reference.clone(); } if expected_at.is_some() { self.expected_at = expected_at.clone(); } if issued_at.is_some() { self.issued_at = issued_at.clone(); } if let Some(l) = ledger_membership { self.ledger_membership = l.clone(); } }
    Derived::LedgerPostingFact { ledger_entry_id, .. } => { if !self.ledger_membership.contains(ledger_entry_id) { self.ledger_membership.push(ledger_entry_id.clone()); } }
    Derived::BankMovement { entry_id, direction, .. } if direction == "credit" => { self.bank_entries.insert(entry_id.clone()); self.bank_confirmed = true; }
    Derived::BankMatchDecision { entry_id, confidence, payout_id, .. } => { if confidence == "confirmed" && payout_id.is_some() { self.bank_entries.insert(entry_id.clone()); self.bank_confirmed = true; } else if confidence == "rejected" { self.bank_entries.remove(entry_id); self.bank_confirmed = !self.bank_entries.is_empty(); } }
    _ => {} } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct BankEntryState { pub entry_id: String, pub account_id: String, pub direction: String, pub amount_minor: i64, pub currency: String, pub booking_status: String, pub booked_at: Option<String>, pub reference: Option<String>, pub statement_id: Option<String>, pub matched_payout: Option<String>, pub match_confidence: Option<String>, pub prov: Provenance }
impl BankEntryState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { match d {
    Derived::BankEntryFact { entry_id, statement_id, account_id, direction, amount_minor, currency, booking_status, booked_at, reference, payout_hint } => { self.entry_id = entry_id.clone(); self.statement_id = statement_id.clone(); self.account_id = account_id.clone(); self.direction = direction.clone(); self.amount_minor = *amount_minor; self.currency = currency.clone(); self.booking_status = booking_status.clone(); self.booked_at = booked_at.clone(); self.reference = reference.clone(); if payout_hint.is_some() && self.matched_payout.is_none() { self.matched_payout = payout_hint.clone(); self.match_confidence = Some("reference".into()); } }
    Derived::BankMatchDecision { payout_id, confidence, .. } => { if confidence == "rejected" { self.matched_payout = None; self.match_confidence = Some("rejected".into()); } else { self.matched_payout = payout_id.clone(); self.match_confidence = Some(confidence.clone()); } }
    _ => {} } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ShipmentState { pub shipment_id: String, pub order_id: Option<String>, pub lines: Vec<(String, Qty, String)>, pub state: String, pub carrier: Option<String>, pub tracking_number: Option<String>, pub handover_at: Option<String>, pub delivered_at: Option<String>, pub last_scan: Option<(String, String, String)>, pub forecast: Option<Option<String>>, pub scan_count: u32, pub prov: Provenance }
impl ShipmentState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { match d {
    Derived::ShipmentObservation { shipment_id, order_id, lines, state, carrier, tracking_number, handover_at, delivered_at, .. } => { self.shipment_id = shipment_id.clone(); if order_id.is_some() { self.order_id = order_id.clone(); } if !lines.is_empty() { self.lines = lines.iter().map(|l| (l.line_id.clone(), q(&l.quantity), l.unit.clone())).collect(); } let rank = |s: &str| match s { "label_created" => 1, "in_transit" => 2, "delivered" => 3, "cancelled" => 4, _ => 0 }; if rank(state) >= rank(&self.state) { self.state = state.clone(); } if carrier.is_some() { self.carrier = carrier.clone(); } if tracking_number.is_some() { self.tracking_number = tracking_number.clone(); } if handover_at.is_some() { self.handover_at = handover_at.clone(); } if delivered_at.is_some() { self.delivered_at = delivered_at.clone(); } }
    Derived::CarrierScanFact { status_code, effective_time, scan_identity, .. } => { self.scan_count += 1; if self.last_scan.as_ref().map_or(true, |s| effective_time >= &s.1) { self.last_scan = Some((status_code.clone(), effective_time.clone(), scan_identity.clone())); } }
    Derived::CarrierForecastFact { forecast, .. } => { self.forecast = Some(forecast.clone()); }
    _ => {} } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ReturnState { pub return_id: String, pub order_id: Option<String>, pub state: String, pub requested: BTreeMap<String, Qty>, pub received: BTreeMap<String, Qty>, pub quarantined: BTreeMap<String, Qty>, pub restocked: BTreeMap<String, Qty>, pub damaged: BTreeMap<String, Qty>, pub missing: BTreeMap<String, Qty>, pub expected_credit_minor: Option<i64>, pub currency: Option<String>, pub prov: Provenance }
impl ReturnState { fn add(map: &mut BTreeMap<String, Qty>, k: &str, v: Qty) { let e = map.entry(k.to_string()).or_insert(Qty::ZERO); *e = e.checked_add(v).unwrap_or(*e); }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) { match d {
    Derived::ReturnRequest { return_id, order_id, lines, state, expected_credit_minor, currency } => { self.return_id = return_id.clone(); if order_id.is_some() { self.order_id = order_id.clone(); } self.state = state.clone(); if state != "cancelled" && !lines.is_empty() { self.requested.clear(); for l in lines { Self::add(&mut self.requested, &l.item_id, q(&l.quantity)); } } if expected_credit_minor.is_some() { self.expected_credit_minor = *expected_credit_minor; } if currency.is_some() { self.currency = currency.clone(); } }
    Derived::ReturnReceipt { item_id, quantity, disposition, stage, .. } => { let qv = q(quantity); match stage.as_str() { "received" => { Self::add(&mut self.received, item_id, qv); match disposition.as_str() { "quarantine" => Self::add(&mut self.quarantined, item_id, qv), "restocked" => Self::add(&mut self.restocked, item_id, qv), "damaged" => Self::add(&mut self.damaged, item_id, qv), "missing" => Self::add(&mut self.missing, item_id, qv), _ => {} } }
        "restocked" => { Self::add(&mut self.restocked, item_id, qv); Self::add(&mut self.quarantined, item_id, Qty(-qv.0)); } "disposition" => { match disposition.as_str() { "restocked" => { Self::add(&mut self.restocked, item_id, qv); Self::add(&mut self.quarantined, item_id, Qty(-qv.0)); } "damaged" => { Self::add(&mut self.damaged, item_id, qv); Self::add(&mut self.quarantined, item_id, Qty(-qv.0)); } "missing" => { Self::add(&mut self.missing, item_id, qv); Self::add(&mut self.quarantined, item_id, Qty(-qv.0)); } _ => {} } } _ => {} } }
    _ => {} } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct RefundState { pub refund_id: String, pub original_transaction_id: String, pub order_id: Option<String>, pub amount_minor: i64, pub currency: String, pub state: String, pub destination: String, pub prov: Provenance }
impl RefundState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { if let Derived::RefundObservation { refund_id, original_transaction_id, order_id, amount_minor, currency, state, destination } = d { self.refund_id = refund_id.clone(); self.original_transaction_id = original_transaction_id.clone(); if order_id.is_some() { self.order_id = order_id.clone(); } self.amount_minor = *amount_minor; self.currency = currency.clone(); self.state = state.clone(); self.destination = destination.clone(); } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct DisputeState { pub dispute_id: String, pub original_transaction_id: Option<String>, pub order_id: Option<String>, pub amount_minor: Option<i64>, pub currency: Option<String>, pub state: String, pub outcome: Option<String>, pub debit_minor: i64, pub fee_minor: i64, pub reversed_minor: i64, pub postings: Vec<String>, pub prov: Provenance }
impl DisputeState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { if let Derived::DisputeObservation { dispute_id, original_transaction_id, order_id, amount_minor, currency, state, outcome, debit_minor, fee_minor, reversal_minor, posting_id } = d { self.dispute_id = dispute_id.clone(); if original_transaction_id.is_some() { self.original_transaction_id = original_transaction_id.clone(); } if order_id.is_some() { self.order_id = order_id.clone(); } if amount_minor.is_some() { self.amount_minor = *amount_minor; } if currency.is_some() { self.currency = currency.clone(); } if state != "debit_posted" && state != "reversed" || self.state.is_empty() { self.state = state.clone(); } if outcome.is_some() { self.outcome = outcome.clone(); } if let Some(x) = debit_minor { self.debit_minor += x; } if let Some(x) = fee_minor { self.fee_minor += x; } if let Some(x) = reversal_minor { self.reversed_minor += x; } if let Some(p) = posting_id { self.postings.push(p.clone()); } } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct HoldState { pub hold_id: String, pub account_id: Option<String>, pub transaction_id: Option<String>, pub currency: Option<String>, pub amount_minor: i64, pub released_minor: i64, pub reason: Option<String>, pub state: String, pub release_promised_at: Option<String>, pub released_at: Option<String>, pub source: String, pub prov: Provenance }
impl HoldState { pub fn held_minor(&self) -> i64 { (self.amount_minor - self.released_minor).max(0) }
    fn apply(&mut self, d: &Derived, m: &ApplyMeta) { match d {
    Derived::HoldObservation { hold_id, account_id, transaction_id, currency, amount_minor, reason, state, release_promised_at, released_at } => { self.hold_id = hold_id.clone(); if account_id.is_some() { self.account_id = account_id.clone(); } if transaction_id.is_some() { self.transaction_id = transaction_id.clone(); } if currency.is_some() { self.currency = currency.clone(); } if reason.is_some() { self.reason = reason.clone(); } match state.as_str() { "active" => { self.amount_minor = amount_minor.unwrap_or(0); self.state = "active".into(); } "released" => { self.released_minor += amount_minor.unwrap_or(0); if self.released_minor >= self.amount_minor { self.state = "released".into(); } self.released_at = released_at.clone(); } "release_promised" => { self.release_promised_at = release_promised_at.clone(); } _ => {} } }
    Derived::CashHold { hold_id, account_id, currency, amount_minor, state, reason, source, transaction_id } => { self.hold_id = hold_id.clone(); self.source = source.clone(); if !account_id.is_empty() { self.account_id = Some(account_id.clone()); } self.currency = Some(currency.clone()); if transaction_id.is_some() { self.transaction_id = transaction_id.clone(); } if state == "placed" { self.amount_minor = *amount_minor; self.state = "active".into(); if !reason.is_empty() { self.reason = Some(reason.clone()); } } else { self.released_minor += amount_minor; if self.released_minor >= self.amount_minor { self.state = "released".into(); } } }
    _ => {} } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct PromiseState { pub promise_id: String, pub kind: String, pub promise_kind: Option<String>, pub item_id: Option<String>, pub supplier_id: Option<String>, pub order_id: Option<String>, pub line_id: Option<String>, pub quantity: Option<Qty>, pub unit: Option<String>, pub promised_at: String, pub timezone: String, pub revision: i64, pub history: Vec<(i64, String)>, pub allocation_links: Vec<String>, pub prov: Provenance }
impl PromiseState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { if let Derived::PromiseAsserted { promise_id, kind, item_id, supplier_id, order_id, line_id, quantity, unit, promised_at, timezone, revision, allocation_links, promise_kind } = d { self.promise_id = promise_id.clone(); self.kind = kind.clone(); if promise_kind.is_some() { self.promise_kind = promise_kind.clone(); } if item_id.is_some() { self.item_id = item_id.clone(); } if supplier_id.is_some() { self.supplier_id = supplier_id.clone(); } if order_id.is_some() { self.order_id = order_id.clone(); } if line_id.is_some() { self.line_id = line_id.clone(); } if *revision >= self.revision { if let Some(qs) = quantity { self.quantity = Some(q(qs)); } if unit.is_some() { self.unit = unit.clone(); } self.promised_at = promised_at.clone(); self.timezone = timezone.clone(); self.revision = *revision; if !allocation_links.is_empty() { self.allocation_links = allocation_links.clone(); } } self.history.push((*revision, promised_at.clone())); } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct RuleState { pub rule_id: String, pub rule_kind: String, pub version: i64, pub effective_from: String, pub priority_method: Option<String>, pub invoicing_trigger: Option<String>, pub reminder_policy: Option<String>, pub tolerance: Option<Value>, pub timezone: Option<String>, pub versions: Vec<(i64, String)>, pub prov: Provenance }
impl RuleState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { if let Derived::RuleFact { rule_id, rule_kind, version, effective_from, priority_method, invoicing_trigger, tolerance, reminder_policy, changes, timezone } = d { self.rule_id = rule_id.clone(); if let Some(k) = rule_kind { self.rule_kind = k.clone(); } if *version >= self.version { self.version = *version; self.effective_from = effective_from.clone(); if priority_method.is_some() { self.priority_method = priority_method.clone(); } if invoicing_trigger.is_some() { self.invoicing_trigger = invoicing_trigger.clone(); } if reminder_policy.is_some() { self.reminder_policy = reminder_policy.clone(); } if tolerance.is_some() { self.tolerance = tolerance.clone(); } if timezone.is_some() { self.timezone = timezone.clone(); }
    if let Some(Value::Object(c)) = changes { if let Some(Value::String(s)) = c.get("priority_method") { self.priority_method = Some(s.clone()); } if let Some(Value::String(s)) = c.get("invoicing_trigger") { self.invoicing_trigger = Some(s.clone()); } if let Some(Value::String(s)) = c.get("reminder_policy") { self.reminder_policy = Some(s.clone()); } } } self.versions.push((*version, effective_from.clone())); } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct CaseState { pub case_id: String, pub customer_id: Option<String>, pub invoice_id: Option<String>, pub transaction_id: Option<String>, pub status: String, pub agreed_extension_until: Option<String>, pub prov: Provenance }
impl CaseState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { if let Derived::CaseFact { case_id, customer_id, invoice_id, transaction_id, status, agreed_extension_until } = d { self.case_id = case_id.clone(); if customer_id.is_some() { self.customer_id = customer_id.clone(); } if invoice_id.is_some() { self.invoice_id = invoice_id.clone(); } if transaction_id.is_some() { self.transaction_id = transaction_id.clone(); } self.status = status.clone(); self.agreed_extension_until = agreed_extension_until.clone(); } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct RefundObligationState { pub obligation_id: String, pub invoice_id: Option<String>, pub credit_id: Option<String>, pub original_transaction_id: Option<String>, pub amount_minor: i64, pub currency: String, pub basis: String, pub destination: String, pub state: String, pub prov: Provenance }
impl RefundObligationState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { match d { Derived::RefundObligation { obligation_id, invoice_id, credit_id, original_transaction_id, amount_minor, currency, basis, destination } => { self.obligation_id = obligation_id.clone(); self.invoice_id = invoice_id.clone(); self.credit_id = credit_id.clone(); self.original_transaction_id = original_transaction_id.clone(); self.amount_minor = *amount_minor; self.currency = currency.clone(); self.basis = basis.clone(); self.destination = destination.clone(); self.state = "approved".into(); } Derived::RefundObligationRevised { amount_minor, state, .. } => { self.amount_minor = *amount_minor; self.state = state.clone(); } _ => {} } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct ReservationState { pub reservation_id: String, pub order_id: Option<String>, pub line_id: Option<String>, pub item_id: Option<String>, pub location_id: Option<String>, pub quantity: Qty, pub unit: String, pub state: String, pub release_reason: Option<String>, pub prov: Provenance }
impl ReservationState { fn apply(&mut self, d: &Derived, m: &ApplyMeta) { if let Derived::StockReservation { reservation_id, order_id, line_id, item_id, location_id, quantity, unit, state, reason } = d { self.reservation_id = reservation_id.clone(); if order_id.is_some() { self.order_id = order_id.clone(); } if line_id.is_some() { self.line_id = line_id.clone(); } if item_id.is_some() { self.item_id = item_id.clone(); } if location_id.is_some() { self.location_id = location_id.clone(); } if !unit.is_empty() { self.unit = unit.clone(); } match state.as_str() { "reserved" => { self.quantity = q(quantity); self.state = "active".into(); } "revised" => { self.quantity = q(quantity); self.state = if self.quantity.is_zero() { "released".into() } else { "active".into() }; } "released" => { self.quantity = self.quantity.saturating_sub_floor0(q(quantity)); if self.quantity.is_zero() { self.state = "released".into(); self.release_reason = reason.clone(); } } _ => {} } } self.prov.touch(m); } }

/// Generic fact collector for entities with no calculation (customers, messages, coverage, links, tracking, ledger entries, review cases).
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct FactsState { pub id: String, pub facts: Vec<Value>, pub prov: Provenance }
impl FactsState { fn apply(&mut self, id: &str, d: &Derived, m: &ApplyMeta) { self.id = id.to_string(); if self.facts.len() < 500 { self.facts.push(serde_json::to_value(d).unwrap_or(Value::Null)); } self.prov.touch(m); } }

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(tag = "entity", rename_all = "snake_case")]
pub enum EntityState {
    Order(OrderState), Item(ItemState), Invoice(InvoiceState), Transaction(TransactionState), Account(AccountState), Payout(PayoutState), BankEntry(BankEntryState), Shipment(ShipmentState),
    Return(ReturnState), Refund(RefundState), Dispute(DisputeState), Hold(HoldState), Promise(PromiseState), Rule(RuleState), Case(CaseState), RefundObligation(RefundObligationState), Reservation(ReservationState), Facts(FactsState),
}

impl EntityState {
    pub fn new(kind: EntityKind, id: &str) -> EntityState {
        match kind {
            EntityKind::Order => EntityState::Order(OrderState { order_id: id.into(), ..Default::default() }),
            EntityKind::Item => EntityState::Item(ItemState { item_id: id.into(), ..Default::default() }),
            EntityKind::Invoice => EntityState::Invoice(InvoiceState { invoice_id: id.into(), ..Default::default() }),
            EntityKind::Transaction => EntityState::Transaction(TransactionState { transaction_id: id.into(), ..Default::default() }),
            EntityKind::Account => { let (a, c) = id.split_once('/').unwrap_or((id, "")); EntityState::Account(AccountState { account_id: a.into(), currency: c.into(), ..Default::default() }) }
            EntityKind::Payout => EntityState::Payout(PayoutState { payout_id: id.into(), ..Default::default() }),
            EntityKind::BankEntry => EntityState::BankEntry(BankEntryState { entry_id: id.into(), ..Default::default() }),
            EntityKind::Shipment => EntityState::Shipment(ShipmentState { shipment_id: id.into(), ..Default::default() }),
            EntityKind::Return => EntityState::Return(ReturnState { return_id: id.into(), ..Default::default() }),
            EntityKind::Refund => EntityState::Refund(RefundState { refund_id: id.into(), ..Default::default() }),
            EntityKind::Dispute => EntityState::Dispute(DisputeState { dispute_id: id.into(), ..Default::default() }),
            EntityKind::Hold => EntityState::Hold(HoldState { hold_id: id.into(), ..Default::default() }),
            EntityKind::Promise => EntityState::Promise(PromiseState { promise_id: id.into(), ..Default::default() }),
            EntityKind::Rule => EntityState::Rule(RuleState { rule_id: id.into(), ..Default::default() }),
            EntityKind::Case => EntityState::Case(CaseState { case_id: id.into(), ..Default::default() }),
            EntityKind::RefundObligation => EntityState::RefundObligation(RefundObligationState { obligation_id: id.into(), ..Default::default() }),
            EntityKind::Reservation => EntityState::Reservation(ReservationState { reservation_id: id.into(), ..Default::default() }),
            _ => EntityState::Facts(FactsState { id: id.into(), ..Default::default() }),
        }
    }
    pub fn apply(&mut self, d: &Derived, m: &ApplyMeta) {
        match self {
            EntityState::Order(s) => s.apply(d, m), EntityState::Item(s) => s.apply(d, m), EntityState::Invoice(s) => s.apply(d, m), EntityState::Transaction(s) => s.apply(d, m),
            EntityState::Account(s) => s.apply(d, m), EntityState::Payout(s) => s.apply(d, m), EntityState::BankEntry(s) => s.apply(d, m), EntityState::Shipment(s) => s.apply(d, m),
            EntityState::Return(s) => s.apply(d, m), EntityState::Refund(s) => s.apply(d, m), EntityState::Dispute(s) => s.apply(d, m), EntityState::Hold(s) => s.apply(d, m),
            EntityState::Promise(s) => s.apply(d, m), EntityState::Rule(s) => s.apply(d, m), EntityState::Case(s) => s.apply(d, m), EntityState::RefundObligation(s) => s.apply(d, m),
            EntityState::Reservation(s) => s.apply(d, m), EntityState::Facts(s) => { let id = s.id.clone(); s.apply(&id, d, m) }
        }
    }
    pub fn provenance(&self) -> &Provenance {
        match self { EntityState::Order(s) => &s.prov, EntityState::Item(s) => &s.prov, EntityState::Invoice(s) => &s.prov, EntityState::Transaction(s) => &s.prov, EntityState::Account(s) => &s.prov, EntityState::Payout(s) => &s.prov, EntityState::BankEntry(s) => &s.prov, EntityState::Shipment(s) => &s.prov, EntityState::Return(s) => &s.prov, EntityState::Refund(s) => &s.prov, EntityState::Dispute(s) => &s.prov, EntityState::Hold(s) => &s.prov, EntityState::Promise(s) => &s.prov, EntityState::Rule(s) => &s.prov, EntityState::Case(s) => &s.prov, EntityState::RefundObligation(s) => &s.prov, EntityState::Reservation(s) => &s.prov, EntityState::Facts(s) => &s.prov }
    }
    /// Rough resident size estimate used for the bounded hot set.
    pub fn approx_bytes(&self) -> usize { 256 + self.provenance().entry_ids.len() * 16 + match self { EntityState::Order(s) => s.lines.len() * 160, EntityState::Item(s) => s.locations.len() * 120 + s.active_reservations.len() * 48, EntityState::Facts(s) => s.facts.len() * 200, EntityState::Account(s) => s.payouts.len() * 64 + s.ledger.len() * 96, _ => 200 } }
}

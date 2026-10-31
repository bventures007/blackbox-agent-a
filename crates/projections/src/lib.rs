//! Tenant-scoped bounded in-memory projections: resident entity states, always-resident indexes, LRU eviction,
//! and versioned snapshots. Hydration of evicted entities is delegated to the caller (storage crate).
use bbx_domain::derived::{Derived, EntityKind};
use bbx_domain::entry::JournalEntry;
use bbx_domain::state::{ApplyMeta, EntityState};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use uuid::Uuid;

pub type Key = (EntityKind, String);
pub const SNAPSHOT_FORMAT: u32 = 1;

/// JSON object keys must be strings: serialize Key-indexed collections as arrays of pairs/keys.
mod key_map {
    use super::*;
    pub fn serialize<S: serde::Serializer>(m: &HashMap<Key, EntityState>, s: S) -> Result<S::Ok, S::Error> { let v: Vec<(&Key, &EntityState)> = m.iter().collect(); v.serialize(s) }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<HashMap<Key, EntityState>, D::Error> { let v: Vec<(Key, EntityState)> = Vec::deserialize(d)?; Ok(v.into_iter().collect()) }
}
mod key_set {
    use super::*;
    pub fn serialize<S: serde::Serializer>(m: &HashSet<Key>, s: S) -> Result<S::Ok, S::Error> { let v: Vec<&Key> = m.iter().collect(); v.serialize(s) }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<HashSet<Key>, D::Error> { let v: Vec<Key> = Vec::deserialize(d)?; Ok(v.into_iter().collect()) }
}

#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq)]
pub struct Indexes {
    pub open_orders: BTreeSet<String>, pub cancelled_orders: BTreeSet<String>, pub all_orders: BTreeSet<String>, pub orders_by_customer: BTreeMap<String, BTreeSet<String>>,
    pub orders_by_item: BTreeMap<String, BTreeSet<String>>, pub items: BTreeSet<String>, pub invoices: BTreeSet<String>, pub open_invoices: BTreeSet<String>, pub invoices_by_order: BTreeMap<String, BTreeSet<String>>,
    pub transactions: BTreeSet<String>, pub transactions_by_order: BTreeMap<String, BTreeSet<String>>, pub failed_attempt_orders: BTreeSet<String>, pub accounts: BTreeSet<String>,
    pub payouts: BTreeSet<String>, pub payouts_unconfirmed: BTreeSet<String>, pub payouts_announced: BTreeSet<String>, pub bank_entries: BTreeSet<String>, pub bank_unmatched: BTreeSet<String>,
    pub holds_active: BTreeSet<String>, pub holds: BTreeSet<String>, pub shipments: BTreeSet<String>, pub shipments_open: BTreeSet<String>, pub shipments_by_order: BTreeMap<String, BTreeSet<String>>,
    pub returns: BTreeSet<String>, pub returns_open: BTreeSet<String>, pub refunds: BTreeSet<String>, pub refunds_pending: BTreeSet<String>, pub disputes: BTreeSet<String>, pub disputes_open: BTreeSet<String>,
    pub promises: BTreeSet<String>, pub supply_promises_by_item: BTreeMap<String, BTreeSet<String>>, pub customer_promises_by_order: BTreeMap<String, BTreeSet<String>>,
    pub rules_by_kind: BTreeMap<String, String>, pub cases: BTreeSet<String>, pub cases_by_invoice: BTreeMap<String, BTreeSet<String>>, pub refund_obligations: BTreeSet<String>, pub reservations_active: BTreeSet<String>,
    pub coverage: BTreeSet<String>, pub messages_by_order: BTreeMap<String, BTreeSet<String>>, pub links: BTreeSet<String>, pub link_conflicts: BTreeSet<String>, pub review_cases: BTreeSet<String>,
    pub entry_counts: BTreeMap<String, u64>,
}

fn ins(map: &mut BTreeMap<String, BTreeSet<String>>, k: &str, v: &str) { map.entry(k.to_string()).or_default().insert(v.to_string()); }

impl Indexes {
    fn reindex(&mut self, key: &Key, st: &EntityState, d: &Derived) {
        let id = key.1.clone();
        match st {
            EntityState::Order(o) => { self.all_orders.insert(id.clone()); if o.is_open() { self.open_orders.insert(id.clone()); } else { self.open_orders.remove(&id); } if o.cancelled { self.cancelled_orders.insert(id.clone()); } if let Some(c) = &o.customer_id { ins(&mut self.orders_by_customer, c, &id); } for l in &o.lines { ins(&mut self.orders_by_item, &l.item_id, &id); } if o.failed_attempts.is_empty() { self.failed_attempt_orders.remove(&id); } else { self.failed_attempt_orders.insert(id.clone()); } for i in &o.invoices { ins(&mut self.invoices_by_order, &id, i); } for t in &o.transactions { ins(&mut self.transactions_by_order, &id, t); } for s in &o.shipments { ins(&mut self.shipments_by_order, &id, s); } }
            EntityState::Item(_) => { self.items.insert(id); }
            EntityState::Invoice(i) => { self.invoices.insert(id.clone()); if i.finalized && !i.cancelled && i.reported_open_minor() > 0 { self.open_invoices.insert(id.clone()); } else { self.open_invoices.remove(&id); } if let Some(o) = &i.order_id { ins(&mut self.invoices_by_order, o, &id); } for c in &i.cases { ins(&mut self.cases_by_invoice, &id, c); } }
            EntityState::Transaction(t) => { self.transactions.insert(id.clone()); if let Some(o) = &t.order_id { ins(&mut self.transactions_by_order, o, &id); } }
            EntityState::Account(_) => { self.accounts.insert(id); }
            EntityState::Payout(p) => { self.payouts.insert(id.clone()); if p.state == "sent" && !p.bank_confirmed { self.payouts_unconfirmed.insert(id.clone()); } else { self.payouts_unconfirmed.remove(&id); } if p.state == "announced" { self.payouts_announced.insert(id); } else { self.payouts_announced.remove(&id); } }
            EntityState::BankEntry(b) => { self.bank_entries.insert(id.clone()); if b.direction == "credit" && b.booking_status == "booked" && b.matched_payout.is_none() { self.bank_unmatched.insert(id); } else { self.bank_unmatched.remove(&id); } }
            EntityState::Hold(h) => { self.holds.insert(id.clone()); if h.state == "active" && h.held_minor() > 0 { self.holds_active.insert(id); } else { self.holds_active.remove(&id); } }
            EntityState::Shipment(s) => { self.shipments.insert(id.clone()); if s.state == "delivered" || s.state == "cancelled" { self.shipments_open.remove(&id); } else { self.shipments_open.insert(id.clone()); } if let Some(o) = &s.order_id { ins(&mut self.shipments_by_order, o, &id); } }
            EntityState::Return(r) => { self.returns.insert(id.clone()); if r.state == "cancelled" { self.returns_open.remove(&id); } else { self.returns_open.insert(id); } }
            EntityState::Refund(r) => { self.refunds.insert(id.clone()); if r.state == "pending" { self.refunds_pending.insert(id); } else { self.refunds_pending.remove(&id); } }
            EntityState::Dispute(x) => { self.disputes.insert(id.clone()); if x.state == "resolved" { self.disputes_open.remove(&id); } else { self.disputes_open.insert(id); } }
            EntityState::Promise(p) => { self.promises.insert(id.clone()); if p.kind == "supply" { if let Some(i) = &p.item_id { ins(&mut self.supply_promises_by_item, i, &id); } } else if let Some(o) = &p.order_id { ins(&mut self.customer_promises_by_order, o, &id); } }
            EntityState::Rule(r) => { if !r.rule_kind.is_empty() { self.rules_by_kind.insert(r.rule_kind.clone(), id); } }
            EntityState::Case(c) => { self.cases.insert(id.clone()); if let Some(i) = &c.invoice_id { ins(&mut self.cases_by_invoice, i, &id); } }
            EntityState::RefundObligation(_) => { self.refund_obligations.insert(id); }
            EntityState::Reservation(r) => { if r.state == "active" { self.reservations_active.insert(id); } else { self.reservations_active.remove(&id); } }
            EntityState::Facts(_) => { match key.0 { EntityKind::Coverage => { self.coverage.insert(id); } EntityKind::ReviewCase => { self.review_cases.insert(id); } EntityKind::Message => { if let Derived::CommunicationFact { order_id: Some(o), .. } = d { ins(&mut self.messages_by_order, o, &id); } } _ => { if matches!(d, Derived::LinkFact { .. }) { self.links.insert(format!("{}:{}", key.0.as_str(), id)); } if matches!(d, Derived::LinkConflictFact { .. }) { self.link_conflicts.insert(format!("{}:{}", key.0.as_str(), id)); } } } }
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TenantState {
    pub tenant_id: Uuid,
    pub applied_sequence: i64,
    pub reducer_version: String,
    pub schema_version: i32,
    #[serde(with = "key_map")] pub entities: HashMap<Key, EntityState>,
    #[serde(with = "key_set")] pub known: HashSet<Key>,
    pub idx: Indexes,
    pub budget_bytes: usize,
    pub resident_bytes: usize,
    #[serde(skip)] pub access: HashMap<Key, u64>,
    #[serde(skip)] pub tick: u64,
    pub evictions: u64,
    pub hydrations: u64,
    pub last_applied_recorded_at: Option<chrono::DateTime<chrono::Utc>>,
    pub last_applied_occurred_at: Option<chrono::DateTime<chrono::Utc>>,
}

impl TenantState {
    pub fn new(tenant_id: Uuid, budget_bytes: usize) -> Self {
        Self { tenant_id, applied_sequence: 0, reducer_version: bbx_domain::RULE_VERSION.into(), schema_version: bbx_domain::SCHEMA_VERSION, entities: HashMap::new(), known: HashSet::new(), idx: Indexes::default(), budget_bytes, resident_bytes: 0, access: HashMap::new(), tick: 0, evictions: 0, hydrations: 0, last_applied_recorded_at: None, last_applied_occurred_at: None }
    }
    pub fn is_resident(&self, k: &Key) -> bool { self.entities.contains_key(k) }
    pub fn is_known(&self, k: &Key) -> bool { self.known.contains(k) }
    /// Entities touched by `d` that were seen before but are not resident now (need hydration before apply).
    pub fn missing_for(&self, d: &Derived) -> Vec<Key> { d.touched().into_iter().filter(|k| self.known.contains(k) && !self.entities.contains_key(k)).collect() }
    pub fn insert_hydrated(&mut self, k: Key, st: EntityState) { self.resident_bytes += st.approx_bytes(); self.known.insert(k.clone()); self.tick += 1; self.access.insert(k.clone(), self.tick); self.entities.insert(k, st); self.hydrations += 1; self.evict_if_needed(); }
    pub fn get(&mut self, k: &Key) -> Option<&EntityState> { if self.entities.contains_key(k) { self.tick += 1; self.access.insert(k.clone(), self.tick); } self.entities.get(k) }
    pub fn peek(&self, k: &Key) -> Option<&EntityState> { self.entities.get(k) }

    /// Fold one derived entry into every touched entity and the indexes. All touched entities must be resident or new.
    pub fn apply(&mut self, entry: &JournalEntry, d: &Derived) {
        let meta = ApplyMeta { entry_id: entry.entry_id, sequence: entry.journal_sequence, occurred_at: entry.occurred_at, recorded_at: entry.recorded_at };
        for key in d.touched() {
            let before;
            let st = match self.entities.get_mut(&key) { Some(s) => { before = s.approx_bytes(); s } None => { before = 0; self.known.insert(key.clone()); self.entities.entry(key.clone()).or_insert_with(|| EntityState::new(key.0, &key.1)) } };
            st.apply(d, &meta);
            let after = st.approx_bytes();
            self.resident_bytes = self.resident_bytes + after - before.min(self.resident_bytes + after);
            self.tick += 1; self.access.insert(key.clone(), self.tick);
            let snapshot = self.entities.get(&key).cloned().expect("resident");
            self.idx.reindex(&key, &snapshot, d);
        }
        *self.idx.entry_counts.entry(entry.record_type.as_str().to_string()).or_insert(0) += 1;
        self.applied_sequence = entry.journal_sequence;
        self.last_applied_recorded_at = Some(entry.recorded_at);
        self.last_applied_occurred_at = Some(entry.occurred_at);
        self.evict_if_needed();
    }
    pub fn note_source(&mut self, entry: &JournalEntry) { *self.idx.entry_counts.entry("source".into()).or_insert(0) += 1; self.applied_sequence = entry.journal_sequence; self.last_applied_recorded_at = Some(entry.recorded_at); }

    fn evict_if_needed(&mut self) {
        if self.resident_bytes <= self.budget_bytes || self.entities.len() < 64 { return; }
        let mut by_age: Vec<(u64, Key)> = self.entities.keys().map(|k| (*self.access.get(k).unwrap_or(&0), k.clone())).collect();
        by_age.sort();
        for (_, k) in by_age { if self.resident_bytes <= self.budget_bytes * 9 / 10 { break; } if let Some(st) = self.entities.remove(&k) { self.resident_bytes = self.resident_bytes.saturating_sub(st.approx_bytes()); self.access.remove(&k); self.evictions += 1; } }
    }
    /// Explicitly evict an entity (used by cold-read tests); it stays known and hydrates on demand.
    pub fn evict(&mut self, k: &Key) -> bool { if let Some(st) = self.entities.remove(k) { self.resident_bytes = self.resident_bytes.saturating_sub(st.approx_bytes()); self.access.remove(k); self.evictions += 1; true } else { false } }
    pub fn resident_count(&self) -> usize { self.entities.len() }
}

impl bbx_domain::derive::Resolver for TenantState {
    fn reservation(&self, id: &str) -> Option<bbx_domain::derive::ReservationRef> { match self.entities.get(&(EntityKind::Reservation, id.to_string())) { Some(EntityState::Reservation(r)) => Some(bbx_domain::derive::ReservationRef { item_id: r.item_id.clone(), order_id: r.order_id.clone(), line_id: r.line_id.clone(), location_id: r.location_id.clone() }), _ => None } }
    fn hold(&self, id: &str) -> Option<bbx_domain::derive::HoldRef> { match self.entities.get(&(EntityKind::Hold, id.to_string())) { Some(EntityState::Hold(h)) => Some(bbx_domain::derive::HoldRef { account_id: h.account_id.clone(), currency: h.currency.clone(), transaction_id: h.transaction_id.clone() }), _ => None } }
    fn payout(&self, id: &str) -> Option<bbx_domain::derive::PayoutRef> { match self.entities.get(&(EntityKind::Payout, id.to_string())) { Some(EntityState::Payout(p)) => Some(bbx_domain::derive::PayoutRef { account_id: Some(p.account_id.clone()), currency: Some(p.currency.clone()), amount_minor: Some(p.amount_minor) }), _ => None } }
    fn dispute_transaction(&self, id: &str) -> Option<String> { match self.entities.get(&(EntityKind::Dispute, id.to_string())) { Some(EntityState::Dispute(d)) => d.original_transaction_id.clone(), _ => None } }
}

/// Entity keys a source observation may need resolved (hydrate these before deriving).
pub fn resolution_keys(event_type: &str, payload: &serde_json::Value) -> Vec<Key> {
    let mut v = Vec::new();
    let g = |k: &str| payload.get(k).and_then(|x| x.as_str()).map(|x| x.to_string());
    match event_type {
        "inventory.reservation_released" | "allocation.revised" => { if let Some(id) = g("reservation_id") { v.push((EntityKind::Reservation, id)); } }
        "provider.hold_released" => { if let Some(id) = g("hold_id") { v.push((EntityKind::Hold, id)); } }
        "payout.failed" | "payout.reversed" => { if let Some(id) = g("payout_id") { v.push((EntityKind::Payout, id)); } }
        "dispute.resolved" | "chargeback.reversed" => { if let Some(id) = g("dispute_id") { v.push((EntityKind::Dispute, id)); } }
        "bank.credit_booked" | "bank.match_recorded" | "bank.match_revised" => { if let Some(id) = g("payout_id") { v.push((EntityKind::Payout, id)); } }
        _ => {}
    }
    v
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot { pub format: u32, pub reducer_version: String, pub schema_version: i32, pub tenant_id: Uuid, pub applied_sequence: i64, pub written_at: chrono::DateTime<chrono::Utc>, pub state: TenantState }

impl Snapshot {
    pub fn capture(state: &TenantState, now: chrono::DateTime<chrono::Utc>) -> Snapshot { Snapshot { format: SNAPSHOT_FORMAT, reducer_version: state.reducer_version.clone(), schema_version: state.schema_version, tenant_id: state.tenant_id, applied_sequence: state.applied_sequence, written_at: now, state: state.clone() } }
    pub fn encode(&self) -> Result<(Vec<u8>, String), String> { let bytes = serde_json::to_vec(self).map_err(|e| format!("snapshot not serializable: {e}"))?; let digest = { use sha2::Digest; hex::encode(sha2::Sha256::digest(&bytes)) }; Ok((bytes, digest)) }
    /// Decode and verify; incompatible versions or digest mismatch return an error so the caller rebuilds from the journal.
    pub fn decode(bytes: &[u8], expected_sha256: &str, reducer_version: &str, schema_version: i32) -> Result<Snapshot, String> {
        let digest = { use sha2::Digest; hex::encode(sha2::Sha256::digest(bytes)) };
        if digest != expected_sha256 { return Err("snapshot digest mismatch".into()); }
        let snap: Snapshot = serde_json::from_slice(bytes).map_err(|e| format!("snapshot unreadable: {e}"))?;
        if snap.format != SNAPSHOT_FORMAT { return Err(format!("snapshot format {} incompatible", snap.format)); }
        if snap.reducer_version != reducer_version || snap.schema_version != schema_version { return Err(format!("snapshot built with reducer {} schema {}", snap.reducer_version, snap.schema_version)); }
        Ok(snap)
    }
}

#[cfg(test)]
mod golden {
    //! DOMAIN-01 oracle check in pure memory: derive + fold the Golden Scenario and compare every checkpoint.
    use super::*;
    use bbx_domain::derive::{derive, to_inputs};
    use bbx_domain::entry::{EntityRef, RecordType};
    use bbx_domain::state::EntityState;
    use serde_json::{json, Value};

    fn entry(seq: i64, et: &str, payload: Value, occurred: &str) -> JournalEntry {
        JournalEntry { entry_id: Uuid::new_v4(), tenant_id: Uuid::nil(), journal_sequence: seq, record_type: RecordType::Source, record_id: format!("src-{seq}"), event_type: et.into(), schema_version: 1, connection_id: None, provider_namespace: Some("fixture".into()), dedup_key: format!("k{seq}"), occurred_at: occurred.parse().unwrap(), recorded_at: chrono::Utc::now(), entity_refs: vec![EntityRef { kind: "order".into(), id: "#1001".into() }], payload, evidence_refs: vec![], input_entry_ids: vec![], rule_version: None, supersedes_entry_id: None, correlation_id: None, causation_id: None }
    }
    struct Harness { st: TenantState, seq: i64 }
    impl Harness {
        fn feed(&mut self, et: &str, payload: Value, occurred: &str) {
            self.seq += 1; let e = entry(self.seq, et, payload, occurred); self.st.note_source(&e);
            let derived = derive(&e, &self.st).expect("derivable");
            for (inp, d) in to_inputs(&e, &derived).into_iter().zip(derived.iter()) {
                self.seq += 1;
                let de = JournalEntry { entry_id: Uuid::new_v4(), tenant_id: Uuid::nil(), journal_sequence: self.seq, record_type: inp.record_type.clone(), record_id: inp.record_id.clone(), event_type: inp.event_type.clone(), schema_version: 1, connection_id: None, provider_namespace: None, dedup_key: inp.dedup_key.clone(), occurred_at: inp.occurred_at, recorded_at: chrono::Utc::now(), entity_refs: inp.entity_refs.clone(), payload: inp.payload.clone(), evidence_refs: vec![], input_entry_ids: inp.input_entry_ids.clone(), rule_version: inp.rule_version.clone(), supersedes_entry_id: None, correlation_id: None, causation_id: None };
                self.st.apply(&de, d);
            }
        }
        fn item(&self) -> bbx_domain::state::Availability { match self.st.peek(&(EntityKind::Item, "CUP-OLV".into())) { Some(EntityState::Item(i)) => i.availability(), _ => panic!("item") } }
        fn tx(&self) -> bbx_domain::state::TransactionState { match self.st.peek(&(EntityKind::Transaction, "TX-1001".into())) { Some(EntityState::Transaction(t)) => t.clone(), _ => panic!("tx") } }
        fn inv(&self) -> bbx_domain::state::InvoiceState { match self.st.peek(&(EntityKind::Invoice, "INV-1001".into())) { Some(EntityState::Invoice(i)) => i.clone(), _ => panic!("inv") } }
        fn acct(&self) -> bbx_domain::state::AccountState { match self.st.peek(&(EntityKind::Account, "default/EUR".into())) { Some(EntityState::Account(a)) => a.clone(), _ => bbx_domain::state::AccountState::default() } }
    }
    fn u(n: i64) -> bbx_domain::money::Qty { bbx_domain::money::Qty::from_units(n) }

    #[test]
    fn golden_order_to_cash_checkpoints() {
        let mut h = Harness { st: TenantState::new(Uuid::nil(), 64 << 20), seq: 0 };
        h.feed("inventory.snapshot", json!({"item_id":"CUP-OLV","unit":"piece","physical":"120","quality_control":"0","reserved":"0"}), "2026-10-31T09:01:00Z");
        h.feed("order.accepted", json!({"order_id":"#1001","customer_id":"C-1","currency":"EUR","gross_minor":11900,"lines":[{"line_id":"L1","item_id":"CUP-OLV","quantity":"10","unit":"piece","unit_gross_minor":1190,"line_gross_minor":11900}]}), "2026-10-31T09:02:00Z");
        h.feed("inventory.reserved", json!({"reservation_id":"R-1001","order_id":"#1001","item_id":"CUP-OLV","quantity":"10","unit":"piece"}), "2026-10-31T09:03:00Z");
        h.feed("invoice.issued", json!({"document_id":"DOC-1","invoice_id":"INV-1001","order_id":"#1001","currency":"EUR","gross_minor":11900,"due_date":"2026-11-07"}), "2026-10-31T09:04:00Z");
        h.feed("payment.authorized", json!({"transaction_id":"TX-1001","order_id":"#1001","amount_minor":11900,"currency":"EUR"}), "2026-10-31T09:05:00Z");
        // after G05
        let a = h.item(); assert_eq!(a.physical, Some(u(120))); assert_eq!(a.reserved, u(10)); assert_eq!(a.available, Some(u(110)));
        assert_eq!(h.tx().authorized_minor, 11900); assert_eq!(h.tx().captured_minor, 0); assert_eq!(h.inv().reported_open_minor(), 11900); assert_eq!(h.acct().balance_minor(), 0);
        h.feed("payment.captured", json!({"transaction_id":"TX-1001","order_id":"#1001","amount_minor":11900,"currency":"EUR"}), "2026-10-31T09:06:00Z");
        h.feed("payment.fee_booked", json!({"transaction_id":"TX-1001","fee_minor":350,"currency":"EUR"}), "2026-10-31T09:07:00Z");
        h.feed("invoice.payment_marked", json!({"invoice_id":"INV-1001","transaction_id":"TX-1001","paid_minor":11900,"currency":"EUR","is_new_cash_movement":false}), "2026-10-31T09:08:00Z");
        // after G08
        assert_eq!(h.tx().captured_minor, 11900); assert_eq!(h.acct().fees_minor, 350); assert_eq!(h.acct().balance_minor(), 11550); assert_eq!(h.inv().reported_open_minor(), 0); assert_eq!(h.acct().bank_confirmed_minor, 0);
        h.feed("shipment.dispatched", json!({"shipment_id":"SHIP-1001","order_id":"#1001","lines":[{"line_id":"L1","item_id":"CUP-OLV","quantity":"10","unit":"piece"}],"reservation_id":"R-1001"}), "2026-10-31T09:09:00Z");
        h.feed("shipment.delivered", json!({"shipment_id":"SHIP-1001","carrier_status":"delivered"}), "2026-10-31T09:10:00Z");
        let a = h.item(); assert_eq!(a.physical, Some(u(110))); assert_eq!(a.reserved, u(0)); assert_eq!(a.available, Some(u(110))); assert_eq!(h.acct().balance_minor(), 11550);
        match h.st.peek(&(EntityKind::Shipment, "SHIP-1001".into())) { Some(EntityState::Shipment(s)) => assert_eq!(s.state, "delivered"), _ => panic!() }
        h.feed("return.approved", json!({"return_id":"RET-1001","order_id":"#1001","lines":[{"item_id":"CUP-OLV","quantity":"2","unit":"piece"}],"expected_credit_minor":2380,"currency":"EUR"}), "2026-10-31T09:11:00Z");
        h.feed("return.received", json!({"receipt_id":"RC-1","return_id":"RET-1001","item_id":"CUP-OLV","quantity":"2","unit":"piece","disposition":"quarantine"}), "2026-10-31T09:12:00Z");
        let a = h.item(); assert_eq!(a.physical, Some(u(112))); assert_eq!(a.quarantined, u(2)); assert_eq!(a.available, Some(u(110)));
        h.feed("return.restocked", json!({"receipt_id":"RC-1","return_id":"RET-1001","item_id":"CUP-OLV","quantity":"2","unit":"piece"}), "2026-10-31T09:13:00Z");
        let a = h.item(); assert_eq!(a.physical, Some(u(112))); assert_eq!(a.quarantined, u(0)); assert_eq!(a.available, Some(u(112)));
        h.feed("invoice.credit_issued", json!({"document_id":"DOC-2","invoice_id":"INV-1001","credit_id":"CN-1001","currency":"EUR","credit_minor":2380,"cash_refund_confirmed":false}), "2026-10-31T09:14:00Z");
        let i = h.inv(); assert_eq!(i.gross_minor, 11900); assert_eq!(i.credits_minor(), 2380); assert_eq!(i.net_minor(), 9520); assert_eq!(i.reported_open_minor(), 0); assert_eq!(i.refund_payable_from_credits(), 2380); assert_eq!(h.tx().refunded_minor(), 0); assert_eq!(h.acct().balance_minor(), 11550);
        h.feed("refund.pending", json!({"refund_id":"RF-1001","original_transaction_id":"TX-1001","amount_minor":2380,"currency":"EUR"}), "2026-10-31T09:15:00Z");
        assert_eq!(h.acct().balance_minor(), 11550); assert_eq!(h.acct().held_minor(), 2380); assert_eq!(h.acct().available_minor(), 9170); assert_eq!(h.tx().refunded_minor(), 0); assert_eq!(h.tx().pending_refund_minor(), 2380);
        h.feed("refund.completed", json!({"refund_id":"RF-1001","original_transaction_id":"TX-1001","amount_minor":2380,"currency":"EUR"}), "2026-10-31T09:16:00Z");
        assert_eq!(h.acct().balance_minor(), 9170); assert_eq!(h.acct().held_minor(), 0); assert_eq!(h.acct().available_minor(), 9170); assert_eq!(h.tx().refunded_minor(), 2380);
        assert_eq!(h.tx().captured_minor - h.tx().refunded_minor(), 9520, "customer net paid");
        assert_eq!(h.inv().refund_payable_from_credits() - h.tx().refunded_minor(), 0, "refund payable settled");
        h.feed("payout.announced", json!({"payout_id":"OUT-1001","amount_minor":9170,"currency":"EUR"}), "2026-10-31T09:17:00Z");
        assert_eq!(h.acct().balance_minor(), 9170); assert_eq!(h.acct().announced_minor(), 9170); assert_eq!(h.acct().in_transit_minor(), 0);
        h.feed("payout.sent", json!({"payout_id":"OUT-1001","amount_minor":9170,"currency":"EUR"}), "2026-10-31T09:18:00Z");
        assert_eq!(h.acct().balance_minor(), 0); assert_eq!(h.acct().announced_minor(), 0); assert_eq!(h.acct().in_transit_minor(), 9170); assert_eq!(h.acct().bank_confirmed_minor, 0);
        h.feed("bank.credit_booked", json!({"entry_id":"BANK-1001","payout_id":"OUT-1001","amount_minor":9170,"currency":"EUR","status":"booked"}).as_object().map(|o| { let mut o = o.clone(); o.remove("status"); Value::Object(o) }).unwrap(), "2026-10-31T09:19:00Z");
        let a = h.item(); assert_eq!(a.physical, Some(u(112))); assert_eq!(a.available, Some(u(112)));
        let acc = h.acct(); assert_eq!(acc.captured_minor, 11900); assert_eq!(acc.fees_minor, 350); assert_eq!(acc.refunded_minor, 2380); assert_eq!(acc.balance_minor(), 0); assert_eq!(acc.in_transit_minor(), 0); assert_eq!(acc.bank_confirmed_minor, 9170);
        // conservation: captured - fees - refunded = balance + in_transit + bank_confirmed
        assert_eq!(acc.captured_minor - acc.fees_minor - acc.refunded_minor, acc.balance_minor() + acc.in_transit_minor() + acc.bank_confirmed_minor);
        assert!(h.st.idx.open_orders.is_empty(), "order fully dispatched");
        assert!(h.st.idx.payouts_unconfirmed.is_empty());
        // populated snapshot must round-trip with identical state
        let snap = Snapshot::capture(&h.st, chrono::Utc::now()); let (bytes, digest) = snap.encode().expect("populated snapshot serializes");
        let back = Snapshot::decode(&bytes, &digest, "r1", 1).unwrap();
        assert_eq!(back.state.entities.len(), h.st.entities.len()); assert_eq!(back.state.applied_sequence, h.st.applied_sequence);
        match back.state.peek(&(EntityKind::Account, "default/EUR".into())) { Some(EntityState::Account(a)) => assert_eq!(a.bank_confirmed_minor, 9170), _ => panic!("account missing after roundtrip") }
    }

    #[test]
    fn snapshot_roundtrip_rejects_tampering() {
        let st = TenantState::new(Uuid::nil(), 1024);
        let snap = Snapshot::capture(&st, chrono::Utc::now());
        let (bytes, digest) = snap.encode().unwrap();
        assert!(Snapshot::decode(&bytes, &digest, "r1", 1).is_ok());
        assert!(Snapshot::decode(&bytes, &digest, "r2", 1).is_err());
        let mut bad = bytes.clone(); bad[10] ^= 1; assert!(Snapshot::decode(&bad, &digest, "r1", 1).is_err());
    }
}

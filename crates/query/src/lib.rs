//! The 24 question intents and entity state views over the bounded projections. Shared by API and MCP through the engine.
//! Every answer carries status, calculation steps, evidence entry ids, missing inputs and coverage. No wall clock is read here.
use bbx_domain::derived::EntityKind;
use bbx_domain::money::Qty;
use bbx_domain::state::*;
use bbx_projections::{Key, TenantState};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use uuid::Uuid;

pub const RULE_VERSION: &str = bbx_domain::RULE_VERSION;

#[derive(Debug)]
pub struct NeedHydration(pub Vec<Key>);

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct CoverageItem { pub capability: String, pub status: String, pub complete_through: Option<String>, pub note: Option<String> }

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Answer {
    pub status: String,
    pub result: Value,
    pub calculation: Vec<String>,
    pub evidence_entry_ids: Vec<Uuid>,
    pub missing_inputs: Vec<String>,
    pub conflicts: Vec<Value>,
    pub coverage: Vec<CoverageItem>,
    pub next_cursor: Option<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Deserialize)]
pub struct QueryInput { pub intent: String, #[serde(default)] pub parameters: Value, #[serde(default = "d_page")] pub page_size: usize, #[serde(default)] pub cursor: Option<String>, #[serde(default)] pub now: Option<String> }
fn d_page() -> usize { 100 }

struct Ctx<'a> { st: &'a mut TenantState, params: Value, page: usize, cursor: Option<String>, now: chrono::DateTime<chrono::Utc>, evidence: Vec<Uuid>, calc: Vec<String> }

impl<'a> Ctx<'a> {
    fn p_str(&self, k: &str) -> Option<String> { self.params.get(k).and_then(|v| v.as_str()).map(|s| s.to_string()) }
    fn ensure(&mut self, keys: &[Key]) -> Result<(), NeedHydration> { let missing: Vec<Key> = keys.iter().filter(|k| self.st.is_known(k) && !self.st.is_resident(k)).cloned().collect(); if missing.is_empty() { Ok(()) } else { Err(NeedHydration(missing)) } }
    fn get(&mut self, kind: EntityKind, id: &str) -> Option<EntityState> { let k = (kind, id.to_string()); self.st.get(&k).cloned() }
    fn cite(&mut self, s: &EntityState) { for e in &s.provenance().entry_ids { if !self.evidence.contains(e) && self.evidence.len() < 500 { self.evidence.push(*e); } } }
    fn page_ids(&self, ids: &BTreeSet<String>) -> (Vec<String>, Option<String>, bool) {
        let mut it: Vec<&String> = ids.iter().collect();
        if let Some(c) = &self.cursor { it.retain(|i| i.as_str() > c.as_str()); }
        let truncated = it.len() > self.page; let page: Vec<String> = it.into_iter().take(self.page).cloned().collect();
        let next = if truncated { page.last().cloned() } else { None };
        (page, next, truncated)
    }
    fn coverage(&self, datasets: &[&str]) -> Vec<CoverageItem> {
        datasets.iter().map(|d| {
            let key = (EntityKind::Coverage, d.to_string());
            match self.st.peek(&key) {
                Some(EntityState::Facts(f)) => {
                    let mut status = "unavailable"; let mut through = None; let mut note = None;
                    for fact in &f.facts { if fact.get("derived").and_then(|x| x.as_str()) == Some("coverage_fact") {
                        let complete = fact.get("backfill_complete").and_then(|x| x.as_bool()).unwrap_or(false);
                        status = if complete { "complete_for_declared_scope" } else { "partial" }; through = fact.get("complete_through").and_then(|x| x.as_str()).map(|s| s.to_string());
                        let missing = fact.get("missing_fields").and_then(|x| x.as_array()).map(|a| a.len()).unwrap_or(0); if missing > 0 && status != "unavailable" { status = "partial"; note = Some(format!("{missing} missing fields")); }
                    } else if fact.get("derived").and_then(|x| x.as_str()) == Some("coverage_gap_fact") { status = "partial"; note = Some(fact.get("reason").and_then(|x| x.as_str()).unwrap_or("gap").to_string()); } }
                    CoverageItem { capability: d.to_string(), status: status.into(), complete_through: through, note }
                }
                _ => CoverageItem { capability: d.to_string(), status: "unavailable".into(), complete_through: None, note: Some("no coverage observation for this capability".into()) },
            }
        }).collect()
    }
    fn rule(&mut self, kind: &str) -> Option<RuleState> { let id = self.st.idx.rules_by_kind.get(kind).cloned()?; match self.get(EntityKind::Rule, &id) { Some(EntityState::Rule(r)) => Some(r), _ => None } }
}

fn qs(q: Qty) -> String { q.to_string() }
fn missing(datasets: Vec<CoverageItem>, missing_inputs: Vec<String>, calc: Vec<String>, result: Value) -> Answer { Answer { status: "insufficient_data".into(), result, calculation: calc, evidence_entry_ids: vec![], missing_inputs, conflicts: vec![], coverage: datasets, next_cursor: None, truncated: false } }
fn unavailable(cov: &[CoverageItem]) -> Vec<String> { cov.iter().filter(|c| c.status == "unavailable").map(|c| c.capability.clone()).collect() }

/// Execute one intent. Returns NeedHydration when evicted entities must be loaded first; the engine hydrates and retries.
pub fn run(st: &mut TenantState, input: &QueryInput) -> Result<Answer, NeedHydration> {
    let now = input.now.as_deref().and_then(|s| s.parse::<chrono::DateTime<chrono::Utc>>().ok()).unwrap_or_else(|| st.last_applied_recorded_at.unwrap_or(chrono::DateTime::<chrono::Utc>::MIN_UTC));
    let mut cx = Ctx { st, params: input.parameters.clone(), page: input.page_size.clamp(1, 500), cursor: input.cursor.clone(), now, evidence: vec![], calc: vec![] };
    let mut a = match input.intent.as_str() {
        "inventory.available_to_sell" => order_01(&mut cx)?, "orders.fulfillable" => order_02(&mut cx)?, "orders.reservation_variance" => order_03(&mut cx)?, "orders.inbound_delay_impact" => order_04(&mut cx)?,
        "shipments.attention" => delivery_01(&mut cx)?, "shipments.promise_risk" => delivery_02(&mut cx)?, "orders.partial_delivery_gaps" => delivery_03(&mut cx)?, "customer.delivery_reply" => delivery_04(&mut cx)?,
        "invoices.outstanding" => invoice_01(&mut cx)?, "orders.missing_invoice" => invoice_02(&mut cx)?, "invoices.order_amount_variance" => invoice_03(&mut cx)?, "invoices.dispatch_evidence" => invoice_04(&mut cx)?,
        "orders.payment_state" => collection_01(&mut cx)?, "payments.recovered_attempts" => collection_02(&mut cx)?, "invoices.payment_variance" => collection_03(&mut cx)?, "receivables.review_queue" => collection_04(&mut cx)?,
        "providers.money_positions" => settlement_01(&mut cx)?, "payouts.gross_to_net" => settlement_02(&mut cx)?, "payouts.missing_bank_confirmation" => settlement_03(&mut cx)?, "providers.holds_and_releases" => settlement_04(&mut cx)?,
        "returns.lifecycle" => reversal_01(&mut cx)?, "credits.refund_gaps" => reversal_02(&mut cx)?, "cancellations.outstanding_steps" => reversal_03(&mut cx)?, "refunds.chargeback_overlap" => reversal_04(&mut cx)?,
        other => Answer { status: "unsupported".into(), result: json!({"error": format!("unknown intent {other}")}), calculation: vec![], evidence_entry_ids: vec![], missing_inputs: vec![], conflicts: vec![], coverage: vec![], next_cursor: None, truncated: false },
    };
    if a.evidence_entry_ids.is_empty() { a.evidence_entry_ids = cx.evidence.clone(); }
    if a.calculation.is_empty() { a.calculation = cx.calc.clone(); }
    Ok(a)
}

// ---------------------------------------------------------------- 01 Order & availability
fn order_01(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["stock", "coverage", "identity"]);
    let item_id = match cx.p_str("item_id") { Some(i) => i, None => return Ok(missing(cov, vec!["parameters.item_id".into()], vec!["An item id is required.".into()], Value::Null)) };
    let requested = cx.p_str("requested_quantity").and_then(|q| Qty::parse(&q).ok());
    cx.ensure(&[(EntityKind::Item, item_id.clone())])?;
    let item = match cx.get(EntityKind::Item, &item_id) { Some(EntityState::Item(i)) => i, _ => return Ok(missing(cov, vec!["stock.basis".into()], vec![format!("No inventory observation recorded for item {item_id}.")], json!({"item_id": item_id, "available": null}))) };
    let av = item.availability();
    if !av.basis_known || av.available.is_none() { return Ok(missing(cov, vec!["stock.basis".into()], vec!["No authoritative stock basis (snapshot) observed; movements alone cannot establish a level.".into()], json!({"item_id": item_id, "available": null}))); }
    let available = av.available.unwrap();
    let mut calc = vec![];
    if av.basis == "provider_available" { calc.push(format!("Provider-reported available quantity {} used as basis; committed/reserved are not subtracted again.", qs(available))); }
    else { calc.push(format!("available = physical {} - quarantined {} - damaged {} - safety {} - quality_control {} - active reservations {} = {}", qs(av.physical.unwrap_or(Qty::ZERO)), qs(av.quarantined), qs(av.damaged), qs(av.safety_stock), qs(av.quality_control), qs(av.reserved), qs(available))); }
    let shortfall = requested.map(|r| r.saturating_sub_floor0(available));
    if let Some(r) = requested { calc.push(format!("requested {} -> shortfall {}", qs(r), qs(shortfall.unwrap()))); }
    let incoming: Vec<Value> = item.supply_promises.iter().filter_map(|p| match cx.st.peek(&(EntityKind::Promise, p.clone())) { Some(EntityState::Promise(pr)) => Some(json!({"promise_id": pr.promise_id, "quantity": pr.quantity.map(qs), "promised_at": pr.promised_at, "counted_as_stock": false})), _ => None }).collect();
    calc.push("Incoming supply promises are listed separately and never counted as stock.".into());
    let st = EntityState::Item(item.clone()); cx.cite(&st);
    Ok(Answer { status: "complete".into(), result: json!({"item_id": item_id, "unit": av.unit, "basis": av.basis, "physical": av.physical.map(qs), "quarantined": qs(av.quarantined), "damaged": qs(av.damaged), "safety_stock": qs(av.safety_stock), "quality_control": qs(av.quality_control), "reserved": qs(av.reserved), "available": qs(available), "requested": requested.map(qs), "shortfall": shortfall.map(qs), "can_promise": requested.map(|r| r <= available), "incoming": incoming, "incoming_counted_as_stock": false, "active_reservations": item.active_reservations.iter().map(|(k, v)| json!({"reservation_id": k, "quantity": qs(*v)})).collect::<Vec<_>>()}), calculation: calc, evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: None, truncated: false })
}

fn order_02(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "stock", "allocations", "policy", "coverage", "identity"]);
    let rule = cx.rule("allocation_priority");
    let method = match rule.as_ref().and_then(|r| r.priority_method.clone()) { Some(m) => m, None => return Ok(missing(cov, vec!["policy.priority_method".into()], vec!["No allocation priority rule recorded; a joint plan cannot be built without the merchant's declared method.".into()], json!({"joint_plan": null}))) };
    if let Some(r) = &rule { cx.cite(&EntityState::Rule(r.clone())); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.open_orders.clone());
    let mut keys: Vec<Key> = ids.iter().map(|o| (EntityKind::Order, o.clone())).collect();
    let mut orders: Vec<OrderState> = vec![];
    cx.ensure(&keys)?;
    for id in &ids { if let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) { orders.push(o); } }
    let items: BTreeSet<String> = orders.iter().flat_map(|o| o.lines.iter().map(|l| l.item_id.clone())).collect();
    keys = items.iter().map(|i| (EntityKind::Item, i.clone())).collect(); cx.ensure(&keys)?;
    let mut free: BTreeMap<String, Qty> = BTreeMap::new(); let mut unknown_items: Vec<String> = vec![];
    for i in &items { match cx.get(EntityKind::Item, i) { Some(EntityState::Item(it)) => { let av = it.availability(); match av.available { Some(a) => { free.insert(i.clone(), a); cx.cite(&EntityState::Item(it)); } None => unknown_items.push(i.clone()) } } _ => unknown_items.push(i.clone()) } }
    // priority order: declared method; supported: oldest_first (accepted_at), order_id ascending
    match method.as_str() { "oldest_first" | "fifo" => orders.sort_by(|a, b| a.accepted_at.cmp(&b.accepted_at).then(a.order_id.cmp(&b.order_id))), "order_id" => orders.sort_by(|a, b| a.order_id.cmp(&b.order_id)), _ => return Ok(Answer { status: "unsupported".into(), result: json!({"priority_method": method}), calculation: vec![format!("Priority method {method} is not supported by rule version {RULE_VERSION}.")], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: None, truncated: false }) }
    let mut plan: Vec<Value> = vec![]; let mut used: BTreeMap<String, Qty> = BTreeMap::new();
    for o in &orders {
        let mut full = true; let mut partial = false; let mut lines_out = vec![]; let mut blocked_reason: Option<String> = None;
        for l in &o.lines { let need = l.remaining_obligation(); if need.is_zero() { continue; }
            // the order's own active reservation is available to itself
            let own = l.reserved.min(need);
            let open_need = need.saturating_sub_floor0(own);
            let planned = match free.get(&l.item_id) { Some(f) => { let left = f.saturating_sub_floor0(*used.get(&l.item_id).unwrap_or(&Qty::ZERO)); let take = open_need.min(left); *used.entry(l.item_id.clone()).or_insert(Qty::ZERO) = used.get(&l.item_id).copied().unwrap_or(Qty::ZERO).checked_add(take).unwrap_or(take); take } None => { blocked_reason = Some(format!("stock basis unknown for {}", l.item_id)); Qty::ZERO } };
            let covered = own.checked_add(planned).unwrap_or(own);
            if covered < need { full = false; if !covered.is_zero() || !own.is_zero() { partial = true; } }
            lines_out.push(json!({"line_id": l.line_id, "item_id": l.item_id, "remaining": qs(need), "own_reservation": qs(own), "planned_from_free": qs(planned), "covered": qs(covered)}));
        }
        let class = if blocked_reason.is_some() { "blocked" } else if full { "fully_fulfillable" } else if partial { "partial" } else { "blocked" };
        plan.push(json!({"order_id": o.order_id, "classification": class, "reason": blocked_reason, "lines": lines_out}));
        cx.cite(&EntityState::Order(o.clone()));
    }
    let status = if unknown_items.is_empty() { "complete" } else { "partial" };
    Ok(Answer { status: status.into(), result: json!({"priority_method": method, "plan": plan, "units_planned": used.iter().map(|(k, v)| json!({"item_id": k, "quantity": qs(*v)})).collect::<Vec<_>>(), "plan_is_tentative": true, "stock_not_mutated": true}), calculation: vec![format!("Open orders ordered by {method}; free stock allocated once per item across the page; existing own reservations count for their order."), "This is a non-mutating plan at a fixed snapshot, not a committed reservation.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: unknown_items.iter().map(|i| format!("stock.basis[{i}]")).collect(), conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn order_03(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "allocations", "fulfillments", "coverage", "identity"]);
    if unavailable(&cov).contains(&"allocations".to_string()) { return Ok(missing(cov, vec!["allocations.order_line_ownership".into()], vec!["No reservation/allocation capability covers this workspace; line-level ownership cannot be inferred from aggregate stock.".into()], json!({"variance": null}))); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.open_orders.clone());
    cx.ensure(&ids.iter().map(|o| (EntityKind::Order, o.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![];
    for id in &ids { if let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) { for l in &o.lines { let rem = l.remaining_obligation(); let diff = Qty(rem.0 - l.reserved.0); if diff.0 != 0 { rows.push(json!({"order_id": o.order_id, "line_id": l.line_id, "item_id": l.item_id, "ordered": qs(l.quantity), "cancelled": qs(l.cancelled), "dispatched": qs(l.dispatched), "remaining_obligation": qs(rem), "active_reserved": qs(l.reserved), "under_reserved": if diff.0 > 0 { qs(diff) } else { "0".into() }, "over_reserved": if diff.0 < 0 { qs(Qty(-diff.0)) } else { "0".into() }})); } } cx.cite(&EntityState::Order(o)); } }
    Ok(Answer { status: "complete".into(), result: json!({"variances": rows}), calculation: vec!["remaining_obligation = ordered - cancelled - dispatched; variance = remaining_obligation - active reserved at the same cutoff (cancelled amounts subtracted once).".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn order_04(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "supply", "allocations", "promises", "coverage", "identity"]);
    if unavailable(&cov).contains(&"supply".to_string()) { return Ok(missing(cov, vec!["supply".into()], vec!["No supplier commitment feed is connected; inbound delays cannot be evaluated.".into()], json!({"confirmed_affected_orders": null}))); }
    let promise_ids: Vec<String> = match cx.p_str("promise_id") { Some(p) => vec![p], None => cx.st.idx.promises.iter().cloned().collect() };
    cx.ensure(&promise_ids.iter().map(|p| (EntityKind::Promise, p.clone())).collect::<Vec<_>>())?;
    let mut affected = vec![]; let mut exposure = vec![]; let mut gaps = vec![];
    for pid in &promise_ids {
        let p = match cx.get(EntityKind::Promise, pid) { Some(EntityState::Promise(p)) if p.kind == "supply" && p.history.len() > 1 => p, _ => continue };
        let delayed = p.history.iter().map(|h| h.1.clone()).min().map(|first| first < p.promised_at).unwrap_or(false);
        if !delayed { continue; }
        cx.cite(&EntityState::Promise(p.clone()));
        if p.allocation_links.is_empty() { gaps.push(json!({"promise_id": pid, "item_id": p.item_id, "reason": "no supply-to-order allocation recorded; dependency unproven"}));
            if let Some(item) = &p.item_id { for o in cx.st.idx.orders_by_item.get(item).cloned().unwrap_or_default() { exposure.push(json!({"order_id": o, "item_id": item, "status": "potential_exposure_unproven"})); } }
            continue; }
        for link in &p.allocation_links {
            cx.ensure(&[(EntityKind::Reservation, link.clone())])?;
            let order_id = match cx.get(EntityKind::Reservation, link) { Some(EntityState::Reservation(r)) => r.order_id.clone(), _ => None };
            let Some(order_id) = order_id else { continue };
            let due: Option<String> = cx.st.idx.customer_promises_by_order.get(&order_id).cloned().unwrap_or_default().into_iter().filter_map(|cp| match cx.st.peek(&(EntityKind::Promise, cp)) { Some(EntityState::Promise(c)) => Some(c.promised_at.clone()), _ => None }).min();
            let risk = match &due { Some(d) if &p.promised_at > d => "incoming_after_customer_deadline", Some(_) => "within_customer_deadline", None => "customer_deadline_unknown" };
            affected.push(json!({"order_id": order_id, "promise_id": pid, "item_id": p.item_id, "revised_receipt": p.promised_at, "customer_due": due, "risk": risk}));
        }
    }
    let status = if gaps.is_empty() { "complete" } else { "partial" };
    Ok(Answer { status: status.into(), result: json!({"affected": affected, "potential_exposure": exposure, "dependency_gaps": gaps}), calculation: vec!["A promise is delayed when its current promised_at is later than its first recorded revision; impact follows explicit allocation links to orders and compares with the earliest customer promise.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: gaps.iter().map(|g| format!("allocations.supply_to_order[{}]", g["promise_id"].as_str().unwrap_or(""))).collect(), conflicts: vec![], coverage: cov, next_cursor: None, truncated: false })
}

// ---------------------------------------------------------------- 02 Delivery
fn delivery_01(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["fulfillments", "tracking", "policy", "coverage", "identity"]);
    if unavailable(&cov).contains(&"tracking".to_string()) && unavailable(&cov).contains(&"fulfillments".to_string()) { return Ok(missing(cov, vec!["tracking.coverage".into()], vec!["No shipment or carrier capability is covered.".into()], json!({"delivery_status": "unknown"}))); }
    let policy = cx.rule("attention_policy"); let stale_hours: i64 = policy.as_ref().and_then(|r| r.tolerance.as_ref()).and_then(|t| t.get("stale_scan_hours")).and_then(|v| v.as_i64()).unwrap_or(48);
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.shipments_open.clone());
    cx.ensure(&ids.iter().map(|s| (EntityKind::Shipment, s.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![]; let mut attention = vec![];
    for id in &ids { if let Some(EntityState::Shipment(s)) = cx.get(EntityKind::Shipment, id) {
        let (code, time, age) = match &s.last_scan { Some((c, t, _)) => { let age = t.parse::<chrono::DateTime<chrono::Utc>>().ok().map(|t| (cx.now - t).num_seconds()); (Some(c.clone()), Some(t.clone()), age) } None => (None, None, None) };
        let exception = code.as_deref().map(|c| c.to_lowercase().contains("exception") || c.to_lowercase().contains("failed") || c.to_lowercase().contains("return")).unwrap_or(false);
        let stale = age.map(|a| a > stale_hours * 3600).unwrap_or(false) && s.state != "delivered";
        let needs = exception || (s.state == "label_created" && s.handover_at.is_none() && s.scan_count == 0);
        if needs { attention.push(id.clone()); }
        rows.push(json!({"shipment_id": id, "order_id": s.order_id, "state": s.state, "carrier": s.carrier, "tracking_number": s.tracking_number, "latest_scan": code, "latest_scan_time": time, "latest_scan_age_seconds": age, "forecast": s.forecast.clone().flatten(), "forecast_is_estimate": true, "exception": exception, "stale_scan": stale, "needs_attention": needs}));
        cx.cite(&EntityState::Shipment(s)); } }
    if let Some(r) = policy { cx.cite(&EntityState::Rule(r)); }
    Ok(Answer { status: if unavailable(&cov).contains(&"tracking".to_string()) { "partial".into() } else { "complete".into() }, result: json!({"shipments": rows, "attention": attention, "stale_threshold_hours": stale_hours}), calculation: vec!["Latest scan by effective time with its age; exceptions and never-scanned labels need attention; a forecast is an estimate and a stale scan is not a failure.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: if unavailable(&cov).contains(&"tracking".to_string()) { vec!["tracking".into()] } else { vec![] }, conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn delivery_02(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "promises", "fulfillments", "tracking", "policy", "coverage", "identity"]);
    if unavailable(&cov).contains(&"promises".to_string()) { return Ok(missing(cov, vec!["promises.promised_at".into()], vec!["No customer delivery commitments are recorded; carrier estimates are not promises.".into()], json!({"promise_breached": null}))); }
    let order_ids: Vec<String> = cx.st.idx.customer_promises_by_order.keys().cloned().collect();
    let (ids, next, truncated) = cx.page_ids(&order_ids.iter().cloned().collect());
    let mut keys: Vec<Key> = ids.iter().map(|o| (EntityKind::Order, o.clone())).collect();
    for o in &ids { for p in cx.st.idx.customer_promises_by_order.get(o).cloned().unwrap_or_default() { keys.push((EntityKind::Promise, p)); } for s in cx.st.idx.shipments_by_order.get(o).cloned().unwrap_or_default() { keys.push((EntityKind::Shipment, s)); } }
    cx.ensure(&keys)?;
    let mut rows = vec![];
    for o in &ids {
        let promises: Vec<PromiseState> = cx.st.idx.customer_promises_by_order.get(o).cloned().unwrap_or_default().into_iter().filter_map(|p| match cx.get(EntityKind::Promise, &p) { Some(EntityState::Promise(pr)) => Some(pr), _ => None }).collect();
        let Some(current) = promises.iter().max_by_key(|p| (p.revision, p.promised_at.clone())) else { continue };
        let shipments: Vec<ShipmentState> = cx.st.idx.shipments_by_order.get(o).cloned().unwrap_or_default().into_iter().filter_map(|s| match cx.get(EntityKind::Shipment, &s) { Some(EntityState::Shipment(sh)) => Some(sh), _ => None }).collect();
        let delivered = shipments.iter().any(|s| s.state == "delivered");
        let last_state = shipments.iter().map(|s| s.state.clone()).max().unwrap_or_else(|| "no_shipment".into());
        let due = current.promised_at.parse::<chrono::DateTime<chrono::Utc>>().ok();
        let overdue = !delivered && due.map(|d| cx.now > d).unwrap_or(false);
        let at_risk = !delivered && !overdue && due.map(|d| (d - cx.now).num_hours() < 24).unwrap_or(false);
        rows.push(json!({"order_id": o, "promise_id": current.promise_id, "promise_kind": current.promise_kind, "promised_at": current.promised_at, "timezone": current.timezone, "revision": current.revision, "last_state": last_state, "delivered": delivered, "overdue": overdue, "at_risk": at_risk, "arrival_date": if delivered { shipments.iter().filter_map(|s| s.delivered_at.clone()).max() } else { None }, "arrival_known": delivered}));
        for p in &promises { cx.cite(&EntityState::Promise(p.clone())); } for s in &shipments { cx.cite(&EntityState::Shipment(s.clone())); }
    }
    Ok(Answer { status: if unavailable(&cov).contains(&"tracking".to_string()) { "partial".into() } else { "complete".into() }, result: json!({"commitments": rows, "now": cx.now.to_rfc3339()}), calculation: vec!["Current (highest revision) customer promise compared with confirmed delivered status at `now`; unknown arrival remains unknown.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: unavailable(&cov).into_iter().filter(|c| c == "tracking").collect(), conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn delivery_03(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "fulfillments", "tracking", "coverage", "identity"]);
    if unavailable(&cov).contains(&"fulfillments".to_string()) { return Ok(missing(cov, vec!["fulfillments.line_quantity_links".into()], vec!["No fulfillment capability with line quantities is covered.".into()], json!({"remaining_quantities": null}))); }
    let set: BTreeSet<String> = match cx.p_str("order_id") { Some(o) => BTreeSet::from([o]), None => cx.st.idx.all_orders.clone() };
    let (ids, next, truncated) = cx.page_ids(&set);
    cx.ensure(&ids.iter().map(|o| (EntityKind::Order, o.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![];
    for id in &ids { if let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) { if o.lines.iter().all(|l| l.dispatched.is_zero()) { continue; } let lines: Vec<Value> = o.lines.iter().filter_map(|l| { let live = l.quantity.saturating_sub_floor0(l.cancelled); let to_dispatch = live.saturating_sub_floor0(l.dispatched); let to_deliver = live.saturating_sub_floor0(l.delivered); if to_dispatch.is_zero() && to_deliver.is_zero() { None } else { Some(json!({"line_id": l.line_id, "item_id": l.item_id, "ordered": qs(l.quantity), "cancelled": qs(l.cancelled), "handed_over": qs(l.dispatched), "delivered": qs(l.delivered), "remaining_to_dispatch": qs(to_dispatch), "remaining_to_deliver": qs(to_deliver)})) } }).collect(); if !lines.is_empty() { rows.push(json!({"order_id": o.order_id, "shipments": o.shipments, "lines": lines})); } cx.cite(&EntityState::Order(o)); } }
    Ok(Answer { status: "complete".into(), result: json!({"partial_deliveries": rows}), calculation: vec!["remaining_to_dispatch = ordered - cancelled - handed over; remaining_to_deliver = ordered - cancelled - delivered; labels count as neither.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn delivery_04(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "fulfillments", "tracking", "communications", "coverage", "identity"]);
    let Some(order_id) = cx.p_str("order_id") else { return Ok(missing(cov, vec!["parameters.order_id".into()], vec!["An order id is required.".into()], Value::Null)) };
    let mut keys = vec![(EntityKind::Order, order_id.clone())]; for s in cx.st.idx.shipments_by_order.get(&order_id).cloned().unwrap_or_default() { keys.push((EntityKind::Shipment, s)); } for m in cx.st.idx.messages_by_order.get(&order_id).cloned().unwrap_or_default() { keys.push((EntityKind::Message, m)); }
    cx.ensure(&keys)?;
    let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, &order_id) else { return Ok(missing(cov, vec!["orders".into()], vec![format!("Order {order_id} is not recorded.")], Value::Null)) };
    if let Some(c) = cx.p_str("customer_id") { if o.customer_id.as_deref() != Some(c.as_str()) { return Ok(Answer { status: "denied".into(), result: json!({"reason": "order does not belong to the given customer"}), calculation: vec![], evidence_entry_ids: vec![], missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: None, truncated: false }); } }
    let shipments: Vec<ShipmentState> = o.shipments.iter().filter_map(|s| match cx.get(EntityKind::Shipment, s) { Some(EntityState::Shipment(x)) => Some(x), _ => None }).collect();
    let mut facts = vec![]; for s in &shipments { facts.push(json!({"shipment_id": s.shipment_id, "state": s.state, "latest_scan": s.last_scan.as_ref().map(|x| x.0.clone()), "latest_scan_time": s.last_scan.as_ref().map(|x| x.1.clone()), "forecast": s.forecast.clone().flatten(), "arrival": if s.state == "delivered" { "delivered" } else if s.forecast.clone().flatten().is_some() { "estimated_by_carrier" } else { "unknown" }})); cx.cite(&EntityState::Shipment(s.clone())); }
    let comm_cov = cov.iter().find(|c| c.capability == "communications").map(|c| c.status.clone()).unwrap_or_default();
    let messages: Vec<Value> = cx.st.idx.messages_by_order.get(&order_id).cloned().unwrap_or_default().into_iter().filter_map(|m| match cx.get(EntityKind::Message, &m) { Some(EntityState::Facts(f)) => Some(json!({"message_id": m, "facts": f.facts})), _ => None }).collect();
    let promises: Vec<Value> = cx.st.idx.customer_promises_by_order.get(&order_id).cloned().unwrap_or_default().into_iter().filter_map(|p| match cx.get(EntityKind::Promise, &p) { Some(EntityState::Promise(pr)) => Some(json!({"promise_id": pr.promise_id, "promised_at": pr.promised_at, "kind": pr.promise_kind})), _ => None }).collect();
    cx.cite(&EntityState::Order(o.clone()));
    let partial = comm_cov == "unavailable";
    Ok(Answer { status: if partial { "partial".into() } else { "complete".into() }, result: json!({"order_id": order_id, "shipment_facts": facts, "known_promises": promises, "prior_communications": messages, "prior_promises_checked": !partial, "send_action": false, "omitted_context": if partial { vec!["communications"] } else { vec![] }}), calculation: vec!["Structured reply facts from shipment state, carrier scans and reviewed promises; wording is left to the user or their agent; nothing is sent.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: if partial { vec!["communications".into()] } else { vec![] }, conflicts: vec![], coverage: cov, next_cursor: None, truncated: false })
}

// ---------------------------------------------------------------- 03 Invoices
fn invoice_01(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["invoices", "coverage", "identity"]);
    if unavailable(&cov).contains(&"invoices".to_string()) { return Ok(missing(cov, vec!["invoices.correction_chain_coverage".into()], vec!["No invoicing capability is covered; outstanding amounts cannot be stated.".into()], json!({"open_minor": null}))); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.open_invoices.clone());
    cx.ensure(&ids.iter().map(|i| (EntityKind::Invoice, i.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![]; let mut total: BTreeMap<String, i64> = BTreeMap::new();
    for id in &ids { if let Some(EntityState::Invoice(i)) = cx.get(EntityKind::Invoice, id) { let open = i.reported_open_minor(); *total.entry(i.currency.clone()).or_insert(0) += open; rows.push(json!({"invoice_id": i.invoice_id, "order_id": i.order_id, "customer_id": i.customer_id, "currency": i.currency, "original_gross_minor": i.gross_minor, "credits_minor": i.credits_minor(), "net_minor": i.net_minor(), "reported_paid_minor": i.reported_paid_minor, "reconciled_allocated_minor": i.allocated_minor(), "reported_open_minor": open, "new_cash_from_marker": 0, "due_date": i.due_date, "overdue": i.due_date.as_ref().map(|d| d.as_str() < cx.now.format("%Y-%m-%d").to_string().as_str()).unwrap_or(false)})); cx.cite(&EntityState::Invoice(i)); } }
    Ok(Answer { status: "complete".into(), result: json!({"outstanding": rows, "totals_by_currency": total}), calculation: vec!["reported_open = max(0, original gross - credits - reported payment markers); markers are the invoicing tool's report, not cash; negative balances are credit/overpayment, not debt.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn invoice_02(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "fulfillments", "invoices", "policy", "coverage", "identity"]);
    let inv_cov = cov.iter().find(|c| c.capability == "invoices").map(|c| c.status.clone()).unwrap_or_default();
    if inv_cov != "complete_for_declared_scope" { return Ok(missing(cov, vec!["invoices.population_complete".into()], vec!["Invoice import is not complete for the declared scope, so absence of an invoice is not evidence of a missing invoice.".into()], json!({"missing_invoice": null}))); }
    let rule = cx.rule("invoicing_trigger"); let Some(trigger) = rule.as_ref().and_then(|r| r.invoicing_trigger.clone()) else { return Ok(missing(cov, vec!["policy.invoicing_trigger".into()], vec!["No invoicing rule recorded.".into()], json!({"missing_invoice": null}))) };
    if let Some(r) = &rule { cx.cite(&EntityState::Rule(r.clone())); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.all_orders.clone());
    let mut keys: Vec<Key> = ids.iter().map(|o| (EntityKind::Order, o.clone())).collect(); for o in &ids { for i in cx.st.idx.invoices_by_order.get(o).cloned().unwrap_or_default() { keys.push((EntityKind::Invoice, i)); } }
    cx.ensure(&keys)?;
    let mut rows = vec![];
    for id in &ids { let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) else { continue }; if o.cancelled { continue; }
        let eligible = match trigger.as_str() { "after_confirmed_dispatch" | "after_shipment" => o.lines.iter().any(|l| !l.dispatched.is_zero()), "on_acceptance" | "on_order" => true, "after_payment" | "after_capture" => o.captured_minor > 0, _ => false };
        if !eligible { continue; }
        let invoices: Vec<InvoiceState> = cx.st.idx.invoices_by_order.get(id).cloned().unwrap_or_default().into_iter().filter_map(|i| match cx.get(EntityKind::Invoice, &i) { Some(EntityState::Invoice(x)) if x.finalized && !x.cancelled => Some(x), _ => None }).collect();
        let invoiced: i64 = invoices.iter().map(|i| i.gross_minor).sum();
        if invoices.is_empty() { rows.push(json!({"order_id": id, "reason": "no valid invoice linked", "trigger": trigger, "order_gross_minor": o.gross_minor})); } else if invoiced < o.gross_minor { rows.push(json!({"order_id": id, "reason": "partially invoiced", "invoiced_minor": invoiced, "order_gross_minor": o.gross_minor, "invoices": invoices.iter().map(|i| i.invoice_id.clone()).collect::<Vec<_>>()})); }
        cx.cite(&EntityState::Order(o)); for i in &invoices { cx.cite(&EntityState::Invoice(i.clone())); } }
    Ok(Answer { status: "complete".into(), result: json!({"missing_invoice": rows, "invoicing_trigger": trigger}), calculation: vec![format!("Orders satisfying trigger `{trigger}` without a linked valid (final, not cancelled) invoice covering the order amount, given complete invoice population and identity.")], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn invoice_03(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "invoices", "coverage", "identity"]);
    { let un = unavailable(&cov); if un.contains(&"orders".to_string()) && un.contains(&"invoices".to_string()) { return Ok(missing(cov, vec!["orders.coverage".into(), "invoices.coverage".into()], vec!["No order or invoice capability is covered; agreed amounts cannot be compared with invoices.".into()], json!({"variances": [], "unresolved": []}))); } }
    let set: BTreeSet<String> = match cx.p_str("order_id") { Some(o) => BTreeSet::from([o]), None => cx.st.idx.invoices_by_order.keys().cloned().collect() };
    let (ids, next, truncated) = cx.page_ids(&set);
    let mut keys: Vec<Key> = ids.iter().map(|o| (EntityKind::Order, o.clone())).collect(); for o in &ids { for i in cx.st.idx.invoices_by_order.get(o).cloned().unwrap_or_default() { keys.push((EntityKind::Invoice, i)); } }
    cx.ensure(&keys)?;
    let mut rows = vec![]; let mut unresolved = vec![];
    for id in &ids { let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) else { continue };
        let invoices: Vec<InvoiceState> = cx.st.idx.invoices_by_order.get(id).cloned().unwrap_or_default().into_iter().filter_map(|i| match cx.get(EntityKind::Invoice, &i) { Some(EntityState::Invoice(x)) if x.finalized && !x.cancelled => Some(x), _ => None }).collect();
        for inv in &invoices { if inv.currency != o.currency { unresolved.push(json!({"order_id": id, "invoice_id": inv.invoice_id, "reason": "currency differs; no conversion without an explicit rate"})); continue; }
            if inv.line_links.is_empty() { if invoices.len() == 1 { let diff = inv.net_minor() - o.gross_minor; if diff != 0 { rows.push(json!({"order_id": id, "invoice_id": inv.invoice_id, "currency": inv.currency, "agreed_covered_gross_minor": o.gross_minor, "invoice_covered_gross_minor": inv.net_minor(), "difference_minor": diff, "basis": "whole_order"})); } } else { unresolved.push(json!({"order_id": id, "invoice_id": inv.invoice_id, "reason": "partial invoice without line links; covered lines unknown"})); } continue; }
            let mut agreed = 0i64; let mut covered = 0i64; let mut missing_links = vec![];
            for ll in &inv.line_links { match o.lines.iter().find(|l| l.line_id == ll.line_id) { Some(l) => { let share = match (&ll.quantity, l.quantity.0) { (Some(qstr), q0) if q0 > 0 => { let qq = Qty::parse(qstr).unwrap_or(l.quantity); ((l.line_gross_minor as i128 * qq.0 as i128) / q0 as i128) as i64 } _ => l.line_gross_minor }; agreed += share; covered += ll.gross_minor.unwrap_or(share); } None => missing_links.push(ll.line_id.clone()) } }
            if !missing_links.is_empty() { unresolved.push(json!({"order_id": id, "invoice_id": inv.invoice_id, "reason": "invoice lines reference unknown order lines", "lines": missing_links})); }
            let diff = covered - agreed; if diff != 0 { rows.push(json!({"order_id": id, "invoice_id": inv.invoice_id, "currency": inv.currency, "agreed_covered_gross_minor": agreed, "invoice_covered_gross_minor": covered, "difference_minor": diff, "basis": "covered_lines"})); }
            cx.cite(&EntityState::Invoice(inv.clone())); }
        cx.cite(&EntityState::Order(o)); }
    Ok(Answer { status: if unresolved.is_empty() { "complete".into() } else { "partial".into() }, result: json!({"variances": rows, "unresolved": unresolved}), calculation: vec!["Compare the agreed order version with linked invoice coverage: whole-order invoices against order gross, partial invoices only over their covered lines/quantities; no currency conversion.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: unresolved.iter().map(|u| format!("invoices.line_links[{}]", u["invoice_id"].as_str().unwrap_or(""))).collect(), conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn invoice_04(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["invoices", "invoice_dispatch", "coverage", "identity"]);
    let dcov = cov.iter().find(|c| c.capability == "invoice_dispatch").map(|c| c.status.clone()).unwrap_or_default();
    if dcov == "unavailable" { return Ok(missing(cov, vec!["invoice_dispatch.coverage".into()], vec!["No dispatch (postbox) capability is covered; sending cannot be evaluated.".into()], json!({"without_send_evidence_population_complete": false}))); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.invoices.clone());
    cx.ensure(&ids.iter().map(|i| (EntityKind::Invoice, i.clone())).collect::<Vec<_>>())?;
    let mut without = vec![]; let mut with = vec![];
    for id in &ids { if let Some(EntityState::Invoice(i)) = cx.get(EntityKind::Invoice, id) { if !i.finalized || i.cancelled { continue; } let sent = i.dispatch.iter().filter(|d| d.1 == "sent" || d.1 == "OK").count(); let pending = i.dispatch.iter().filter(|d| d.1 == "pending").count(); let errors = i.dispatch.iter().filter(|d| d.1 == "error").count();
        if sent > 0 { with.push(json!({"invoice_id": id, "evidence": "provider_reported_sent", "recipient_delivery_proven": false, "dispatches": i.dispatch.len()})); } else { without.push(json!({"invoice_id": id, "pending": pending, "errors": errors, "conclusion": if dcov == "complete_for_declared_scope" { "no_send_evidence_in_covered_scope" } else { "no_send_evidence_coverage_partial" }})); }
        cx.cite(&EntityState::Invoice(i)); } }
    Ok(Answer { status: if dcov == "complete_for_declared_scope" { "complete".into() } else { "partial".into() }, result: json!({"without_send_evidence": without, "with_send_evidence": with, "without_send_evidence_population_complete": dcov == "complete_for_declared_scope"}), calculation: vec!["Finalized invoices without a provider-reported sent dispatch within the covered postbox scope; absence is evidence only within complete coverage and never proves non-sending.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

// ---------------------------------------------------------------- 04 Customer payment
fn collection_01(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "payments", "coverage", "identity"]);
    if unavailable(&cov).contains(&"payments".to_string()) { return Ok(missing(cov, vec!["payments.status".into()], vec!["No payment transaction capability is covered; order financial labels alone are insufficient.".into()], json!({"collected_minor": null}))); }
    let set: BTreeSet<String> = match cx.p_str("order_id") { Some(o) => BTreeSet::from([o]), None => cx.st.idx.all_orders.clone() };
    let (ids, next, truncated) = cx.page_ids(&set);
    cx.ensure(&ids.iter().map(|o| (EntityKind::Order, o.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![];
    for id in &ids { if let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) { rows.push(json!({"order_id": o.order_id, "currency": o.currency, "order_gross_minor": o.gross_minor, "authorized_minor": o.authorized_minor, "collected_minor": o.captured_minor, "voided_minor": o.voided_minor, "failed_attempts": o.failed_attempts, "remaining_minor": o.remaining_minor(), "refunded_minor": o.refunded_minor, "state": o.payment_state(), "transactions": o.transactions, "authorization_is_capture": false})); cx.cite(&EntityState::Order(o)); } }
    Ok(Answer { status: "complete".into(), result: json!({"orders": rows}), calculation: vec!["collected = sum of successful captures; remaining = order gross - collected; authorizations, voids and failures are reported separately and never count as collected.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn collection_02(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "payments", "coverage", "identity"]);
    let pcov = cov.iter().find(|c| c.capability == "payments").map(|c| c.status.clone()).unwrap_or_default();
    if pcov == "unavailable" { return Ok(missing(cov, vec!["payments.attempt_history_coverage".into()], vec!["No payment attempt history is covered.".into()], json!({"recovered_population_complete": false}))); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.failed_attempt_orders.clone());
    cx.ensure(&ids.iter().map(|o| (EntityKind::Order, o.clone())).collect::<Vec<_>>())?;
    let mut recovered = vec![]; let mut open = vec![];
    for id in &ids { if let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) { let row = json!({"order_id": o.order_id, "required_minor": o.gross_minor, "collected_minor": o.captured_minor, "failed_history_retained": o.failed_attempts, "deficit_minor": o.remaining_minor()}); if o.captured_minor >= o.gross_minor && o.gross_minor > 0 { recovered.push(row); } else { open.push(row); } cx.cite(&EntityState::Order(o)); } }
    Ok(Answer { status: if pcov == "complete_for_declared_scope" { "complete".into() } else { "partial".into() }, result: json!({"recovered": recovered, "still_open": open, "recovered_population_complete": pcov == "complete_for_declared_scope"}), calculation: vec!["Orders with at least one failed attempt: recovered when later confirmed captures reach the required amount; failures stay in history.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn collection_03(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["invoices", "payments", "payment_allocations", "coverage", "identity"]);
    if unavailable(&cov).contains(&"payment_allocations".to_string()) { return Ok(Answer { status: "insufficient_data".into(), result: json!({"remaining_minor": null, "unallocated_payments_separate": true}), calculation: vec!["No invoice-to-payment allocation capability is covered; payments cannot be reconciled to invoices without explicit association.".into()], evidence_entry_ids: vec![], missing_inputs: vec!["payment_allocations".into()], conflicts: vec![], coverage: cov, next_cursor: None, truncated: false }); }
    let set: BTreeSet<String> = match cx.p_str("invoice_id") { Some(i) => BTreeSet::from([i]), None => cx.st.idx.invoices.clone() };
    let (ids, next, truncated) = cx.page_ids(&set);
    cx.ensure(&ids.iter().map(|i| (EntityKind::Invoice, i.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![];
    for id in &ids { if let Some(EntityState::Invoice(i)) = cx.get(EntityKind::Invoice, id) { if !i.finalized || i.cancelled { continue; } let allocated = i.allocated_minor(); let remaining = i.net_minor() - allocated; let proposed: i64 = i.allocations.values().filter(|a| a.1 == "proposed").map(|a| a.0).sum(); if remaining != 0 || proposed != 0 { rows.push(json!({"invoice_id": i.invoice_id, "currency": i.currency, "invoice_minor": i.gross_minor, "credit_minor": i.credits_minor(), "net_minor": i.net_minor(), "allocated_capture_minor": allocated, "remaining_minor": remaining.max(0), "overpayment_minor": (-remaining).max(0), "proposed_unconfirmed_minor": proposed, "fee_added_to_customer_debt": 0, "reported_paid_minor": i.reported_paid_minor})); } cx.cite(&EntityState::Invoice(i)); } }
    Ok(Answer { status: "complete".into(), result: json!({"variances": rows}), calculation: vec!["remaining = (gross - credits) - confirmed allocated customer payments; provider fees never reduce the customer payment; proposed allocations are shown separately.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn collection_04(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["invoices", "payment_allocations", "payments", "policy", "cases", "coverage", "identity"]);
    let case_cov = cov.iter().find(|c| c.capability == "cases").map(|c| c.status.clone()).unwrap_or_default();
    let rule = cx.rule("reminder_policy"); if let Some(r) = &rule { cx.cite(&EntityState::Rule(r.clone())); }
    let policy = rule.as_ref().and_then(|r| r.reminder_policy.clone()).unwrap_or_else(|| "review_overdue".into());
    let today = cx.p_str("today").unwrap_or_else(|| cx.now.format("%Y-%m-%d").to_string());
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.open_invoices.clone());
    let mut keys: Vec<Key> = ids.iter().map(|i| (EntityKind::Invoice, i.clone())).collect(); for i in &ids { for c in cx.st.idx.cases_by_invoice.get(i).cloned().unwrap_or_default() { keys.push((EntityKind::Case, c)); } }
    cx.ensure(&keys)?;
    let mut queue = vec![];
    for id in &ids { let Some(EntityState::Invoice(i)) = cx.get(EntityKind::Invoice, id) else { continue }; let Some(due) = i.due_date.clone() else { continue }; if due >= today { continue; }
        let cases: Vec<CaseState> = cx.st.idx.cases_by_invoice.get(id).cloned().unwrap_or_default().into_iter().filter_map(|c| match cx.get(EntityKind::Case, &c) { Some(EntityState::Case(x)) => Some(x), _ => None }).collect();
        let extension = cases.iter().filter_map(|c| c.agreed_extension_until.clone()).max(); let disputed = cases.iter().any(|c| c.status == "disputed");
        let hold = extension.as_ref().map(|e| e.as_str() >= today.as_str()).unwrap_or(false) || disputed;
        queue.push(json!({"invoice_id": id, "currency": i.currency, "open_minor": i.reported_open_minor(), "due_date": due, "days_overdue": chrono::NaiveDate::parse_from_str(&today, "%Y-%m-%d").ok().zip(chrono::NaiveDate::parse_from_str(&due, "%Y-%m-%d").ok()).map(|(t, d)| (t - d).num_days()), "cases": cases.iter().map(|c| json!({"case_id": c.case_id, "status": c.status, "agreed_extension_until": c.agreed_extension_until})).collect::<Vec<_>>(), "on_hold": hold, "case_context": if case_cov == "unavailable" { "unknown" } else { "known" }, "send_reminder": false}));
        cx.cite(&EntityState::Invoice(i)); for c in &cases { cx.cite(&EntityState::Case(c.clone())); } }
    let partial = case_cov == "unavailable";
    Ok(Answer { status: if partial { "partial".into() } else { "complete".into() }, result: json!({"review": queue, "policy": policy, "today": today, "queue_label": if partial { "amounts_due_case_context_unknown" } else { "amounts_due_with_case_context" }, "automatic_action": false}), calculation: vec!["Due net receivables (reported open > 0, due date before today) prioritized by due date; agreed extensions and disputes mark holds; no automatic reminder.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: if partial { vec!["cases.coverage".into()] } else { vec![] }, conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

// ---------------------------------------------------------------- 05 Payout & bank
fn account_rows(cx: &mut Ctx) -> Result<Vec<AccountState>, NeedHydration> {
    let ids: Vec<String> = cx.st.idx.accounts.iter().filter(|a| !a.starts_with("bank/")).cloned().collect();
    cx.ensure(&ids.iter().map(|a| (EntityKind::Account, a.clone())).collect::<Vec<_>>())?;
    Ok(ids.iter().filter_map(|a| match cx.get(EntityKind::Account, a) { Some(EntityState::Account(x)) => Some(x), _ => None }).collect())
}

fn settlement_01(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["provider_ledger", "positions", "payouts", "bank", "holds", "coverage", "identity"]);
    let un = unavailable(&cov);
    if un.contains(&"payouts".to_string()) && un.contains(&"provider_ledger".to_string()) && cx.st.idx.accounts.is_empty() { return Ok(missing(cov, vec!["payments".into(), "payouts".into()], vec!["No provider cash observations are covered.".into()], Value::Null)); }
    let accounts = account_rows(cx)?;
    let mut rows = vec![]; let mut unknown_components: BTreeSet<String> = BTreeSet::new();
    if un.contains(&"holds".to_string()) { unknown_components.insert("held".into()); }
    if un.contains(&"positions".to_string()) { unknown_components.insert("processing".into()); }
    for a in &accounts {
        let balance = a.balance_minor(); let held = a.held_minor(); let in_transit = a.in_transit_minor();
        let net_assets = balance + in_transit + a.bank_confirmed_minor;
        let partition_complete = a.last_balance.as_ref().map(|b| b.5 == "complete_partition").unwrap_or(false);
        let residual = a.last_balance.as_ref().and_then(|b| b.1).map(|total| total - balance);
        rows.push(json!({"account_id": a.account_id, "currency": a.currency, "captured_minor": a.captured_minor, "fees_minor": a.fees_minor, "refunded_minor": a.refunded_minor, "chargebacks_minor": a.chargeback_minor + a.chargeback_fee_minor - a.chargeback_reversed_minor, "adjustments_minor": a.adjustments_minor,
            "provider_balance_minor": balance, "held_minor": if unknown_components.contains("held") && a.holds.is_empty() { Value::Null } else { json!(held) }, "available_minor": if unknown_components.contains("held") && a.holds.is_empty() { Value::Null } else { json!(balance - held) }, "processing_minor": if unknown_components.contains("processing") { Value::Null } else { json!(a.last_balance.as_ref().and_then(|b| b.2).unwrap_or(0)) },
            "announced_payouts_minor": a.announced_minor(), "in_transit_minor": in_transit, "bank_confirmed_minor": a.bank_confirmed_minor, "net_assets_minor": net_assets, "provider_reported_total_minor": a.last_balance.as_ref().and_then(|b| b.1), "provider_reported_at": a.last_balance.as_ref().map(|b| b.0.clone()), "reconciliation_residual_minor": residual, "partition_complete": partition_complete && unknown_components.is_empty(), "unknown_components_are_zero": false, "payout_is_revenue": false}));
        cx.cite(&EntityState::Account(a.clone()));
    }
    let status = if unknown_components.is_empty() && un.iter().all(|c| c == "positions" || c == "provider_ledger") { "complete" } else { "partial" };
    Ok(Answer { status: status.into(), result: json!({"positions": rows, "unknown_components": unknown_components}), calculation: vec!["provider_balance = captures - fees - completed refunds - chargebacks + reversals + adjustments - payouts sent + payout reversals; in_transit = payouts sent without booked bank match; bank_confirmed = matched booked bank credits; categories are disjoint and unknown components are reported, not zeroed.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: unknown_components.iter().map(|c| format!("{c}")).chain(un.iter().filter(|c| *c == "bank").cloned()).collect(), conflicts: vec![], coverage: cov, next_cursor: None, truncated: false })
}

fn settlement_02(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["provider_ledger", "payouts", "coverage", "identity"]);
    let Some(payout_id) = cx.p_str("payout_id") else { return Ok(missing(cov, vec!["parameters.payout_id".into()], vec!["A payout id is required.".into()], Value::Null)) };
    cx.ensure(&[(EntityKind::Payout, payout_id.clone())])?;
    let Some(EntityState::Payout(p)) = cx.get(EntityKind::Payout, &payout_id) else { return Ok(missing(cov, vec!["payouts".into()], vec![format!("Payout {payout_id} not recorded.")], Value::Null)) };
    let acct_key = format!("{}/{}", p.account_id, p.currency); cx.ensure(&[(EntityKind::Account, acct_key.clone())])?;
    let Some(EntityState::Account(a)) = cx.get(EntityKind::Account, &acct_key) else { return Ok(missing(cov, vec!["provider_ledger".into()], vec!["No account state.".into()], Value::Null)) };
    if p.ledger_membership.is_empty() { return Ok(Answer { status: "insufficient_data".into(), result: json!({"payout_id": payout_id, "payout_minor": p.amount_minor, "reconciled": false}), calculation: vec!["No ledger postings are assigned to this payout; the difference cannot be explained from postings in a date window.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec!["provider_ledger.payout_membership_coverage".into()], conflicts: vec![], coverage: cov, next_cursor: None, truncated: false }); }
    let (mut captures, mut fees, mut refunds, mut other) = (0i64, 0i64, 0i64, 0i64); let mut members = vec![]; let mut missing_postings = vec![];
    for l in &p.ledger_membership { match a.ledger.get(l) { Some((ptype, gross, fee, net, _)) => { match ptype.as_str() { "charge" => { captures += gross; fees += fee; } "refund" => refunds += -net, "fee" => fees += -net, _ => other += net } members.push(json!({"ledger_entry_id": l, "posting_type": ptype, "gross_minor": gross, "fee_minor": fee, "net_minor": net})); } None => missing_postings.push(l.clone()) } }
    let computed = captures - fees - refunds + other; let unexplained = p.amount_minor - computed;
    cx.cite(&EntityState::Payout(p.clone())); cx.cite(&EntityState::Account(a.clone()));
    Ok(Answer { status: if missing_postings.is_empty() { "complete".into() } else { "partial".into() }, result: json!({"payout_id": payout_id, "currency": p.currency, "payout_minor": p.amount_minor, "member_captures_minor": captures, "member_fees_minor": fees, "member_refunds_minor": refunds, "other_adjustments_minor": other, "computed_net_minor": computed, "unexplained_minor": unexplained, "members": members, "missing_postings": missing_postings}), calculation: vec!["Sum only postings assigned to this payout: captures - fees - refunds + other adjustments; the residual against the payout amount is kept as unexplained.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: missing_postings.iter().map(|m| format!("provider_ledger[{m}]")).collect(), conflicts: vec![], coverage: cov, next_cursor: None, truncated: false })
}

fn settlement_03(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["payouts", "bank", "coverage", "identity"]);
    let bank = cov.iter().find(|c| c.capability == "bank").cloned().unwrap();
    if bank.status == "unavailable" { return Ok(Answer { status: "insufficient_data".into(), result: json!({"bank_arrival": "unknown"}), calculation: vec!["No bank statement has been imported; payout status alone cannot establish bank receipt.".into()], evidence_entry_ids: vec![], missing_inputs: vec!["bank".into()], conflicts: vec![], coverage: cov, next_cursor: None, truncated: false }); }
    let mut set = cx.st.idx.payouts_unconfirmed.clone(); set.extend(cx.st.idx.payouts_announced.iter().cloned());
    let (ids, next, truncated) = cx.page_ids(&set);
    cx.ensure(&ids.iter().map(|p| (EntityKind::Payout, p.clone())).collect::<Vec<_>>())?;
    let unmatched: Vec<String> = cx.st.idx.bank_unmatched.iter().cloned().collect(); cx.ensure(&unmatched.iter().map(|b| (EntityKind::BankEntry, b.clone())).collect::<Vec<_>>())?;
    let candidates: Vec<BankEntryState> = unmatched.iter().filter_map(|b| match cx.get(EntityKind::BankEntry, b) { Some(EntityState::BankEntry(x)) => Some(x), _ => None }).collect();
    let mut rows = vec![]; let mut ambiguous = vec![];
    for id in &ids { if let Some(EntityState::Payout(p)) = cx.get(EntityKind::Payout, id) {
        let cands: Vec<&BankEntryState> = candidates.iter().filter(|b| b.currency == p.currency && b.amount_minor == p.amount_minor && (b.reference.as_deref().map(|r| p.trace_reference.as_deref().map(|t| r.contains(t)).unwrap_or(false)).unwrap_or(false) || p.trace_reference.is_none())).collect();
        let conclusion = if p.state == "announced" { "announced_not_sent" } else if cands.len() == 1 { ambiguous.push(json!({"payout_id": id, "candidate_entry": cands[0].entry_id, "reason": "amount/currency match without confirmed reference; needs review"})); "candidate_requires_review" } else if cands.len() > 1 { ambiguous.push(json!({"payout_id": id, "candidates": cands.iter().map(|c| c.entry_id.clone()).collect::<Vec<_>>(), "reason": "multiple bank entries match amount"})); "ambiguous" } else { "no_evidence_in_imported_interval" };
        let age_days = p.issued_at.as_ref().and_then(|t| t.parse::<chrono::DateTime<chrono::Utc>>().ok()).map(|t| (cx.now - t).num_days());
        rows.push(json!({"payout_id": id, "state": p.state, "amount_minor": p.amount_minor, "currency": p.currency, "trace_reference": p.trace_reference, "issued_at": p.issued_at, "age_days": age_days, "conclusion": conclusion, "bank_import_complete_through": bank.complete_through}));
        cx.cite(&EntityState::Payout(p)); } }
    Ok(Answer { status: if bank.status == "complete_for_declared_scope" { "complete".into() } else { "partial".into() }, result: json!({"missing_confirmation": rows, "ambiguous": ambiguous, "statement_coverage": bank}), calculation: vec!["Sent payouts without a confirmed booked bank match; announcements are not transfers; amount-only candidates require review and are never auto-matched.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn settlement_04(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["holds", "positions", "coverage", "identity"]);
    if unavailable(&cov).contains(&"holds".to_string()) && cx.st.idx.holds.is_empty() { return Ok(missing(cov, vec!["holds".into()], vec!["No hold observations are covered for this workspace.".into()], json!({"held_minor": null}))); }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.holds.clone());
    cx.ensure(&ids.iter().map(|h| (EntityKind::Hold, h.clone())).collect::<Vec<_>>())?;
    let mut rows = vec![]; let mut held_total: BTreeMap<String, i64> = BTreeMap::new();
    for id in &ids { if let Some(EntityState::Hold(h)) = cx.get(EntityKind::Hold, id) { if h.source == "pending_refund" { continue; } let held = h.held_minor(); if let Some(c) = &h.currency { *held_total.entry(c.clone()).or_insert(0) += held; } rows.push(json!({"hold_id": h.hold_id, "account_id": h.account_id, "currency": h.currency, "amount_minor": h.amount_minor, "released_minor": h.released_minor, "held_minor": held, "state": h.state, "reason": h.reason, "release_promised_at": h.release_promised_at, "released_at": h.released_at, "release_is_only_promised": h.release_promised_at.is_some() && h.state == "active"})); cx.cite(&EntityState::Hold(h)); } }
    Ok(Answer { status: if unavailable(&cov).contains(&"holds".to_string()) { "partial".into() } else { "complete".into() }, result: json!({"holds": rows, "held_by_currency": held_total}), calculation: vec!["Current hold versions only; held = amount - released; a promised release date is a commitment, not a release; superseded holds are not summed.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: vec![], conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

// ---------------------------------------------------------------- 06 Reversal
fn reversal_01(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["returns", "receipts", "refunds", "coverage", "identity"]);
    let rc = cov.iter().find(|c| c.capability == "receipts").map(|c| c.status.clone()).unwrap_or_default();
    let set: BTreeSet<String> = match cx.p_str("return_id") { Some(r) => BTreeSet::from([r]), None => cx.st.idx.returns.clone() };
    let (ids, next, truncated) = cx.page_ids(&set);
    let mut keys: Vec<Key> = ids.iter().map(|r| (EntityKind::Return, r.clone())).collect(); cx.ensure(&keys)?;
    let mut rets: Vec<ReturnState> = vec![]; for id in &ids { if let Some(EntityState::Return(r)) = cx.get(EntityKind::Return, id) { rets.push(r); } }
    keys = rets.iter().filter_map(|r| r.order_id.clone()).map(|o| (EntityKind::Order, o)).collect(); cx.ensure(&keys)?;
    let mut rows = vec![];
    for r in &rets {
        let order = r.order_id.as_ref().and_then(|o| match cx.get(EntityKind::Order, o) { Some(EntityState::Order(x)) => Some(x), _ => None });
        let refunds: Vec<Value> = order.as_ref().map(|o| o.refunds.iter().filter_map(|f| match cx.st.peek(&(EntityKind::Refund, f.clone())) { Some(EntityState::Refund(x)) => Some(json!({"refund_id": x.refund_id, "amount_minor": x.amount_minor, "currency": x.currency, "state": x.state})), _ => None }).collect()).unwrap_or_default();
        let sum = |m: &BTreeMap<String, Qty>| m.values().fold(Qty::ZERO, |a, b| a.checked_add(*b).unwrap_or(a));
        let received = sum(&r.received); let requested = sum(&r.requested);
        rows.push(json!({"return_id": r.return_id, "order_id": r.order_id, "state": r.state, "requested": qs(requested), "received": qs(received), "quarantined": qs(sum(&r.quarantined)), "restocked": qs(sum(&r.restocked)), "damaged": qs(sum(&r.damaged)), "missing": qs(sum(&r.missing)), "physical_return_received": !received.is_zero(), "sellable_added": qs(sum(&r.restocked)), "receipt_state": if rc == "unavailable" && received.is_zero() { "unknown" } else if received.is_zero() { "not_received" } else if received < requested { "partially_received" } else { "received" }, "request_is_not_receipt": true, "refunds": refunds, "cash_refund_confirmed": refunds.iter().any(|f| f["state"] == "completed"), "expected_credit_minor": r.expected_credit_minor, "next_step": if received.is_zero() { "await_goods_receipt" } else if !sum(&r.quarantined).is_zero() { "inspect_and_disposition" } else if !refunds.iter().any(|f| f["state"] == "completed") { "settle_refund_or_credit" } else { "none" }}));
        cx.cite(&EntityState::Return(r.clone())); if let Some(o) = order { cx.cite(&EntityState::Order(o)); }
    }
    Ok(Answer { status: if rc == "unavailable" { "partial".into() } else { "complete".into() }, result: json!({"returns": rows}), calculation: vec!["Requested, received, quarantined, restocked and refund money are independent quantities; a return request is intent, not receipt.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: if rc == "unavailable" { vec!["receipts".into()] } else { vec![] }, conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn reversal_02(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["invoices", "payments", "entitlements", "refunds", "coverage", "identity"]);
    let ecov = cov.iter().find(|c| c.capability == "entitlements").map(|c| c.status.clone()).unwrap_or_default();
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.invoices.clone());
    let mut keys: Vec<Key> = ids.iter().map(|i| (EntityKind::Invoice, i.clone())).collect(); for ob in cx.st.idx.refund_obligations.clone() { keys.push((EntityKind::RefundObligation, ob)); }
    cx.ensure(&keys)?;
    let obligations: Vec<RefundObligationState> = cx.st.idx.refund_obligations.clone().into_iter().filter_map(|o| match cx.get(EntityKind::RefundObligation, &o) { Some(EntityState::RefundObligation(x)) if x.state == "approved" => Some(x), _ => None }).collect();
    let mut rows = vec![]; let mut credit_only = vec![];
    for id in &ids { let Some(EntityState::Invoice(i)) = cx.get(EntityKind::Invoice, id) else { continue }; if i.credits.is_empty() { continue; }
        let explicit: Vec<&RefundObligationState> = obligations.iter().filter(|o| o.invoice_id.as_deref() == Some(id.as_str()) || i.credits.iter().any(|c| Some(&c.0) == o.credit_id.as_ref())).collect();
        let approved: i64 = if !explicit.is_empty() { explicit.iter().map(|o| o.amount_minor).sum() } else if ecov == "unavailable" { i.refund_payable_from_credits() } else { 0 };
        let tx_ids: Vec<String> = explicit.iter().filter_map(|o| o.original_transaction_id.clone()).chain(i.payment_markers.iter().filter_map(|m| m.0.clone())).collect();
        cx.ensure(&tx_ids.iter().map(|t| (EntityKind::Transaction, t.clone())).collect::<Vec<_>>())?;
        let completed: i64 = tx_ids.iter().filter_map(|t| match cx.get(EntityKind::Transaction, t) { Some(EntityState::Transaction(x)) => Some(x.refunded_minor()), _ => None }).sum();
        let due = (approved - completed).max(0);
        if approved == 0 { credit_only.push(json!({"invoice_id": id, "credit_minor": i.credits_minor(), "reason": if i.reported_paid_minor == 0 { "unpaid invoice credited: receivable reduced, no cash refund owed" } else { "no approved refund entitlement recorded" }})); continue; }
        rows.push(json!({"invoice_id": id, "currency": i.currency, "credit_minor": i.credits_minor(), "original_capture_minor": i.reported_paid_minor, "approved_cash_refund_minor": approved, "completed_cash_refund_minor": completed, "cash_refund_due_minor": due, "basis": if explicit.is_empty() { "derived_from_paid_invoice_credit" } else { "explicit_entitlement" }}));
        cx.cite(&EntityState::Invoice(i)); for o in explicit { cx.cite(&EntityState::RefundObligation(o.clone())); } }
    Ok(Answer { status: if ecov == "unavailable" { "partial".into() } else { "complete".into() }, result: json!({"refund_gaps": rows, "credit_without_cash_refund": credit_only}), calculation: vec!["Approved cash refund entitlement (explicit, or derived from credits on paid invoice portions when no entitlement feed exists) minus completed refunds on the same original payment; a credit note alone does not create a cash repayment.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: if ecov == "unavailable" { vec!["entitlements".into()] } else { vec![] }, conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn reversal_03(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["orders", "allocations", "invoices", "payments", "refunds", "entitlements", "receipts", "coverage", "identity"]);
    let alloc_known = cov.iter().find(|c| c.capability == "allocations").map(|c| c.status != "unavailable").unwrap_or(false);
    let set: BTreeSet<String> = match cx.p_str("order_id") { Some(o) => BTreeSet::from([o]), None => cx.st.idx.cancelled_orders.clone() };
    let (ids, next, truncated) = cx.page_ids(&set);
    let mut keys: Vec<Key> = ids.iter().map(|o| (EntityKind::Order, o.clone())).collect(); for o in &ids { for i in cx.st.idx.invoices_by_order.get(o).cloned().unwrap_or_default() { keys.push((EntityKind::Invoice, i)); } for t in cx.st.idx.transactions_by_order.get(o).cloned().unwrap_or_default() { keys.push((EntityKind::Transaction, t)); } }
    cx.ensure(&keys)?;
    let mut rows = vec![];
    for id in &ids { let Some(EntityState::Order(o)) = cx.get(EntityKind::Order, id) else { continue }; if !o.cancelled && !o.lines.iter().any(|l| !l.cancelled.is_zero()) { continue; }
        let shipped: Qty = o.lines.iter().fold(Qty::ZERO, |a, l| a.checked_add(l.dispatched).unwrap_or(a)); let reserved: Qty = o.lines.iter().fold(Qty::ZERO, |a, l| a.checked_add(l.reserved).unwrap_or(a));
        let invoices: Vec<InvoiceState> = cx.st.idx.invoices_by_order.get(id).cloned().unwrap_or_default().into_iter().filter_map(|i| match cx.get(EntityKind::Invoice, &i) { Some(EntityState::Invoice(x)) => Some(x), _ => None }).collect();
        let txs: Vec<TransactionState> = cx.st.idx.transactions_by_order.get(id).cloned().unwrap_or_default().into_iter().filter_map(|t| match cx.get(EntityKind::Transaction, &t) { Some(EntityState::Transaction(x)) => Some(x), _ => None }).collect();
        let invoice_open: i64 = invoices.iter().filter(|i| i.finalized && !i.cancelled).map(|i| i.net_minor()).sum();
        let captured: i64 = txs.iter().map(|t| t.captured_minor).sum(); let refunded: i64 = txs.iter().map(|t| t.refunded_minor()).sum(); let pending: i64 = txs.iter().map(|t| t.pending_refund_minor()).sum(); let authorized_open: i64 = txs.iter().filter(|t| t.captured_minor == 0 && t.voided_minor == 0).map(|t| t.authorized_minor).sum();
        let mut steps = vec![]; let mut unknown = vec![];
        if alloc_known { if !reserved.is_zero() { steps.push("release_reservation"); } } else { unknown.push("reservation_step"); }
        if !shipped.is_zero() { steps.push("return_of_shipped_goods_required"); }
        if invoice_open > 0 { steps.push("correct_invoice"); }
        if captured - refunded - pending > 0 { steps.push("refund_payment"); } else if authorized_open > 0 { steps.push("void_authorization"); }
        rows.push(json!({"order_id": id, "cancelled": o.cancelled, "shipped_qty": qs(shipped), "active_reserved_qty": if alloc_known { json!(qs(reserved)) } else { Value::Null }, "invoice_net_open_minor": invoice_open, "captured_minor": captured, "completed_refund_minor": refunded, "pending_refund_minor": pending, "open_authorization_minor": authorized_open, "stock_receipt_required": !shipped.is_zero(), "remaining_steps": steps, "unknown_steps": unknown, "do_not_mark_complete": !unknown.is_empty()}));
        cx.cite(&EntityState::Order(o)); for i in &invoices { cx.cite(&EntityState::Invoice(i.clone())); } for t in &txs { cx.cite(&EntityState::Transaction(t.clone())); } }
    Ok(Answer { status: if alloc_known { "complete".into() } else { "partial".into() }, result: json!({"cancellations": rows}), calculation: vec!["Independent checks at one cutoff: active reservations (release), shipped goods (return branch), finalized invoice net (correct), captured minus refunded (refund) or open authorization (void). A cancellation reverses nothing by itself.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: if alloc_known { vec![] } else { vec!["allocations".into()] }, conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

fn reversal_04(cx: &mut Ctx) -> Result<Answer, NeedHydration> {
    let cov = cx.coverage(&["payments", "refunds", "disputes", "coverage", "identity"]);
    { let un = unavailable(&cov); if un.contains(&"payments".to_string()) && un.contains(&"disputes".to_string()) { return Ok(missing(cov, vec!["payments.coverage".into(), "disputes.coverage".into()], vec!["No payment or dispute capability is covered; refund/chargeback overlap cannot be assessed.".into()], json!({"cases": [], "unlinked": []}))); } }
    let (ids, next, truncated) = cx.page_ids(&cx.st.idx.disputes.clone());
    cx.ensure(&ids.iter().map(|d| (EntityKind::Dispute, d.clone())).collect::<Vec<_>>())?;
    let disputes: Vec<DisputeState> = ids.iter().filter_map(|d| match cx.get(EntityKind::Dispute, d) { Some(EntityState::Dispute(x)) => Some(x), _ => None }).collect();
    let tx_keys: Vec<Key> = disputes.iter().filter_map(|d| d.original_transaction_id.clone()).map(|t| (EntityKind::Transaction, t)).collect(); cx.ensure(&tx_keys)?;
    let mut rows = vec![]; let mut unlinked = vec![];
    for d in &disputes {
        let Some(tx_id) = &d.original_transaction_id else { unlinked.push(json!({"dispute_id": d.dispute_id, "reason": "no original transaction link; duplicate repayment cannot be proven"})); continue };
        let Some(EntityState::Transaction(t)) = cx.get(EntityKind::Transaction, tx_id) else { unlinked.push(json!({"dispute_id": d.dispute_id, "reason": "original transaction not recorded"})); continue };
        let refunds = t.refunded_minor(); let net_cb = t.chargeback_debit_minor - t.chargeback_reversed_minor; let repayments = refunds + net_cb; let excess = (repayments - t.captured_minor).max(0);
        let pending_overlap = t.pending_refund_minor() > 0 && d.state == "open";
        rows.push(json!({"dispute_id": d.dispute_id, "original_transaction_id": tx_id, "currency": t.currency, "capture_minor": t.captured_minor, "refund_completed_minor": refunds, "chargeback_debit_minor": t.chargeback_debit_minor, "chargeback_reversed_minor": t.chargeback_reversed_minor, "chargeback_fee_minor": t.chargeback_fee_minor, "fees_excluded": true, "net_customer_repayments_minor": repayments, "excess_minor": excess, "dispute_state": d.state, "open_dispute_is_repayment": false, "pending_refund_overlap": pending_overlap, "review_required": excess > 0 || pending_overlap}));
        cx.cite(&EntityState::Dispute(d.clone())); cx.cite(&EntityState::Transaction(t));
    }
    Ok(Answer { status: if unlinked.is_empty() { "complete".into() } else { "partial".into() }, result: json!({"cases": rows, "unlinked_disputes": unlinked, "duplicate_repayment_proven": rows.iter().any(|r| r["excess_minor"].as_i64().unwrap_or(0) > 0)}), calculation: vec!["Per original capture: completed cash refunds + (booked chargeback debits - reversals), fees excluded; excess over the capture or overlapping pending actions flag review; an open dispute is not a repayment.".into()], evidence_entry_ids: cx.evidence.clone(), missing_inputs: unlinked.iter().map(|u| format!("disputes.original_transaction_id[{}]", u["dispute_id"].as_str().unwrap_or(""))).collect(), conflicts: vec![], coverage: cov, next_cursor: next, truncated })
}

// ---------------------------------------------------------------- entity state view (get_business_state)
pub fn entity_view(st: &mut TenantState, kind: EntityKind, id: &str) -> Result<Option<Value>, NeedHydration> {
    let key = (kind, id.to_string());
    if st.is_known(&key) && !st.is_resident(&key) { return Err(NeedHydration(vec![key])); }
    let Some(s) = st.get(&key).cloned() else { return Ok(None) };
    let computed = match &s {
        EntityState::Item(i) => { let av = i.availability(); json!({"basis_known": av.basis_known, "basis": av.basis, "unit": av.unit, "physical": av.physical.map(qs), "quarantined": qs(av.quarantined), "damaged": qs(av.damaged), "safety_stock": qs(av.safety_stock), "quality_control": qs(av.quality_control), "reserved": qs(av.reserved), "available": av.available.map(qs), "incoming": av.incoming.map(qs)}) }
        EntityState::Order(o) => json!({"payment_state": o.payment_state(), "remaining_minor": o.remaining_minor(), "open": o.is_open()}),
        EntityState::Invoice(i) => json!({"net_minor": i.net_minor(), "credits_minor": i.credits_minor(), "reported_open_minor": i.reported_open_minor(), "allocated_minor": i.allocated_minor(), "refund_payable_from_credits_minor": i.refund_payable_from_credits()}),
        EntityState::Transaction(t) => json!({"status": t.status(), "refunded_minor": t.refunded_minor(), "pending_refund_minor": t.pending_refund_minor(), "net_collected_minor": t.captured_minor - t.refunded_minor()}),
        EntityState::Account(a) => json!({"balance_minor": a.balance_minor(), "held_minor": a.held_minor(), "available_minor": a.available_minor(), "announced_minor": a.announced_minor(), "in_transit_minor": a.in_transit_minor(), "bank_confirmed_minor": a.bank_confirmed_minor}),
        EntityState::Hold(h) => json!({"held_minor": h.held_minor()}),
        _ => Value::Null,
    };
    Ok(Some(json!({"entity_type": kind.as_str(), "entity_id": id, "state": s, "computed": computed, "evidence_entry_ids": s.provenance().entry_ids, "last_sequence": s.provenance().last_sequence})))
}

pub const INTENTS: &[(&str, &str)] = &[
    ("order-01", "inventory.available_to_sell"), ("order-02", "orders.fulfillable"), ("order-03", "orders.reservation_variance"), ("order-04", "orders.inbound_delay_impact"),
    ("delivery-01", "shipments.attention"), ("delivery-02", "shipments.promise_risk"), ("delivery-03", "orders.partial_delivery_gaps"), ("delivery-04", "customer.delivery_reply"),
    ("invoice-01", "invoices.outstanding"), ("invoice-02", "orders.missing_invoice"), ("invoice-03", "invoices.order_amount_variance"), ("invoice-04", "invoices.dispatch_evidence"),
    ("collection-01", "orders.payment_state"), ("collection-02", "payments.recovered_attempts"), ("collection-03", "invoices.payment_variance"), ("collection-04", "receivables.review_queue"),
    ("settlement-01", "providers.money_positions"), ("settlement-02", "payouts.gross_to_net"), ("settlement-03", "payouts.missing_bank_confirmation"), ("settlement-04", "providers.holds_and_releases"),
    ("reversal-01", "returns.lifecycle"), ("reversal-02", "credits.refund_gaps"), ("reversal-03", "cancellations.outstanding_steps"), ("reversal-04", "refunds.chargeback_overlap"),
];

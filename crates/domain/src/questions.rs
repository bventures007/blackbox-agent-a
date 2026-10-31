//! Structured intent execution over typed, tenant-scoped record projections.
//! No natural-language classification, template answer lookup, or provider arithmetic.
use crate::lifecycle::{decimal, micros};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Record {
    pub id: String,
    pub entity_id: String,
    pub connection_id: String,
    pub occurred_at: String,
    pub entry_id: String,
    pub evidence_id: String,
    pub data: Value,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Question {
    pub intent: String,
    pub entity_id: Option<String>,
    pub item_id: Option<String>,
    pub currency: Option<String>,
    pub requested_quantity: Option<String>,
    pub unit: Option<String>,
    pub as_of: String,
    pub from: Option<String>,
    pub limit: usize,
    pub offset: usize,
}
pub const INTENTS: &[(&str, &[&str])] = &[
    ("inventory.available_to_sell", &["stock", "identity"]),
    (
        "orders.fulfillable",
        &["orders", "stock", "allocations", "policy", "identity"],
    ),
    (
        "orders.reservation_variance",
        &["orders", "allocations", "fulfillments", "identity"],
    ),
    (
        "orders.inbound_delay_impact",
        &["orders", "supply", "allocations", "promises", "identity"],
    ),
    (
        "shipments.attention",
        &["fulfillments", "tracking", "policy", "identity"],
    ),
    (
        "shipments.promise_risk",
        &[
            "orders",
            "promises",
            "fulfillments",
            "tracking",
            "policy",
            "identity",
        ],
    ),
    (
        "orders.partial_delivery_gaps",
        &["orders", "fulfillments", "tracking", "identity"],
    ),
    (
        "customer.delivery_reply",
        &[
            "orders",
            "fulfillments",
            "tracking",
            "communications",
            "identity",
        ],
    ),
    ("invoices.outstanding", &["invoices", "identity"]),
    (
        "orders.missing_invoice",
        &["orders", "fulfillments", "invoices", "policy", "identity"],
    ),
    (
        "invoices.order_amount_variance",
        &["orders", "invoices", "identity"],
    ),
    (
        "invoices.dispatch_evidence",
        &["invoices", "invoice_dispatch", "identity"],
    ),
    ("orders.payment_state", &["orders", "payments", "identity"]),
    (
        "payments.recovered_attempts",
        &["orders", "payments", "identity"],
    ),
    (
        "invoices.payment_variance",
        &["invoices", "payments", "payment_allocations", "identity"],
    ),
    (
        "receivables.review_queue",
        &[
            "invoices",
            "payments",
            "payment_allocations",
            "policy",
            "cases",
            "identity",
        ],
    ),
    (
        "providers.money_positions",
        &[
            "provider_ledger",
            "positions",
            "payouts",
            "bank",
            "holds",
            "identity",
        ],
    ),
    (
        "payouts.gross_to_net",
        &["provider_ledger", "payouts", "identity"],
    ),
    (
        "payouts.missing_bank_confirmation",
        &["payouts", "bank", "identity"],
    ),
    (
        "providers.holds_and_releases",
        &["holds", "positions", "identity"],
    ),
    (
        "returns.lifecycle",
        &["returns", "receipts", "refunds", "identity"],
    ),
    (
        "credits.refund_gaps",
        &[
            "invoices",
            "payments",
            "entitlements",
            "refunds",
            "identity",
        ],
    ),
    (
        "cancellations.outstanding_steps",
        &[
            "fulfillments",
            "orders",
            "allocations",
            "invoices",
            "payments",
            "refunds",
            "entitlements",
            "receipts",
            "identity",
        ],
    ),
    (
        "refunds.chargeback_overlap",
        &["payments", "refunds", "disputes", "identity"],
    ),
];
pub(crate) fn s<'a>(v: &'a Value, key: &str) -> &'a str {
    v[key].as_str().unwrap_or("")
}
pub(crate) fn n(v: &Value, key: &str) -> Result<i64, String> {
    v[key]
        .as_i64()
        .ok_or_else(|| format!("missing_numeric_{key}"))
}
pub(crate) fn add(a: i64, b: i64) -> Result<i64, String> {
    a.checked_add(b).ok_or("amount_overflow".into())
}
pub(crate) fn sub(a: i64, b: i64) -> Result<i64, String> {
    a.checked_sub(b).ok_or("amount_overflow".into())
}
pub(crate) fn q(v: &Value, key: &str) -> Result<i64, String> {
    micros(s(v, key))
}
pub(crate) fn array<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v[key].as_array().map(|a| a.as_slice()).unwrap_or(&[])
}
pub(crate) fn seconds(value: &str) -> Result<i64, String> {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|v| v.timestamp())
        .map_err(|_| "invalid_timestamp".into())
}
pub(crate) struct Context<'a> {
    pub records: &'a [Record],
    pub request: &'a Question,
    pub missing: BTreeSet<String>,
    pub conflicts: BTreeSet<String>,
    pub evidence: BTreeSet<String>,
    pub inputs: BTreeSet<String>,
}
impl<'a> Context<'a> {
    pub fn rows(&mut self, dataset: &str) -> Vec<&'a Record> {
        let found: Vec<_> = self
            .records
            .iter()
            .filter(|r| s(&r.data, "dataset") == dataset)
            .collect();
        for r in &found {
            self.evidence.insert(r.evidence_id.clone());
            self.inputs.insert(r.entry_id.clone());
        }
        found
    }
    pub fn effects(&mut self, dataset: &str) -> Vec<&'a Record> {
        let rows = self.rows(dataset);
        let mut seen: BTreeMap<&str, &Value> = BTreeMap::new();
        for r in &rows {
            let key = s(&r.data, "economic_effect_id");
            if let Some(old) = seen.get(key) {
                if old["amount_minor"] != r.data["amount_minor"]
                    || old["currency"] != r.data["currency"]
                    || old["status"] != r.data["status"]
                {
                    self.conflicts.insert("economic_identity_conflict".into());
                }
            }
            seen.insert(key, &r.data);
        }
        unique_effects(rows)
    }
    pub fn scoped(&self, r: &Record) -> bool {
        self.request.entity_id.as_ref().is_none_or(|id| {
            &r.id == id
                || &r.entity_id == id
                || [
                    "order_id",
                    "invoice_id",
                    "original_transaction_id",
                    "payout_id",
                    "return_id",
                    "account_id",
                ]
                .iter()
                .any(|key| s(&r.data, key) == id)
        })
    }
    pub fn currency(&self, r: &Record) -> bool {
        self.request
            .currency
            .as_ref()
            .is_none_or(|c| s(&r.data, "currency") == c)
    }
    pub fn gap(&mut self, field: &str) {
        self.missing.insert(field.into());
    }
    pub fn coverage(&mut self, dataset: &str) -> bool {
        let now = seconds(&self.request.as_of).unwrap_or(i64::MAX);
        let from = self.request.from.as_ref().and_then(|s| seconds(s).ok());
        let covers: Vec<_> = self
            .rows("coverage")
            .into_iter()
            .filter(|r| {
                s(&r.data, "capability") == dataset
                    && (r.data["entity_scope"].is_null()
                        || r.data["entity_scope"].as_str()
                            == self
                                .request
                                .entity_id
                                .as_deref()
                                .or(self.request.item_id.as_deref()))
            })
            .collect();
        let valid = covers.iter().any(|r| {
            r.data["backfill_complete"] == true
                && s(&r.data, "failure_state") == "none"
                && seconds(s(&r.data, "complete_through")).is_ok_and(|t| t >= now)
                && (s(&r.data, "history_kind") != "snapshot_only"
                    || (from.is_none()
                        && chrono::DateTime::parse_from_rfc3339(s(&r.data, "complete_through"))
                            .ok()
                            == chrono::DateTime::parse_from_rfc3339(&self.request.as_of).ok()))
                && from.is_none_or(|f| seconds(s(&r.data, "history_start")).is_ok_and(|t| t <= f))
        });
        for r in covers {
            for field in array(&r.data, "missing_fields") {
                if let Some(v) = field.as_str() {
                    self.gap(v);
                    if v == "source_conflict" {
                        self.conflicts.insert("provider_content_conflict".into());
                    }
                }
            }
        }
        if !valid {
            self.gap(&format!("{dataset}.coverage"));
        }
        valid
    }
    pub fn policy(&mut self, kind: &str) -> Option<&'a Record> {
        let rows = self.rows("policy");
        let value = rows
            .into_iter()
            .filter(|r| {
                s(&r.data, "rule_kind") == kind
                    && seconds(s(&r.data, "effective_from"))
                        .is_ok_and(|t| t <= seconds(&self.request.as_of).unwrap_or(0))
            })
            .max_by_key(|r| (&r.occurred_at, &r.id));
        if value.is_none() {
            self.gap(&format!("policy.{kind}"));
        }
        value
    }
}
pub(crate) fn sum<'a>(
    mut rows: impl Iterator<Item = &'a Record>,
    field: &str,
) -> Result<i64, String> {
    rows.try_fold(0, |v, r| add(v, n(&r.data, field)?))
}
pub(crate) fn unique_effects<'a>(rows: Vec<&'a Record>) -> Vec<&'a Record> {
    let mut current: BTreeMap<&str, &Record> = BTreeMap::new();
    for r in rows {
        let key = s(&r.data, "economic_effect_id");
        if current
            .get(key)
            .is_none_or(|old| (&old.occurred_at, &old.id) < (&r.occurred_at, &r.id))
        {
            current.insert(key, r);
        }
    }
    current.into_values().collect()
}
mod finance;
mod settlement;
mod stock;
pub fn execute(records: &[Record], request: &Question) -> Result<Value, String> {
    let required = INTENTS
        .iter()
        .find(|(intent, _)| *intent == request.intent)
        .ok_or("unsupported_intent")?
        .1;
    if records.len() > 20000 || request.limit == 0 || request.limit > 500 || request.offset > 20000
    {
        return Err("query_budget_exceeded".into());
    }
    seconds(&request.as_of)?;
    let mut ctx = Context {
        records,
        request,
        missing: BTreeSet::new(),
        conflicts: BTreeSet::new(),
        evidence: BTreeSet::new(),
        inputs: BTreeSet::new(),
    };
    for cap in required {
        ctx.coverage(cap);
    }
    if required.contains(&"fulfillments") {
        for r in ctx.rows("fulfillments") {
            if ctx.scoped(r) && matches!(s(&r.data, "state"), "prepared" | "failed") {
                ctx.gap("fulfillments.handover_confirmation");
            }
        }
    }
    for r in ctx.rows("identity") {
        if s(&r.data, "confidence") == "ambiguous" && ctx.scoped(r) {
            ctx.conflicts.insert("ambiguous_identity".into());
        }
    }
    let mut rows = match request.intent.as_str() {
        "inventory.available_to_sell"
        | "orders.fulfillable"
        | "orders.reservation_variance"
        | "orders.inbound_delay_impact"
        | "shipments.attention"
        | "shipments.promise_risk"
        | "orders.partial_delivery_gaps"
        | "customer.delivery_reply" => stock::query(&mut ctx)?,
        "invoices.outstanding"
        | "orders.missing_invoice"
        | "invoices.order_amount_variance"
        | "invoices.dispatch_evidence"
        | "orders.payment_state"
        | "payments.recovered_attempts"
        | "invoices.payment_variance"
        | "receivables.review_queue" => finance::query(&mut ctx)?,
        _ => settlement::query(&mut ctx)?,
    };
    rows.sort_by_key(|r| s(r, "id").to_owned());
    let partial = matches!(
        request.intent.as_str(),
        "customer.delivery_reply"
            | "receivables.review_queue"
            | "providers.money_positions"
            | "returns.lifecycle"
            | "cancellations.outstanding_steps"
    );
    let status = if !ctx.conflicts.is_empty() {
        "conflict"
    } else if !ctx.missing.is_empty() {
        if partial {
            "partial"
        } else {
            "insufficient_data"
        }
    } else {
        "partial"
    };
    let limitations: BTreeSet<_> = ctx
        .records
        .iter()
        .filter(|r| {
            s(&r.data, "dataset") == "coverage"
                && required.contains(&s(&r.data, "capability"))
                && (r.data["entity_scope"].is_null()
                    || r.data["entity_scope"].as_str()
                        == request.entity_id.as_deref().or(request.item_id.as_deref()))
        })
        .flat_map(|r| {
            array(&r.data, "limitations")
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
        })
        .collect();
    let total = rows.len();
    let page: Vec<_> = rows
        .into_iter()
        .skip(request.offset)
        .take(request.limit)
        .collect();
    Ok(
        json!({"status":status,"intent":request.intent,"result":if status=="insufficient_data"{Value::Null}else{json!({"rows":page,"count_in_scope":total})},"missing_inputs":ctx.missing,"conflicts":ctx.conflicts,"evidence":ctx.evidence,"input_entries":ctx.inputs,"coverage":{"basis":"declared_source_intervals","independently_verified":false,"limitations":limitations},"rule_version":"questions-v7","as_of":request.as_of,"next_offset":if request.offset+request.limit<total{Some(request.offset+request.limit)}else{None},"truncated":false}),
    )
}

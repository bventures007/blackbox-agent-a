//! Explicit v1 event readers. Unknown durable inputs must never become generic facts.
use crate::Observation;
use serde_json::Value;

pub const INPUT_READER_VERSION: u32 = 2;

pub fn record_kind(record: &Value) -> Result<String, &'static str> {
    let kind = match record["dataset"].as_str().ok_or("unsupported_event")? {
        "orders" => match record["status"].as_str() {
            Some("cancelled") => "order.cancelled",
            Some("open" | "closed") => "order.revised",
            _ => return Err("unsupported_event"),
        },
        "stock" => "inventory.snapshot",
        "allocations" => "allocation.revised",
        "supply" => "supply.commitment_recorded",
        "promises" => "customer.commitment_recorded",
        "fulfillments" => "shipment.observed",
        "tracking" => "carrier.scan_observed",
        "communications" => "communication.observed",
        "invoices" => match record["kind"].as_str() {
            Some("credit") => "invoice.credit_issued",
            Some("invoice") => "invoice.revised",
            _ => return Err("unsupported_event"),
        },
        "invoice_dispatch" => "invoice.dispatch_observed",
        "payments" | "payouts" | "refunds" => {
            let (prefix, allowed): (&str, &[&str]) = match record["dataset"].as_str().unwrap() {
                "payments" => ("payment", &["authorized", "captured", "failed", "voided"]),
                "payouts" => ("payout", &["announced", "sent", "failed", "reversed"]),
                _ => ("refund", &["pending", "completed", "failed", "reversed"]),
            };
            let status = record["status"].as_str().ok_or("unsupported_event")?;
            if !allowed.contains(&status) {
                return Err("unsupported_event");
            }
            return Ok(format!("{prefix}.{status}"));
        }
        "payment_allocations" => "payment.allocation_recorded",
        "policy" => "business.rule_recorded",
        "cases" => "business.case_recorded",
        "provider_ledger" => "provider.ledger_posted",
        "positions" => "provider.balance_observed",
        "bank" => "bank.credit_booked",
        "holds" => match record["state"].as_str() {
            Some("released") => "provider.hold_released",
            Some("active") => "provider.hold_recorded",
            _ => return Err("unsupported_event"),
        },
        "returns" => "return.revised",
        "receipts" => "return.disposition_observed",
        "entitlements" => "refund.entitlement_recorded",
        "disputes" => "dispute.opened",
        "coverage" => "coverage.observed",
        "identity" => "entity.link_recorded",
        _ => return Err("unsupported_event"),
    };
    Ok(kind.to_owned())
}

pub fn validate(observation: &Observation) -> Result<(), &'static str> {
    if let Some(record) = &observation.record {
        if record_kind(record)? != observation.kind {
            return Err("unsupported_event");
        }
    } else if ![
        "order.accepted",
        "order.revised",
        "payment.authorized",
        "payment.captured",
        "payment.failed",
        "payment.voided",
        "refund.completed",
        "refund.pending",
        "inventory.snapshot",
        "inventory.reserved",
        "inventory.reservation_released",
        "invoice.issued",
        "invoice.credit_issued",
        "invoice.payment_marked",
        "payment.fee_booked",
        "shipment.dispatched",
        "shipment.delivered",
        "return.approved",
        "return.received",
        "return.restocked",
        "payout.announced",
        "payout.sent",
        "payout.failed",
        "payout.reversed",
        "bank.credit_booked",
    ]
    .contains(&observation.kind.as_str())
    {
        return Err("unsupported_event");
    }
    Ok(())
}

pub fn source(
    version: i32,
    event_type: &str,
    entity: &str,
    observation: &Observation,
) -> Result<(), &'static str> {
    if version != 1 {
        return Err("unsupported_event_version");
    }
    if event_type != observation.kind || entity != observation.entity_id {
        return Err("unsupported_event");
    }
    validate(observation)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn event(kind: &str, record: Option<Value>) -> Observation {
        Observation {
            id: "observation".into(),
            entity_id: "entity".into(),
            kind: kind.into(),
            occurred_at: "2026-10-31T12:00:00Z".into(),
            currency: "EUR".into(),
            amount_minor: 100,
            economic_id: "effect".into(),
            supersedes_entry_id: None,
            test: false,
            quantity: None,
            details: None,
            record,
        }
    }
    #[test]
    fn unsupported_kind_version_and_header_identity_are_explicit_failures() {
        let known = event("payment.captured", None);
        assert!(source(1, "payment.captured", "entity", &known).is_ok());
        assert_eq!(
            source(2, "payment.captured", "entity", &known),
            Err("unsupported_event_version")
        );
        assert!(source(1, "payment.authorized", "entity", &known).is_err());
        assert!(source(1, "payment.captured", "other", &known).is_err());
        assert_eq!(
            validate(&event("future.payment_settled", None)),
            Err("unsupported_event")
        );
    }
    #[test]
    fn typed_reader_requires_known_dataset_status_and_matching_event_kind() {
        assert!(
            validate(&event(
                "payment.captured",
                Some(json!({"dataset":"payments","status":"captured"}))
            ))
            .is_ok()
        );
        assert!(
            validate(&event(
                "payment.captured",
                Some(json!({"dataset":"future_cash","status":"captured"}))
            ))
            .is_err()
        );
        assert!(
            validate(&event(
                "payment.future",
                Some(json!({"dataset":"payments","status":"future"}))
            ))
            .is_err()
        );
        assert!(
            validate(&event(
                "payment.captured",
                Some(json!({"dataset":"payments","status":"authorized"}))
            ))
            .is_err()
        );
        assert!(
            validate(&event(
                "provider.hold_released",
                Some(json!({"dataset":"holds","state":"released"}))
            ))
            .is_ok()
        );
        assert!(
            validate(&event(
                "refund.reversed",
                Some(json!({"dataset":"refunds","status":"reversed"}))
            ))
            .is_ok()
        );
    }
}

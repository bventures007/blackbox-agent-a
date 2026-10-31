//! Deterministic lifecycle effects. Input is an observation, never a calculated answer.
use crate::{Input, State};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Details {
    pub item_id: Option<String>,
    pub location_id: Option<String>,
    pub related_id: Option<String>,
    pub unit: Option<String>,
    pub physical: Option<String>,
    pub quarantined: Option<String>,
    pub reserved: Option<String>,
    pub provider_available: Option<String>,
    pub basis: Option<String>,
    pub released_quantity: Option<String>,
    pub destination: Option<String>,
    pub booking_status: Option<String>,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Inventory {
    pub item_id: String,
    pub location_id: String,
    pub unit: String,
    pub physical_stock: Option<String>,
    pub quarantined_stock: Option<String>,
    pub reserved_stock: Option<String>,
    pub available_stock: Option<String>,
    pub basis: String,
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
pub struct Lifecycle {
    pub inventory: Vec<Inventory>,
    pub invoice_original_minor: i64,
    pub invoice_credit_minor: i64,
    pub invoice_net_minor: i64,
    pub reported_paid_minor: i64,
    pub open_receivable_minor: Option<i64>,
    pub refund_payable_minor: Option<i64>,
    pub fees_minor: i64,
    pub provider_balance_minor: i64,
    pub provider_held_minor: i64,
    pub provider_available_minor: i64,
    pub payout_announced_minor: i64,
    pub in_transit_minor: i64,
    pub bank_confirmed_minor: i64,
    pub shipment_status: String,
    pub observed_only: bool,
}
pub fn micros(s: &str) -> Result<i64, String> {
    let (whole, fraction) = s.split_once('.').unwrap_or((s, ""));
    if whole.is_empty()
        || whole.len() > 12
        || fraction.len() > 6
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return Err("invalid_quantity".into());
    }
    let w: i64 = whole.parse().map_err(|_| "invalid_quantity")?;
    let f: i64 = if fraction.is_empty() {
        0
    } else {
        fraction.parse().map_err(|_| "invalid_quantity")?
    };
    w.checked_mul(1_000_000)
        .and_then(|x| x.checked_add(f * 10i64.pow(6 - fraction.len() as u32)))
        .ok_or("quantity_overflow".into())
}
pub fn decimal(n: i64) -> String {
    let sign = if n < 0 { "-" } else { "" };
    let v = n.unsigned_abs();
    let f = format!("{:06}", v % 1_000_000);
    let f = f.trim_end_matches('0');
    if f.is_empty() {
        format!("{sign}{}", v / 1_000_000)
    } else {
        format!("{sign}{}.{f}", v / 1_000_000)
    }
}
fn add(a: i64, b: i64) -> Result<i64, String> {
    a.checked_add(b).ok_or("domain_overflow".into())
}
fn sub(a: i64, b: i64) -> Result<i64, String> {
    a.checked_sub(b).ok_or("domain_overflow".into())
}
fn amount(inputs: &[&Input], kind: &str) -> Result<i64, String> {
    inputs
        .iter()
        .filter(|x| x.observation.kind == kind)
        .try_fold(0, |n, x| add(n, x.observation.amount_minor))
}
fn qty(x: &Input) -> Result<i64, String> {
    micros(
        x.observation
            .quantity
            .as_deref()
            .ok_or("quantity_missing")?,
    )
}
fn detail(x: &Input) -> Result<&Details, String> {
    x.observation
        .details
        .as_ref()
        .ok_or("details_missing".into())
}
fn family_latest<'a>(
    inputs: &[&'a Input],
    prefix: &str,
    version: &str,
) -> BTreeMap<&'a str, &'a Input> {
    let mut m = BTreeMap::new();
    for x in inputs
        .iter()
        .filter(|x| x.observation.kind.starts_with(prefix))
    {
        let id = x.observation.economic_id.as_str();
        if m.get(id)
            .is_none_or(|old: &&Input| !crate::occurrence_cmp(old, x, version).is_gt())
        {
            m.insert(id, *x);
        }
    }
    m
}
pub(crate) fn reduce(inputs: &[&Input], payment: &State) -> Result<Lifecycle, String> {
    let version = payment.rule_version.as_str();
    let mut out = Lifecycle {
        observed_only: true,
        shipment_status: "unknown".into(),
        ..Default::default()
    };
    out.invoice_original_minor = amount(inputs, "invoice.issued")?;
    out.invoice_credit_minor = amount(inputs, "invoice.credit_issued")?;
    // Markers are reported receivable state, not additional cash.
    let mut reported: BTreeMap<&str, &Input> = BTreeMap::new();
    for x in inputs
        .iter()
        .filter(|x| x.observation.kind == "invoice.payment_marked")
    {
        let invoice = detail(x)?
            .related_id
            .as_deref()
            .ok_or("invoice_link_missing")?;
        if reported
            .get(invoice)
            .is_none_or(|old| !crate::occurrence_cmp(old, x, version).is_gt())
        {
            reported.insert(invoice, x);
        }
    }
    out.reported_paid_minor = reported
        .values()
        .try_fold(0, |n, x| add(n, x.observation.amount_minor))?;
    out.invoice_net_minor = sub(out.invoice_original_minor, out.invoice_credit_minor)?;
    if inputs
        .iter()
        .any(|x| x.observation.kind == "invoice.issued")
    {
        out.open_receivable_minor =
            Some(sub(out.invoice_net_minor, out.reported_paid_minor)?.max(0));
        // An evidenced credit against an already paid invoice yields a payable, never a cash movement.
        out.refund_payable_minor = Some(
            sub(
                sub(out.reported_paid_minor, out.invoice_net_minor)?.max(0),
                payment.refunded_minor,
            )?
            .max(0),
        );
    }
    out.fees_minor = amount(inputs, "payment.fee_booked")?;
    let refunds = family_latest(inputs, "refund.", version);
    out.provider_held_minor = refunds
        .values()
        .filter(|x| x.observation.kind == "refund.pending")
        .try_fold(0, |n, x| add(n, x.observation.amount_minor))?;
    let payouts = family_latest(inputs, "payout.", version);
    let mut sent = 0;
    for x in payouts.values() {
        match x.observation.kind.as_str() {
            "payout.announced" => {
                out.payout_announced_minor =
                    add(out.payout_announced_minor, x.observation.amount_minor)?
            }
            "payout.sent" => sent = add(sent, x.observation.amount_minor)?,
            _ => {}
        }
    }
    let mut booked: BTreeMap<&str, i64> = BTreeMap::new();
    for x in inputs
        .iter()
        .filter(|x| x.observation.kind == "bank.credit_booked")
    {
        let d = detail(x)?;
        if d.booking_status.as_deref() != Some("booked") {
            continue;
        }
        let payout = d.related_id.as_deref().ok_or("payout_link_missing")?;
        booked.insert(
            payout,
            add(
                *booked.get(payout).unwrap_or(&0),
                x.observation.amount_minor,
            )?,
        );
    }
    for (payout, n) in booked {
        if let Some(p) = payouts.get(payout) {
            // A reference is necessary but not sufficient: amounts/currency must agree exactly.
            if p.observation.kind == "payout.sent" && p.observation.amount_minor == n {
                out.bank_confirmed_minor = add(out.bank_confirmed_minor, n)?;
            }
        }
    }
    out.in_transit_minor = sub(sent, out.bank_confirmed_minor)?;
    out.provider_balance_minor = sub(
        sub(
            sub(payment.captured_minor, out.fees_minor)?,
            payment.refunded_minor,
        )?,
        sent,
    )?;
    out.provider_available_minor = sub(out.provider_balance_minor, out.provider_held_minor)?;
    let dispatched: Vec<_> = inputs
        .iter()
        .filter(|x| x.observation.kind == "shipment.dispatched")
        .collect();
    if !dispatched.is_empty() {
        out.shipment_status = if dispatched.iter().all(|s| {
            inputs.iter().any(|d| {
                d.observation.kind == "shipment.delivered"
                    && d.observation
                        .details
                        .as_ref()
                        .and_then(|d| d.related_id.as_ref())
                        == Some(&s.observation.economic_id)
            })
        }) {
            "delivered"
        } else {
            "dispatched"
        }
        .into();
    }
    let mut stocks: BTreeMap<(&str, &str, &str), Vec<&Input>> = BTreeMap::new();
    for x in inputs {
        if let Some(d) = &x.observation.details {
            if let (Some(item), Some(location), Some(unit)) = (&d.item_id, &d.location_id, &d.unit)
            {
                stocks.entry((item, location, unit)).or_default().push(x);
            }
        }
    }
    for ((item, location, unit), events) in stocks {
        let Some(snapshot) = events
            .iter()
            .filter(|x| x.observation.kind == "inventory.snapshot")
            .max_by(|a, b| crate::occurrence_cmp(a, b, version))
        else {
            continue;
        };
        let d = detail(snapshot)?;
        let mut result = Inventory {
            item_id: item.into(),
            location_id: location.into(),
            unit: unit.into(),
            basis: d.basis.clone().ok_or("stock_basis_missing")?,
            ..Default::default()
        };
        let following: Vec<_> = events
            .iter()
            .filter(|x| crate::occurrence_cmp(x, snapshot, version).is_gt())
            .collect();
        if result.basis == "provider_available" {
            // An already-net provider snapshot must never have its reservations subtracted twice.
            result.available_stock = Some(decimal(micros(
                d.provider_available.as_deref().ok_or("available_missing")?,
            )?));
            if !following.is_empty() {
                result.available_stock = None;
                result.basis = "snapshot_followed_by_unreconciled_effects".into();
            }
        } else {
            let mut physical = micros(d.physical.as_deref().ok_or("physical_missing")?)?;
            let mut quarantine = micros(d.quarantined.as_deref().ok_or("quarantine_missing")?)?;
            let mut reserved = micros(d.reserved.as_deref().ok_or("reserved_missing")?)?;
            for x in following {
                match x.observation.kind.as_str() {
                    "inventory.reserved" => reserved = add(reserved, qty(x)?)?,
                    "inventory.reservation_released" => reserved = sub(reserved, qty(x)?)?,
                    "shipment.dispatched" => {
                        physical = sub(physical, qty(x)?)?;
                        if let Some(q) = &detail(x)?.released_quantity {
                            reserved = sub(reserved, micros(q)?)?;
                        }
                    }
                    "return.received" => {
                        physical = add(physical, qty(x)?)?;
                        quarantine = add(quarantine, qty(x)?)?;
                    }
                    "return.restocked" => quarantine = sub(quarantine, qty(x)?)?,
                    _ => {}
                }
            }
            result.physical_stock = Some(decimal(physical));
            result.quarantined_stock = Some(decimal(quarantine));
            result.reserved_stock = Some(decimal(reserved));
            result.available_stock = Some(decimal(sub(sub(physical, quarantine)?, reserved)?));
        }
        out.inventory.push(result);
    }
    Ok(out)
}

/// A delivery observation cannot establish delivery before physical dispatch.
/// Parse instants rather than comparing strings with different fractional precision.
pub(crate) fn verify_delivery_order(inputs: &[&Input], state: &mut State) -> Result<(), String> {
    let dispatched: Vec<_> = inputs
        .iter()
        .filter(|x| x.observation.kind == "shipment.dispatched")
        .collect();
    if dispatched.is_empty() {
        return Ok(());
    }
    let mut complete = true;
    let mut invalid = false;
    for shipment in dispatched {
        let sent = chrono::DateTime::parse_from_rfc3339(&shipment.observation.occurred_at)
            .map_err(|_| "invalid_timestamp")?;
        let mut delivered = false;
        for confirmation in inputs.iter().filter(|x| {
            x.observation.kind == "shipment.delivered"
                && x.observation
                    .details
                    .as_ref()
                    .and_then(|d| d.related_id.as_ref())
                    == Some(&shipment.observation.economic_id)
        }) {
            let at = chrono::DateTime::parse_from_rfc3339(&confirmation.observation.occurred_at)
                .map_err(|_| "invalid_timestamp")?;
            if at < sent {
                invalid = true;
            } else {
                delivered = true;
            }
        }
        complete &= delivered;
    }
    state.lifecycle.shipment_status = if complete { "delivered" } else { "dispatched" }.into();
    if invalid {
        state.conflicts.push("delivery_precedes_dispatch".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_quantities() {
        for value in ["0", "112", "0.000001", "999999999999.999999", "12.345678"] {
            assert_eq!(decimal(micros(value).unwrap()), value)
        }
        assert!(micros("1.0000001").is_err());
        assert!(micros("NaN").is_err());
    }
}

use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
pub const RULE_VERSION: &str = "payment-v1";
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Observation {
    pub id: String,
    pub entity_id: String,
    pub kind: String,
    pub occurred_at: String,
    pub currency: String,
    pub amount_minor: i64,
    pub economic_id: String,
    pub supersedes_entry_id: Option<String>,
    pub test: bool,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Input {
    pub entry_id: String,
    pub sequence: i64,
    pub evidence_id: String,
    pub observation: Observation,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct State {
    pub currency: Option<String>,
    pub agreed_minor: Option<i64>,
    pub authorized_minor: i64,
    pub captured_minor: i64,
    pub refunded_minor: i64,
    pub customer_net_paid_minor: i64,
    pub outstanding_minor: Option<i64>,
    pub payment_status: String,
    pub evidence: Vec<String>,
    pub input_entries: Vec<String>,
    pub conflicts: Vec<String>,
    pub test_data: bool,
    pub rule_version: String,
}
fn sum<'a>(mut values: impl Iterator<Item = &'a Input>) -> Result<i64, String> {
    values.try_fold(0i64, |n, e| {
        n.checked_add(e.observation.amount_minor)
            .ok_or("money_overflow".into())
    })
}
pub fn reduce(inputs: &[Input]) -> Result<State, String> {
    let mut conflicts = vec![];
    let superseded: BTreeSet<_> = inputs
        .iter()
        .filter_map(|x| x.observation.supersedes_entry_id.as_ref())
        .collect();
    let mut latest: BTreeMap<(&str, &str), &Input> = BTreeMap::new();
    for input in inputs.iter().filter(|x| !superseded.contains(&x.entry_id)) {
        let e = &input.observation;
        if e.amount_minor < 0 {
            return Err("negative_money".into());
        }
        let key = (e.kind.as_str(), e.economic_id.as_str());
        if let Some(old) = latest.get(&key) {
            if (old.observation.occurred_at.as_str(), old.sequence)
                > (e.occurred_at.as_str(), input.sequence)
            {
                continue;
            }
        }
        latest.insert(key, input);
    }
    let currencies: BTreeSet<_> = latest
        .values()
        .map(|x| x.observation.currency.clone())
        .collect();
    if currencies.len() > 1 {
        return Err("currency_conflict".into());
    }
    let currency = currencies.into_iter().next();
    let order = latest
        .values()
        .filter(|x| {
            matches!(
                x.observation.kind.as_str(),
                "order.accepted" | "order.revised"
            )
        })
        .max_by_key(|x| (&x.observation.occurred_at, x.sequence));
    let agreed_minor = order.map(|x| x.observation.amount_minor);
    let authorized_minor = sum(latest
        .values()
        .copied()
        .filter(|x| x.observation.kind == "payment.authorized"))?;
    let captured_minor = sum(latest
        .values()
        .copied()
        .filter(|x| x.observation.kind == "payment.captured"))?;
    let refunded_minor = sum(latest
        .values()
        .copied()
        .filter(|x| x.observation.kind == "refund.completed"))?;
    let net = captured_minor
        .checked_sub(refunded_minor)
        .ok_or("money_overflow")?;
    if refunded_minor > captured_minor {
        conflicts.push("refund_exceeds_observed_captures".into());
    }
    let outstanding_minor = agreed_minor.map(|n| (n - net).max(0));
    let payment_status = if !conflicts.is_empty() {
        "conflict"
    } else if agreed_minor.is_none() {
        "unknown"
    } else if net >= agreed_minor.unwrap() {
        "paid"
    } else if captured_minor > 0 {
        "partially_paid"
    } else if authorized_minor > 0 {
        "authorized_only"
    } else {
        "awaiting_payment"
    }
    .into();
    Ok(State {
        currency,
        agreed_minor,
        authorized_minor,
        captured_minor,
        refunded_minor,
        customer_net_paid_minor: net,
        outstanding_minor,
        payment_status,
        evidence: inputs
            .iter()
            .map(|x| x.evidence_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect(),
        input_entries: inputs.iter().map(|x| x.entry_id.clone()).collect(),
        conflicts,
        test_data: inputs.iter().any(|x| x.observation.test),
        rule_version: RULE_VERSION.into(),
    })
}
pub fn derived_tracks(kind: &str) -> &'static [&'static str] {
    match kind {
        "order.accepted" | "order.revised" => &["fact", "commitment"],
        "payment.captured" | "refund.completed" => &["fact", "movement"],
        "refund.pending" => &["fact", "reservation"],
        _ => &["fact"],
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn entry(n: i64, kind: &str, amount: i64) -> Input {
        Input {
            entry_id: n.to_string(),
            sequence: n,
            evidence_id: format!("e{n}"),
            observation: Observation {
                id: n.to_string(),
                entity_id: "a".into(),
                kind: kind.into(),
                occurred_at: format!("2026-10-31T09:{n:02}:00Z"),
                currency: "EUR".into(),
                amount_minor: amount,
                economic_id: n.to_string(),
                supersedes_entry_id: None,
                test: true,
            },
        }
    }
    #[test]
    fn authorization_is_not_cash() {
        let s = reduce(&[
            entry(1, "order.accepted", 4321),
            entry(2, "payment.authorized", 4321),
        ])
        .unwrap();
        assert_eq!(s.captured_minor, 0);
        assert_eq!(s.outstanding_minor, Some(4321));
    }
    #[test]
    fn generalized_partial_refund() {
        for amount in [1, 11900, 85731, 999999] {
            let s = reduce(&[
                entry(1, "order.accepted", amount),
                entry(2, "payment.captured", amount),
                entry(3, "refund.completed", amount / 3),
            ])
            .unwrap();
            assert_eq!(s.customer_net_paid_minor, amount - amount / 3);
            assert_eq!(s.outstanding_minor, Some(amount / 3));
        }
    }
    #[test]
    fn correction_and_duplicate() {
        let a = entry(1, "order.accepted", 1000);
        let mut b = entry(2, "order.revised", 700);
        b.observation.supersedes_entry_id = Some("1".into());
        let c = entry(3, "payment.captured", 500);
        assert_eq!(
            reduce(&[a.clone(), b.clone(), c.clone(), c])
                .unwrap()
                .outstanding_minor,
            Some(200)
        );
        assert_eq!(reduce(&[a]).unwrap().outstanding_minor, Some(1000));
    }
    #[test]
    fn currencies_are_never_added() {
        let a = entry(1, "order.accepted", 100);
        let mut b = entry(2, "payment.captured", 100);
        b.observation.currency = "USD".into();
        assert_eq!(reduce(&[a, b]).unwrap_err(), "currency_conflict");
    }
}

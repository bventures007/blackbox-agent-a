use serde::{Deserialize, Serialize};
use std::fmt;

/// Integer minor currency units with an explicit ISO-4217 code. Different currencies never add.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct Money { pub minor: i64, pub currency: String }

impl Money {
    pub fn new(minor: i64, currency: &str) -> Self { Self { minor, currency: currency.to_string() } }
    pub fn checked_add(&self, other: &Money) -> Result<Money, MoneyError> {
        if self.currency != other.currency { return Err(MoneyError::CurrencyMismatch(self.currency.clone(), other.currency.clone())); }
        Ok(Money { minor: self.minor.checked_add(other.minor).ok_or(MoneyError::Overflow)?, currency: self.currency.clone() })
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum MoneyError {
    #[error("currency mismatch: {0} vs {1}")] CurrencyMismatch(String, String),
    #[error("integer overflow")] Overflow,
}

/// Decimal quantity stored as micro-units (six fractional digits) with an explicit unit.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, Default, Hash)]
pub struct Qty(pub i64);

pub const MICRO: i64 = 1_000_000;

impl Qty {
    pub const ZERO: Qty = Qty(0);
    pub fn from_units(n: i64) -> Qty { Qty(n * MICRO) }
    pub fn parse(s: &str) -> Result<Qty, QtyError> {
        let s = s.trim();
        let (neg, body) = match s.strip_prefix('-') { Some(b) => (true, b), None => (false, s) };
        if body.is_empty() { return Err(QtyError::Invalid(s.to_string())); }
        let (int_part, frac_part) = match body.split_once('.') { Some((i, f)) => (i, f), None => (body, "") };
        if int_part.is_empty() && frac_part.is_empty() { return Err(QtyError::Invalid(s.to_string())); }
        if frac_part.len() > 6 || !int_part.chars().all(|c| c.is_ascii_digit()) || !frac_part.chars().all(|c| c.is_ascii_digit()) {
            return Err(QtyError::Invalid(s.to_string()));
        }
        let int_v: i64 = if int_part.is_empty() { 0 } else { int_part.parse().map_err(|_| QtyError::Invalid(s.to_string()))? };
        let mut frac = frac_part.to_string();
        while frac.len() < 6 { frac.push('0'); }
        let frac_v: i64 = if frac.is_empty() { 0 } else { frac.parse().map_err(|_| QtyError::Invalid(s.to_string()))? };
        let total = int_v.checked_mul(MICRO).and_then(|v| v.checked_add(frac_v)).ok_or(QtyError::Overflow)?;
        Ok(Qty(if neg { -total } else { total }))
    }
    pub fn checked_add(self, o: Qty) -> Result<Qty, QtyError> { self.0.checked_add(o.0).map(Qty).ok_or(QtyError::Overflow) }
    pub fn checked_sub(self, o: Qty) -> Result<Qty, QtyError> { self.0.checked_sub(o.0).map(Qty).ok_or(QtyError::Overflow) }
    pub fn saturating_sub_floor0(self, o: Qty) -> Qty { Qty((self.0 - o.0).max(0)) }
    pub fn min(self, o: Qty) -> Qty { if self.0 <= o.0 { self } else { o } }
    pub fn is_zero(self) -> bool { self.0 == 0 }
    pub fn is_negative(self) -> bool { self.0 < 0 }
}

impl fmt::Display for Qty {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let neg = self.0 < 0; let v = self.0.abs();
        let int = v / MICRO; let frac = v % MICRO;
        if frac == 0 { return write!(f, "{}{}", if neg { "-" } else { "" }, int); }
        let fs = format!("{:06}", frac); let fs = fs.trim_end_matches('0');
        write!(f, "{}{}.{}", if neg { "-" } else { "" }, int, fs)
    }
}

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum QtyError {
    #[error("invalid quantity {0}")] Invalid(String),
    #[error("quantity overflow")] Overflow,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn parse_and_format() {
        assert_eq!(Qty::parse("10").unwrap(), Qty::from_units(10));
        assert_eq!(Qty::parse("2.5").unwrap().to_string(), "2.5");
        assert_eq!(Qty::parse("0.000001").unwrap(), Qty(1));
        assert!(Qty::parse("1.2345678").is_err());
        assert!(Qty::parse("1e3").is_err());
        assert_eq!(Qty::parse("-3").unwrap().to_string(), "-3");
    }
    #[test] fn money_refuses_mixed_currency() {
        assert!(Money::new(1, "EUR").checked_add(&Money::new(1, "USD")).is_err());
    }
}

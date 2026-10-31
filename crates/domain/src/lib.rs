//! Canonical deterministic business rules for the Blackbox local pilot.
//! This crate is pure: no I/O, no clocks, no randomness. TypeScript orchestrates; nothing here is duplicated there.
pub mod money;
pub mod payloads;
pub mod entry;
pub mod derive;
pub mod derived;
pub mod state;

pub const RULE_VERSION: &str = "r1";
pub const SCHEMA_VERSION: i32 = 1;

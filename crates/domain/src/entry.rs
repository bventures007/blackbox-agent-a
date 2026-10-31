use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum RecordType { Source, Fact, Commitment, Movement, Reservation }

impl RecordType {
    pub fn as_str(&self) -> &'static str { match self { RecordType::Source => "source", RecordType::Fact => "fact", RecordType::Commitment => "commitment", RecordType::Movement => "movement", RecordType::Reservation => "reservation" } }
    pub fn parse(s: &str) -> Option<RecordType> { match s { "source" => Some(RecordType::Source), "fact" => Some(RecordType::Fact), "commitment" => Some(RecordType::Commitment), "movement" => Some(RecordType::Movement), "reservation" => Some(RecordType::Reservation), _ => None } }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct EntityRef { #[serde(rename = "type")] pub kind: String, pub id: String }

/// A committed journal entry as read from PostgreSQL.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct JournalEntry {
    pub entry_id: Uuid,
    pub tenant_id: Uuid,
    pub journal_sequence: i64,
    pub record_type: RecordType,
    pub record_id: String,
    pub event_type: String,
    pub schema_version: i32,
    pub connection_id: Option<Uuid>,
    pub provider_namespace: Option<String>,
    pub dedup_key: String,
    pub occurred_at: chrono::DateTime<chrono::Utc>,
    pub recorded_at: chrono::DateTime<chrono::Utc>,
    pub entity_refs: Vec<EntityRef>,
    pub payload: Value,
    pub evidence_refs: Vec<String>,
    pub input_entry_ids: Vec<Uuid>,
    pub rule_version: Option<String>,
    pub supersedes_entry_id: Option<Uuid>,
    pub correlation_id: Option<String>,
    pub causation_id: Option<String>,
}

/// An entry to append (derived by the engine). Mirrors JournalEntryInput in packages/contracts.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct EntryInput {
    pub record_type: RecordType,
    pub record_id: String,
    pub event_type: String,
    pub schema_version: i32,
    pub connection_id: Option<Uuid>,
    pub provider_namespace: Option<String>,
    pub dedup_key: String,
    pub occurred_at: chrono::DateTime<chrono::Utc>,
    pub entity_refs: Vec<EntityRef>,
    pub payload: Value,
    pub evidence_refs: Vec<String>,
    pub input_entry_ids: Vec<Uuid>,
    pub rule_version: Option<String>,
    pub supersedes_entry_id: Option<Uuid>,
    pub correlation_id: Option<String>,
    pub causation_id: Option<String>,
}

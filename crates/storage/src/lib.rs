//! PostgreSQL access for the engine: journal reads, derived appends through journal_append, checkpoints, entity history
//! for cold hydration, snapshot files and quarantine records. The engine role can only SELECT/INSERT journal rows.
use anyhow::{anyhow, Context, Result};
use bbx_domain::derived::{Derived, EntityKind};
use bbx_domain::entry::{EntityRef, EntryInput, JournalEntry, RecordType};
use bbx_domain::state::{ApplyMeta, EntityState};
use bbx_projections::Snapshot;
use deadpool_postgres::{Config, ManagerConfig, Pool, RecyclingMethod, Runtime};
use std::path::{Path, PathBuf};
use tokio_postgres::{NoTls, Row};
use uuid::Uuid;

#[derive(Clone)]
pub struct Store { pool: Pool }

#[derive(Clone, Debug)]
pub struct Checkpoint { pub tenant_id: Uuid, pub applied_sequence: i64, pub reducer_version: String, pub schema_version: i32, pub snapshot_path: Option<String>, pub snapshot_sha256: Option<String> }

#[derive(Clone, Debug)]
pub struct TenantRow { pub tenant_id: Uuid, pub name: String, pub kind: String }

fn row_to_entry(r: &Row) -> Result<JournalEntry> {
    let refs: serde_json::Value = r.try_get("entity_refs")?;
    let entity_refs: Vec<EntityRef> = serde_json::from_value(refs).unwrap_or_default();
    let evidence: serde_json::Value = r.try_get("evidence_refs")?;
    Ok(JournalEntry {
        entry_id: r.try_get("entry_id")?, tenant_id: r.try_get("tenant_id")?, journal_sequence: r.try_get("journal_sequence")?,
        record_type: RecordType::parse(r.try_get::<_, String>("record_type")?.as_str()).ok_or_else(|| anyhow!("bad record_type"))?,
        record_id: r.try_get("record_id")?, event_type: r.try_get("event_type")?, schema_version: r.try_get("schema_version")?,
        connection_id: r.try_get("connection_id")?, provider_namespace: r.try_get("provider_namespace")?, dedup_key: r.try_get("dedup_key")?,
        occurred_at: r.try_get("occurred_at")?, recorded_at: r.try_get("recorded_at")?, entity_refs, payload: r.try_get("payload")?,
        evidence_refs: serde_json::from_value(evidence).unwrap_or_default(), input_entry_ids: r.try_get("input_entry_ids")?, rule_version: r.try_get("rule_version")?,
        supersedes_entry_id: r.try_get("supersedes_entry_id")?, correlation_id: r.try_get("correlation_id")?, causation_id: r.try_get("causation_id")?,
    })
}

const ENTRY_COLS: &str = "entry_id, tenant_id, journal_sequence, record_type, record_id, event_type, schema_version, connection_id, provider_namespace, dedup_key, occurred_at, recorded_at, entity_refs, payload, evidence_refs, input_entry_ids, rule_version, supersedes_entry_id, correlation_id, causation_id";

impl Store {
    pub fn connect(url: &str, max: usize) -> Result<Store> {
        let mut cfg = Config::new();
        cfg.url = Some(url.to_string());
        cfg.manager = Some(ManagerConfig { recycling_method: RecyclingMethod::Clean });
        cfg.pool = Some(deadpool_postgres::PoolConfig::new(max));
        let pool = cfg.create_pool(Some(Runtime::Tokio1), NoTls).context("engine pool")?;
        Ok(Store { pool })
    }
    pub async fn ping(&self) -> Result<()> { let c = self.pool.get().await?; c.simple_query("SELECT 1").await?; Ok(()) }

    pub async fn list_tenants(&self) -> Result<Vec<TenantRow>> {
        let c = self.pool.get().await?;
        let rows = c.query("SELECT tenant_id, name, kind FROM tenants ORDER BY created_at", &[]).await?;
        Ok(rows.iter().map(|r| TenantRow { tenant_id: r.get(0), name: r.get(1), kind: r.get(2) }).collect())
    }
    pub async fn high_water(&self, tenant: Uuid) -> Result<i64> {
        let c = self.pool.get().await?;
        let row = c.query_opt("SELECT next_sequence - 1 FROM tenant_sequences WHERE tenant_id = $1", &[&tenant]).await?;
        Ok(row.map(|r| r.get::<_, i64>(0)).unwrap_or(0))
    }
    /// Committed entries strictly after `after`, in sequence order. Engine scope reads across tenants are allowed by RLS.
    pub async fn fetch_batch(&self, tenant: Uuid, after: i64, limit: i64) -> Result<Vec<JournalEntry>> {
        let c = self.pool.get().await?;
        c.batch_execute("SELECT set_config('app.scope', 'engine', false), set_config('app.tenant_id', '', false)").await?;
        let rows = c.query(&format!("SELECT {ENTRY_COLS} FROM journal_entries WHERE tenant_id = $1 AND journal_sequence > $2 ORDER BY journal_sequence LIMIT $3"), &[&tenant, &after, &limit]).await?;
        rows.iter().map(row_to_entry).collect()
    }
    /// Derived entries linked to one entity up to and including `max_sequence`, for cold hydration and as-of folds.
    /// Entity history up to a journal position. Derived facts whose SOURCE lies at or before that position are included even
    /// when their own sequence is higher (they were appended after their source): resolution reflects causal order, not batching.
    pub async fn entity_history(&self, tenant: Uuid, kind: EntityKind, id: &str, max_sequence: i64, derived_only: bool) -> Result<Vec<JournalEntry>> {
        let c = self.pool.get().await?;
        c.batch_execute("SELECT set_config('app.scope', 'engine', false), set_config('app.tenant_id', '', false)").await?;
        let sql = format!("SELECT {} FROM journal_entity_links l JOIN journal_entries je ON je.entry_id = l.entry_id WHERE l.tenant_id = $1 AND l.entity_type = $2 AND l.entity_id = $3 AND (l.journal_sequence <= $4 OR (je.record_type <> 'source' AND EXISTS (SELECT 1 FROM journal_entries s WHERE s.tenant_id = je.tenant_id AND s.entry_id = ANY(je.input_entry_ids) AND s.journal_sequence <= $4))) {} ORDER BY l.journal_sequence LIMIT 20000",
            ENTRY_COLS.split(", ").map(|c| format!("je.{c}")).collect::<Vec<_>>().join(", "), if derived_only { "AND je.record_type <> 'source'" } else { "" });
        let rows = c.query(&sql, &[&tenant, &kind.as_str(), &id, &max_sequence]).await?;
        rows.iter().map(row_to_entry).collect()
    }
    /// Append derived entries inside one transaction through the shared journal_append boundary.
    pub async fn append_derived(&self, tenant: Uuid, inputs: &[EntryInput]) -> Result<Vec<(Uuid, i64, bool)>> {
        if inputs.is_empty() { return Ok(vec![]); }
        let mut c = self.pool.get().await?;
        let tx = c.transaction().await?;
        tx.execute("SELECT set_config('app.tenant_id', $1, true), set_config('app.scope', 'engine', true)", &[&tenant.to_string()]).await?;
        let payload = serde_json::to_value(inputs)?;
        let rows = tx.query("SELECT entry_id, journal_sequence, inserted FROM journal_append($1, $2)", &[&tenant, &payload]).await.context("journal_append")?;
        tx.commit().await?;
        Ok(rows.iter().map(|r| (r.get(0), r.get(1), r.get(2))).collect())
    }
    pub async fn load_checkpoint(&self, tenant: Uuid) -> Result<Option<Checkpoint>> {
        let c = self.pool.get().await?;
        let row = c.query_opt("SELECT applied_sequence, reducer_version, schema_version, snapshot_path, snapshot_sha256 FROM engine_checkpoints WHERE tenant_id = $1", &[&tenant]).await?;
        Ok(row.map(|r| Checkpoint { tenant_id: tenant, applied_sequence: r.get(0), reducer_version: r.get(1), schema_version: r.get(2), snapshot_path: r.get(3), snapshot_sha256: r.get(4) }))
    }
    pub async fn save_checkpoint(&self, cp: &Checkpoint) -> Result<()> {
        let c = self.pool.get().await?;
        c.execute("INSERT INTO engine_checkpoints (tenant_id, applied_sequence, reducer_version, schema_version, snapshot_path, snapshot_sha256, written_at) VALUES ($1,$2,$3,$4,$5,$6, now()) ON CONFLICT (tenant_id) DO UPDATE SET applied_sequence = EXCLUDED.applied_sequence, reducer_version = EXCLUDED.reducer_version, schema_version = EXCLUDED.schema_version, snapshot_path = EXCLUDED.snapshot_path, snapshot_sha256 = EXCLUDED.snapshot_sha256, written_at = now()",
            &[&cp.tenant_id, &cp.applied_sequence, &cp.reducer_version, &cp.schema_version, &cp.snapshot_path, &cp.snapshot_sha256]).await?;
        Ok(())
    }
    /// Record a quarantined input (unsupported event type or invalid payload) as an owner review case. Never fabricates business facts.
    pub async fn quarantine(&self, entry: &JournalEntry, reason_code: &str, detail: &str) -> Result<()> {
        let c = self.pool.get().await?;
        c.execute("SELECT set_config('app.tenant_id', $1, false), set_config('app.scope', 'engine', false)", &[&entry.tenant_id.to_string()]).await?;
        let case_id = Uuid::new_v4();
        let input_ref = serde_json::json!({"entry_id": entry.entry_id, "journal_sequence": entry.journal_sequence, "event_type": entry.event_type, "dedup_key": entry.dedup_key});
        let history = serde_json::json!([{"at": chrono::Utc::now().to_rfc3339(), "actor": "engine", "action": "quarantined", "detail": detail}]);
        c.execute("INSERT INTO review_cases (case_id, tenant_id, kind, state, revision, connection_id, input_ref, affected, reason_code, stage, history) VALUES ($1,$2,'quarantined_input','open',1,$3,$4,'{}'::jsonb,$5,'engine_derivation',$6)",
            &[&case_id, &entry.tenant_id, &entry.connection_id, &input_ref, &reason_code, &history]).await?;
        Ok(())
    }
}

/// Fold an entity's derived history into a fresh state (used for hydration and as-of answers).
pub fn fold_entity(kind: EntityKind, id: &str, entries: &[JournalEntry], effective_at: Option<chrono::DateTime<chrono::Utc>>) -> EntityState {
    let mut st = EntityState::new(kind, id);
    for e in entries {
        if e.record_type == RecordType::Source { continue; }
        if let Some(eff) = effective_at { if e.occurred_at > eff { continue; } }
        if let Ok(d) = serde_json::from_value::<Derived>(e.payload.clone()) { st.apply(&d, &ApplyMeta { entry_id: e.entry_id, sequence: e.journal_sequence, occurred_at: e.occurred_at, recorded_at: e.recorded_at }); }
    }
    st
}

pub fn snapshot_path(dir: &Path, tenant: Uuid, seq: i64) -> PathBuf { dir.join(tenant.to_string()).join(format!("{seq:020}.snap.json")) }

pub async fn write_snapshot(dir: &Path, snap: &Snapshot) -> Result<(PathBuf, String, usize)> {
    let (bytes, digest) = snap.encode().map_err(|e| anyhow!(e))?;
    let path = snapshot_path(dir, snap.tenant_id, snap.applied_sequence);
    tokio::fs::create_dir_all(path.parent().unwrap()).await?;
    let tmp = path.with_extension("tmp");
    tokio::fs::write(&tmp, &bytes).await?;
    tokio::fs::rename(&tmp, &path).await?;
    // keep the two newest snapshots per tenant
    let mut entries: Vec<PathBuf> = vec![];
    let mut rd = tokio::fs::read_dir(path.parent().unwrap()).await?;
    while let Some(e) = rd.next_entry().await? { let p = e.path(); if p.extension().map(|x| x == "json").unwrap_or(false) { entries.push(p); } }
    entries.sort();
    while entries.len() > 2 { let old = entries.remove(0); let _ = tokio::fs::remove_file(old).await; }
    Ok((path, digest, bytes.len()))
}

pub async fn read_snapshot(path: &Path, sha256: &str) -> Result<Snapshot> {
    let bytes = tokio::fs::read(path).await.with_context(|| format!("read snapshot {}", path.display()))?;
    Snapshot::decode(&bytes, sha256, bbx_domain::RULE_VERSION, bbx_domain::SCHEMA_VERSION).map_err(|e| anyhow!(e))
}

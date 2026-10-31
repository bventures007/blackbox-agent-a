//! Engine runtime: per-tenant apply loops (derive -> append -> fold -> publish), snapshots/checkpoints, hydration and queries.
use crate::logging::{Fields, Log};
use anyhow::Result;
use bbx_domain::derive::{derive, to_inputs};
use bbx_domain::derived::{Derived, EntityKind};
use bbx_domain::entry::RecordType;
use bbx_projections::{resolution_keys, Key, Snapshot, TenantState};
use bbx_query::{entity_view, run, NeedHydration, QueryInput};
use bbx_storage::{fold_entity, read_snapshot, write_snapshot, Checkpoint, Store};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::{Notify, RwLock, Semaphore};
use uuid::Uuid;

#[derive(Clone)]
pub struct EngineConfig { pub database_url: String, pub snapshot_dir: PathBuf, pub tenant_budget_bytes: usize, pub global_budget_bytes: usize, pub snapshot_every_entries: u64, pub snapshot_every_secs: u64, pub batch_size: i64, pub max_concurrent_queries: usize, pub version: String }

#[derive(Clone, Debug, Serialize, Default)]
pub struct TenantStatus { pub tenant_id: Uuid, pub phase: String, pub applied_cursor: i64, pub committed_cursor: i64, pub lag_entries: i64, pub lag_ms: Option<i64>, pub last_batch_at: Option<String>, pub last_batch_ms: Option<f64>, pub resident_entities: usize, pub resident_bytes: usize, pub known_entities: usize, pub evictions: u64, pub hydrations: u64, pub snapshot_sequence: Option<i64>, pub snapshot_at: Option<String>, pub rebuilds: u32, pub quarantined: u64, pub last_error: Option<String>, pub ready: bool }

pub struct TenantRt { pub state: RwLock<TenantState>, pub status: RwLock<TenantStatus>, pub notify: Notify, pub since_snapshot: RwLock<(u64, Instant)>, pub rebuild_requested: RwLock<bool> }

pub struct Engine { pub cfg: EngineConfig, pub store: Store, pub log: Log, pub tenants: RwLock<HashMap<Uuid, Arc<TenantRt>>>, pub started_at: Instant, pub queries: Semaphore, pub query_count: std::sync::atomic::AtomicU64, pub query_errors: std::sync::atomic::AtomicU64 }

fn now_iso() -> String { chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true) }

impl Engine {
    pub async fn start(cfg: EngineConfig, log: Log) -> Result<Arc<Engine>> {
        let store = Store::connect(&cfg.database_url, 12)?;
        let mut attempts = 0;
        while let Err(e) = store.ping().await { attempts += 1; if attempts > 60 { return Err(e); } log.warn("engine.db_unavailable", "database not reachable yet; retrying", Fields { error_code: Some("db_unavailable".into()), retryable: Some(true), ..Default::default() }); tokio::time::sleep(Duration::from_secs(2)).await; }
        let engine = Arc::new(Engine { queries: Semaphore::new(cfg.max_concurrent_queries), cfg, store, log, tenants: RwLock::new(HashMap::new()), started_at: Instant::now(), query_count: Default::default(), query_errors: Default::default() });
        engine.refresh_tenants().await;
        let e2 = engine.clone();
        tokio::spawn(async move { loop { tokio::time::sleep(Duration::from_secs(10)).await; e2.refresh_tenants().await; } });
        let e3 = engine.clone();
        tokio::spawn(async move { e3.listen_loop().await; });
        Ok(engine)
    }

    pub async fn refresh_tenants(&self) {
        let rows = match self.store.list_tenants().await { Ok(r) => r, Err(e) => { self.log.warn("engine.tenant_list_failed", &format!("could not list tenants: {e}"), Fields { error_code: Some("tenant_list_failed".into()), retryable: Some(true), ..Default::default() }); return; } };
        for t in rows {
            let exists = self.tenants.read().await.contains_key(&t.tenant_id);
            if exists { continue; }
            let rt = Arc::new(TenantRt { state: RwLock::new(TenantState::new(t.tenant_id, self.cfg.tenant_budget_bytes)), status: RwLock::new(TenantStatus { tenant_id: t.tenant_id, phase: "starting".into(), ..Default::default() }), notify: Notify::new(), since_snapshot: RwLock::new((0, Instant::now())), rebuild_requested: RwLock::new(false) });
            self.tenants.write().await.insert(t.tenant_id, rt.clone());
            let this = unsafe_self(self);
            tokio::spawn(async move { this.apply_loop(t.tenant_id, rt).await; });
        }
    }

    async fn listen_loop(&self) {
        loop {
            let (client, mut conn) = match tokio_postgres::connect(&self.cfg.database_url, tokio_postgres::NoTls).await { Ok(x) => x, Err(_) => { tokio::time::sleep(Duration::from_secs(3)).await; continue; } };
            let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<String>();
            let handle = tokio::spawn(async move {
                let mut conn = Box::pin(conn);
                loop {
                    let msg = std::future::poll_fn(|cx| conn.as_mut().poll_message(cx)).await;
                    match msg { Some(Ok(tokio_postgres::AsyncMessage::Notification(n))) => { let _ = tx.send(n.payload().to_string()); } Some(Ok(_)) => {} Some(Err(_)) | None => break }
                }
            });
            if client.batch_execute("LISTEN journal_committed").await.is_err() { handle.abort(); tokio::time::sleep(Duration::from_secs(3)).await; continue; }
            while let Some(payload) = rx.recv().await { if let Ok(id) = payload.parse::<Uuid>() { let known = self.tenants.read().await.get(&id).cloned(); match known { Some(rt) => rt.notify.notify_one(), None => self.refresh_tenants().await } } }
            handle.abort();
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    async fn apply_loop(&self, tenant: Uuid, rt: Arc<TenantRt>) {
        let tid = Some(tenant.to_string());
        // ---- recovery: snapshot + tail, or full rebuild
        let mut applied = 0i64;
        match self.store.load_checkpoint(tenant).await {
            Ok(Some(cp)) => {
                if let (Some(path), Some(sha)) = (cp.snapshot_path.clone(), cp.snapshot_sha256.clone()) {
                    match read_snapshot(std::path::Path::new(&path), &sha).await {
                        Ok(snap) => { applied = snap.applied_sequence; let mut st = snap.state; st.budget_bytes = self.cfg.tenant_budget_bytes; *rt.state.write().await = st; rt.status.write().await.snapshot_sequence = Some(applied); self.log.info("engine.snapshot_loaded", "compatible snapshot loaded; applying committed tail", Fields { tenant_id: tid.clone(), applied_cursor: Some(applied), ..Default::default() }); }
                        Err(e) => { self.log.warn("engine.snapshot_rejected", &format!("snapshot unusable, rebuilding from journal: {e}"), Fields { tenant_id: tid.clone(), error_code: Some("snapshot_rejected".into()), retryable: Some(true), ..Default::default() }); rt.status.write().await.rebuilds += 1; }
                    }
                } else { self.log.info("engine.no_snapshot", "checkpoint without snapshot; rebuilding from journal", Fields { tenant_id: tid.clone(), ..Default::default() }); }
                let _ = cp;
            }
            Ok(None) => { self.log.info("engine.first_build", "no checkpoint; building projections from sequence 0", Fields { tenant_id: tid.clone(), ..Default::default() }); }
            Err(e) => { self.log.error("engine.checkpoint_read_failed", &format!("{e}"), Fields { tenant_id: tid.clone(), error_code: Some("checkpoint_read_failed".into()), ..Default::default() }); }
        }
        { let mut s = rt.status.write().await; s.phase = if applied == 0 { "rebuilding".into() } else { "catching_up".into() }; s.applied_cursor = applied; }
        loop {
            if *rt.rebuild_requested.read().await { *rt.rebuild_requested.write().await = false; *rt.state.write().await = TenantState::new(tenant, self.cfg.tenant_budget_bytes); applied = 0; let mut s = rt.status.write().await; s.phase = "rebuilding".into(); s.applied_cursor = 0; s.rebuilds += 1; s.snapshot_sequence = None; }
            let hwm = self.store.high_water(tenant).await.unwrap_or(applied);
            let batch = match self.store.fetch_batch(tenant, applied, self.cfg.batch_size).await { Ok(b) => b, Err(e) => { self.log.error("engine.fetch_failed", &format!("{e}"), Fields { tenant_id: tid.clone(), error_code: Some("journal_fetch_failed".into()), retryable: Some(true), ..Default::default() }); rt.status.write().await.last_error = Some("journal_fetch_failed".into()); tokio::time::sleep(Duration::from_secs(2)).await; continue; } };
            if batch.is_empty() {
                { let mut s = rt.status.write().await; s.phase = "current".into(); s.ready = true; s.committed_cursor = hwm.max(applied); s.lag_entries = (hwm - applied).max(0); s.lag_ms = Some(0); }
                self.maybe_snapshot(tenant, &rt, false).await;
                let _ = tokio::time::timeout(Duration::from_millis(1000), rt.notify.notified()).await;
                continue;
            }
            let started = Instant::now();
            let batch_id = Uuid::new_v4().to_string();
            let first = batch.first().map(|e| e.journal_sequence).unwrap_or(0); let last = batch.last().map(|e| e.journal_sequence).unwrap_or(0);
            let mut derived_inputs = Vec::new(); let mut quarantined = 0u64;
            for entry in &batch {
                if entry.record_type == RecordType::Source {
                    // hydrate entities the derivation may need to resolve ids
                    let keys = resolution_keys(&entry.event_type, &entry.payload);
                    self.hydrate_missing(tenant, &rt, &keys, entry.journal_sequence - 1).await;
                    let res = { let st = rt.state.read().await; derive(entry, &*st) };
                    match res {
                        Ok(d) => derived_inputs.extend(to_inputs(entry, &d)),
                        Err(e) => { quarantined += 1; if let Err(qe) = self.store.quarantine(entry, "unsupported_or_invalid_source", &e.to_string()).await { self.log.warn("engine.quarantine_failed", &format!("{qe}"), Fields { tenant_id: tid.clone(), error_code: Some("quarantine_write_failed".into()), ..Default::default() }); } }
                    }
                    rt.state.write().await.note_source(entry);
                } else {
                    let d: Derived = match serde_json::from_value(entry.payload.clone()) { Ok(d) => d, Err(e) => { quarantined += 1; self.log.warn("engine.derived_unreadable", &format!("derived entry payload unreadable: {e}"), Fields { tenant_id: tid.clone(), error_code: Some("derived_unreadable".into()), ..Default::default() }); rt.state.write().await.note_source(entry); continue; } };
                    let missing = rt.state.read().await.missing_for(&d);
                    self.hydrate_missing(tenant, &rt, &missing, entry.journal_sequence - 1).await;
                    rt.state.write().await.apply(entry, &d);
                }
            }
            if !derived_inputs.is_empty() {
                match self.store.append_derived(tenant, &derived_inputs).await {
                    Ok(rows) => { let inserted = rows.iter().filter(|r| r.2).count() as i64; self.log.info("journal.batch_committed", "derived entries committed through journal_append", Fields { tenant_id: tid.clone(), journal_batch_id: Some(batch_id.clone()), record_count: Some(inserted), committed_cursor: rows.iter().map(|r| r.1).max(), ..Default::default() }); }
                    Err(e) => { self.log.error("engine.derive_append_failed", &format!("{e}"), Fields { tenant_id: tid.clone(), journal_batch_id: Some(batch_id.clone()), error_code: Some("derive_append_failed".into()), retryable: Some(true), ..Default::default() }); rt.status.write().await.last_error = Some("derive_append_failed".into()); tokio::time::sleep(Duration::from_secs(2)).await; continue; }
                }
            }
            applied = last;
            let elapsed = started.elapsed().as_secs_f64() * 1000.0;
            { let st = rt.state.read().await; let mut s = rt.status.write().await; s.applied_cursor = applied; s.committed_cursor = hwm.max(applied); s.lag_entries = (hwm - applied).max(0); s.last_batch_at = Some(now_iso()); s.last_batch_ms = Some(elapsed); s.resident_entities = st.resident_count(); s.resident_bytes = st.resident_bytes; s.known_entities = st.known.len(); s.evictions = st.evictions; s.hydrations = st.hydrations; s.quarantined += quarantined; s.lag_ms = st.last_applied_recorded_at.map(|t| (chrono::Utc::now() - t).num_milliseconds().max(0)); s.phase = if s.lag_entries > 0 { "catching_up".into() } else { "current".into() }; s.ready = true; s.last_error = None; }
            self.log.info("engine.batch_applied", "batch folded into projections and published", Fields { tenant_id: tid.clone(), journal_batch_id: Some(batch_id), record_count: Some(batch.len() as i64), duration_ms: Some(elapsed), applied_cursor: Some(applied), committed_cursor: Some(hwm.max(applied)), ..Default::default() });
            { let mut s = rt.since_snapshot.write().await; s.0 += batch.len() as u64; }
            let _ = (first, last);
            self.maybe_snapshot(tenant, &rt, false).await;
        }
    }

    async fn hydrate_missing(&self, tenant: Uuid, rt: &Arc<TenantRt>, keys: &[Key], max_sequence: i64) {
        for k in keys {
            let needed = { let st = rt.state.read().await; st.is_known(k) && !st.is_resident(k) };
            if !needed { continue; }
            match self.store.entity_history(tenant, k.0, &k.1, max_sequence, true).await {
                Ok(entries) => { let st = fold_entity(k.0, &k.1, &entries, None); rt.state.write().await.insert_hydrated(k.clone(), st); }
                Err(e) => self.log.warn("engine.hydration_failed", &format!("{e}"), Fields { tenant_id: Some(tenant.to_string()), error_code: Some("hydration_failed".into()), retryable: Some(true), ..Default::default() }),
            }
        }
    }

    async fn maybe_snapshot(&self, tenant: Uuid, rt: &Arc<TenantRt>, force: bool) {
        let (count, since) = *rt.since_snapshot.read().await;
        if !force && (count == 0 || (count < self.cfg.snapshot_every_entries && since.elapsed().as_secs() < self.cfg.snapshot_every_secs)) { return; }
        if count == 0 && !force { return; }
        let snap = { let st = rt.state.read().await; Snapshot::capture(&st, chrono::Utc::now()) };
        let started = Instant::now();
        match write_snapshot(&self.cfg.snapshot_dir, &snap).await {
            Ok((path, sha, bytes)) => {
                let cp = Checkpoint { tenant_id: tenant, applied_sequence: snap.applied_sequence, reducer_version: snap.reducer_version.clone(), schema_version: snap.schema_version, snapshot_path: Some(path.to_string_lossy().to_string()), snapshot_sha256: Some(sha) };
                if let Err(e) = self.store.save_checkpoint(&cp).await { self.log.warn("engine.checkpoint_write_failed", &format!("{e}"), Fields { tenant_id: Some(tenant.to_string()), error_code: Some("checkpoint_write_failed".into()), retryable: Some(true), ..Default::default() }); return; }
                *rt.since_snapshot.write().await = (0, Instant::now());
                { let mut s = rt.status.write().await; s.snapshot_sequence = Some(snap.applied_sequence); s.snapshot_at = Some(now_iso()); }
                self.log.info("engine.snapshot_written", "projection snapshot and checkpoint persisted", Fields { tenant_id: Some(tenant.to_string()), applied_cursor: Some(snap.applied_sequence), record_count: Some(bytes as i64), duration_ms: Some(started.elapsed().as_secs_f64() * 1000.0), ..Default::default() });
            }
            Err(e) => self.log.warn("engine.snapshot_write_failed", &format!("{e}"), Fields { tenant_id: Some(tenant.to_string()), error_code: Some("snapshot_write_failed".into()), retryable: Some(true), ..Default::default() }),
        }
    }

    async fn wait_for_cursor(&self, rt: &Arc<TenantRt>, required: Option<i64>, deadline_ms: u64) -> (bool, i64) {
        let deadline = Instant::now() + Duration::from_millis(deadline_ms);
        loop {
            let applied = rt.status.read().await.applied_cursor;
            match required { Some(r) if applied < r => { if Instant::now() >= deadline { return (false, applied); } tokio::time::sleep(Duration::from_millis(15)).await; } _ => return (true, applied) }
        }
    }

    pub async fn query(&self, tenant: Uuid, input: QueryInput, required: Option<i64>, deadline_ms: u64, principal: Option<String>) -> Result<Value, (u16, String)> {
        let permit = match tokio::time::timeout(Duration::from_millis(deadline_ms), self.queries.acquire()).await { Ok(Ok(p)) => p, _ => return Err((429, "engine query concurrency limit reached; retry later".into())) };
        let started = Instant::now();
        let rt = self.tenants.read().await.get(&tenant).cloned().ok_or((404, "unknown tenant".to_string()))?;
        let (ok, applied) = self.wait_for_cursor(&rt, required, deadline_ms).await;
        if !ok { return Ok(json!({"status": "projection_behind", "applied_cursor": applied, "required_cursor": required, "intent": input.intent, "result": null, "calculation": ["engine has not applied the required cursor within the deadline"], "evidence_entry_ids": [], "missing_inputs": [], "conflicts": [], "coverage": [], "rule_version": bbx_query::RULE_VERSION, "pagination": {"next_cursor": null, "truncated": false, "snapshot_cursor": applied}})); }
        let mut iterations = 0;
        let answer = loop {
            iterations += 1;
            let res = { let mut st = rt.state.write().await; run(&mut st, &input) };
            match res { Ok(a) => break a, Err(NeedHydration(keys)) => { if iterations > 6 { return Err((503, "hydration budget exceeded for this query; narrow the filter".into())); } let cur = rt.status.read().await.applied_cursor; self.hydrate_missing(tenant, &rt, &keys, cur).await; } }
        };
        drop(permit);
        self.query_count.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let applied_now = rt.status.read().await.applied_cursor;
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        self.log.info("query.served", "intent answered at applied cutoff", Fields { tenant_id: Some(tenant.to_string()), operation_id: Some(input.intent.clone()), duration_ms: Some(elapsed), applied_cursor: Some(applied_now), committed_cursor: required, trace_id: principal, ..Default::default() });
        Ok(json!({"intent": input.intent, "status": answer.status, "result": answer.result, "calculation": answer.calculation, "rule_version": bbx_query::RULE_VERSION, "evidence_entry_ids": answer.evidence_entry_ids, "missing_inputs": answer.missing_inputs, "conflicts": answer.conflicts, "coverage": answer.coverage, "required_cursor": required, "applied_cursor": applied_now, "pagination": {"next_cursor": answer.next_cursor, "truncated": answer.truncated, "snapshot_cursor": applied_now}, "timing_ms": elapsed, "hydration_rounds": iterations - 1}))
    }

    pub async fn entity_state(&self, tenant: Uuid, entity_type: &str, entity_id: &str, required: Option<i64>, deadline_ms: u64, recorded_cutoff: Option<i64>, effective_at: Option<chrono::DateTime<chrono::Utc>>) -> Result<Value, (u16, String)> {
        let kind = EntityKind::parse(entity_type).ok_or((400, format!("unknown entity type {entity_type}")))?;
        let rt = self.tenants.read().await.get(&tenant).cloned().ok_or((404, "unknown tenant".to_string()))?;
        let (ok, applied) = self.wait_for_cursor(&rt, required, deadline_ms).await;
        if !ok { return Ok(json!({"status": "projection_behind", "applied_cursor": applied, "required_cursor": required})); }
        if recorded_cutoff.is_some() || effective_at.is_some() {
            // historical as-of answer: bounded replay of the entity's own history, never a reinterpreted cache
            let cutoff = recorded_cutoff.unwrap_or(applied).min(applied);
            let entries = self.store.entity_history(tenant, kind, entity_id, cutoff, true).await.map_err(|e| (500, e.to_string()))?;
            if entries.is_empty() { return Ok(json!({"status": "insufficient_data", "entity_type": entity_type, "entity_id": entity_id, "recorded_cutoff": cutoff, "effective_at": effective_at, "state": null})); }
            let st = fold_entity(kind, entity_id, &entries, effective_at);
            let mut tmp = TenantState::new(tenant, 1 << 20); tmp.insert_hydrated((kind, entity_id.to_string()), st);
            let view = entity_view(&mut tmp, kind, entity_id).map_err(|_| (500, "unexpected".to_string()))?;
            return Ok(json!({"status": "complete", "as_of": {"recorded_cutoff": cutoff, "effective_at": effective_at}, "applied_cursor": applied, "required_cursor": required, "view": view}));
        }
        let mut iterations = 0;
        loop {
            iterations += 1;
            let res = { let mut st = rt.state.write().await; entity_view(&mut st, kind, entity_id) };
            match res {
                Ok(Some(v)) => return Ok(json!({"status": "complete", "applied_cursor": applied, "required_cursor": required, "view": v})),
                Ok(None) => return Ok(json!({"status": "insufficient_data", "applied_cursor": applied, "required_cursor": required, "entity_type": entity_type, "entity_id": entity_id, "view": null})),
                Err(NeedHydration(keys)) => { if iterations > 3 { return Err((503, "hydration failed".into())); } self.hydrate_missing(tenant, &rt, &keys, applied).await; }
            }
        }
    }

    pub async fn tenant_status(&self, tenant: Uuid) -> Option<TenantStatus> { let rt = self.tenants.read().await.get(&tenant).cloned()?; let mut s = rt.status.read().await.clone(); let st = rt.state.read().await; s.resident_entities = st.resident_count(); s.resident_bytes = st.resident_bytes; s.known_entities = st.known.len(); s.evictions = st.evictions; s.hydrations = st.hydrations; Some(s) }
    pub async fn health(&self) -> Value {
        let mut tenants = vec![]; let mut total_bytes = 0usize;
        for (id, rt) in self.tenants.read().await.iter() { let s = rt.status.read().await.clone(); let st = rt.state.read().await; total_bytes += st.resident_bytes; tenants.push(json!({"tenant_id": id, "phase": s.phase, "applied_cursor": s.applied_cursor, "committed_cursor": s.committed_cursor, "lag_entries": s.lag_entries, "lag_ms": s.lag_ms, "ready": s.ready, "resident_entities": st.resident_count(), "known_entities": st.known.len(), "snapshot_sequence": s.snapshot_sequence, "last_error": s.last_error})); }
        let db_ok = self.store.ping().await.is_ok();
        json!({"status": if db_ok { "healthy" } else { "degraded" }, "version": self.cfg.version, "uptime_seconds": self.started_at.elapsed().as_secs(), "database": if db_ok { "reachable" } else { "unreachable" }, "tenants": tenants, "resident_bytes_total": total_bytes, "global_budget_bytes": self.cfg.global_budget_bytes, "rss_bytes": rss_bytes(), "log_dropped": self.log.dropped.load(std::sync::atomic::Ordering::Relaxed), "debug_active": self.log.debug_active(), "reducer_version": bbx_domain::RULE_VERSION, "schema_version": bbx_domain::SCHEMA_VERSION, "observed_at": now_iso()})
    }
    pub async fn metrics(&self) -> Value { json!({"rss_bytes": rss_bytes(), "queries": self.query_count.load(std::sync::atomic::Ordering::Relaxed), "query_errors": self.query_errors.load(std::sync::atomic::Ordering::Relaxed), "available_query_permits": self.queries.available_permits(), "observed_at": now_iso()}) }
    pub async fn evict(&self, tenant: Uuid, entity_type: Option<String>, entity_id: Option<String>, all: bool) -> Value {
        let Some(rt) = self.tenants.read().await.get(&tenant).cloned() else { return json!({"error": "unknown tenant"}) };
        let mut st = rt.state.write().await;
        if all { let keys: Vec<Key> = st.entities.keys().cloned().collect(); let n = keys.len(); for k in keys { st.evict(&k); } return json!({"evicted": n}); }
        let Some(kind) = entity_type.as_deref().and_then(EntityKind::parse) else { return json!({"error": "entity_type required"}) };
        let ok = st.evict(&(kind, entity_id.unwrap_or_default())); json!({"evicted": if ok { 1 } else { 0 }})
    }
    pub async fn rebuild(&self, tenant: Uuid) -> Value { let Some(rt) = self.tenants.read().await.get(&tenant).cloned() else { return json!({"error": "unknown tenant"}) }; *rt.rebuild_requested.write().await = true; rt.notify.notify_one(); json!({"rebuild": "requested"}) }
    pub async fn snapshot_now(&self, tenant: Uuid) -> Value { let Some(rt) = self.tenants.read().await.get(&tenant).cloned() else { return json!({"error": "unknown tenant"}) }; self.maybe_snapshot(tenant, &rt, true).await; let s = rt.status.read().await; json!({"snapshot_sequence": s.snapshot_sequence, "snapshot_at": s.snapshot_at}) }
    pub async fn set_debug(&self, minutes: u64) { self.log.set_debug_until(if minutes == 0 { None } else { Some(Instant::now() + Duration::from_secs(minutes * 60)) }); self.log.info("engine.debug_window", "debug logging window changed", Fields { record_count: Some(minutes as i64), ..Default::default() }); }
}

fn rss_bytes() -> Option<u64> { std::fs::read_to_string("/proc/self/statm").ok().and_then(|s| s.split_whitespace().nth(1).and_then(|p| p.parse::<u64>().ok())).map(|pages| pages * 4096) }

/// The engine lives for the whole process; apply loops hold a `'static` reference obtained from the Arc at spawn time.
fn unsafe_self(e: &Engine) -> &'static Engine { unsafe { &*(e as *const Engine) } }


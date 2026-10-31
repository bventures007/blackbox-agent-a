//! Shared structured log record emitter for the engine (schema_version 1), bounded buffer, hour-segmented NDJSON files.
use serde::Serialize;
use std::io::Write;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tokio::sync::mpsc;

#[derive(Serialize, Clone, Debug)]
pub struct Record {
    pub schema_version: u8, pub record_id: String, pub occurred_at: String, pub observed_at: String, pub level: &'static str, pub event_name: String, pub message: String,
    pub component: &'static str, pub service_version: String, pub instance_id: String, pub scope: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")] pub tenant_id: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] pub run_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub operation_id: Option<String>, #[serde(skip_serializing_if = "Option::is_none")] pub duration_ms: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub record_count: Option<i64>, #[serde(skip_serializing_if = "Option::is_none")] pub error_code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub retryable: Option<bool>, #[serde(skip_serializing_if = "Option::is_none")] pub journal_batch_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub committed_cursor: Option<i64>, #[serde(skip_serializing_if = "Option::is_none")] pub applied_cursor: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub trace_id: Option<String>,
}

#[derive(Default, Clone)]
pub struct Fields { pub tenant_id: Option<String>, pub run_id: Option<String>, pub operation_id: Option<String>, pub duration_ms: Option<f64>, pub record_count: Option<i64>, pub error_code: Option<String>, pub retryable: Option<bool>, pub journal_batch_id: Option<String>, pub committed_cursor: Option<i64>, pub applied_cursor: Option<i64>, pub trace_id: Option<String> }

#[derive(Clone)]
pub struct Log { tx: mpsc::Sender<String>, pub dropped: Arc<AtomicU64>, version: String, instance: String, debug_until: Arc<std::sync::Mutex<Option<std::time::Instant>>> }

fn clip(s: &str, max: usize) -> String {
    let mut out: String = s.chars().filter(|c| !c.is_control()).collect();
    out = out.replace('<', "\u{2039}").replace('>', "\u{203a}");
    if out.chars().count() > max { out = out.chars().take(max - 1).collect::<String>() + "…"; }
    out
}

impl Log {
    pub fn start(dir: PathBuf, version: String) -> Log {
        let (tx, mut rx) = mpsc::channel::<String>(4096);
        let dropped = Arc::new(AtomicU64::new(0));
        let instance = format!("engine-{}", &uuid::Uuid::new_v4().to_string()[..8]);
        tokio::spawn(async move {
            let comp_dir = dir.join("engine");
            let _ = std::fs::create_dir_all(&comp_dir);
            let mut buf: Vec<String> = Vec::new();
            let mut tick = tokio::time::interval(std::time::Duration::from_millis(500));
            loop {
                tokio::select! {
                    Some(line) = rx.recv() => { buf.push(line); if buf.len() >= 256 { flush(&comp_dir, &mut buf); } }
                    _ = tick.tick() => { flush(&comp_dir, &mut buf); }
                }
            }
        });
        Log { tx, dropped, version, instance, debug_until: Arc::new(std::sync::Mutex::new(None)) }
    }
    pub fn set_debug_until(&self, until: Option<std::time::Instant>) { *self.debug_until.lock().unwrap() = until; }
    pub fn debug_active(&self) -> bool { self.debug_until.lock().unwrap().map(|u| u > std::time::Instant::now()).unwrap_or(false) }
    pub fn emit(&self, level: &'static str, event: &str, message: &str, f: Fields) {
        if level == "DEBUG" && !self.debug_active() { return; }
        let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
        let rec = Record { schema_version: 1, record_id: uuid::Uuid::new_v4().to_string(), occurred_at: now.clone(), observed_at: now, level, event_name: clip(event, 80), message: clip(message, 512), component: "engine", service_version: self.version.clone(), instance_id: self.instance.clone(),
            scope: if f.tenant_id.is_some() { "workspace" } else { "installation" }, tenant_id: f.tenant_id, run_id: f.run_id, operation_id: f.operation_id, duration_ms: f.duration_ms, record_count: f.record_count, error_code: f.error_code.map(|e| clip(&e, 80)), retryable: f.retryable, journal_batch_id: f.journal_batch_id, committed_cursor: f.committed_cursor, applied_cursor: f.applied_cursor, trace_id: f.trace_id };
        let line = serde_json::to_string(&rec).unwrap_or_default();
        if level == "WARN" || level == "ERROR" { eprintln!("{line}"); }
        if self.tx.try_send(line).is_err() { self.dropped.fetch_add(1, Ordering::Relaxed); }
    }
    pub fn info(&self, e: &str, m: &str, f: Fields) { self.emit("INFO", e, m, f) }
    pub fn warn(&self, e: &str, m: &str, f: Fields) { self.emit("WARN", e, m, f) }
    pub fn error(&self, e: &str, m: &str, f: Fields) { self.emit("ERROR", e, m, f) }
    pub fn debug(&self, e: &str, m: &str, f: Fields) { self.emit("DEBUG", e, m, f) }
}

fn flush(dir: &PathBuf, buf: &mut Vec<String>) {
    if buf.is_empty() { return; }
    let path = dir.join(format!("{}.ndjson", chrono::Utc::now().format("%Y-%m-%dT%H")));
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) { let _ = f.write_all((buf.join("\n") + "\n").as_bytes()); }
    buf.clear();
}

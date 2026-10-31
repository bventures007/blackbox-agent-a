//! Blackbox engine: single-process deterministic projection builder and query service (internal network only).
mod logging;
mod runtime;

use axum::{extract::{Path, State}, http::{HeaderMap, StatusCode}, response::IntoResponse, routing::{get, post}, Json, Router};
use runtime::{Engine, EngineConfig};
use serde::Deserialize;
use serde_json::{json, Value};
use std::sync::Arc;
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;

#[derive(Clone)]
struct AppState { engine: Arc<Engine>, token: Arc<String> }

fn env(name: &str, default: &str) -> String { std::env::var(name).unwrap_or_else(|_| default.to_string()) }

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let version = env("SERVICE_VERSION", "0.1.0-dev");
    let log_dir = std::path::PathBuf::from(env("LOG_DIR", "/var/blackbox/logs"));
    let log = logging::Log::start(log_dir, version.clone());
    let token_file = env("ENGINE_TOKEN_FILE", "/run/secrets/engine_token");
    let token = std::fs::read_to_string(&token_file).map(|t| t.trim().to_string()).unwrap_or_else(|_| { log.warn("engine.token_missing", "engine token file not readable; refusing all requests", Default::default()); String::new() });
    let cfg = EngineConfig {
        database_url: std::env::var("ENGINE_DATABASE_URL").or_else(|_| std::fs::read_to_string(env("ENGINE_DATABASE_URL_FILE", "/run/secrets/engine_database_url")).map(|s| s.trim().to_string())).expect("ENGINE_DATABASE_URL or ENGINE_DATABASE_URL_FILE"),
        snapshot_dir: std::path::PathBuf::from(env("ENGINE_SNAPSHOT_DIR", "/var/blackbox/data/engine")),
        tenant_budget_bytes: env("ENGINE_TENANT_BUDGET_MIB", "64").parse::<usize>().unwrap_or(64) << 20,
        global_budget_bytes: env("ENGINE_GLOBAL_BUDGET_MIB", "768").parse::<usize>().unwrap_or(768) << 20,
        snapshot_every_entries: env("ENGINE_SNAPSHOT_EVERY_ENTRIES", "2000").parse().unwrap_or(2000),
        snapshot_every_secs: env("ENGINE_SNAPSHOT_EVERY_SECS", "15").parse().unwrap_or(15),
        batch_size: env("ENGINE_BATCH_SIZE", "500").parse().unwrap_or(500),
        max_concurrent_queries: env("ENGINE_MAX_CONCURRENT_QUERIES", "32").parse().unwrap_or(32),
        version: version.clone(),
    };
    let engine = Engine::start(cfg, log.clone()).await?;
    let state = AppState { engine: engine.clone(), token: Arc::new(token) };
    let app = Router::new()
        .route("/health", get(health))
        .route("/metrics", get(metrics))
        .route("/tenants/:tenant/status", get(tenant_status))
        .route("/query", post(query))
        .route("/state", post(entity_state))
        .route("/admin/evict", post(admin_evict))
        .route("/admin/rebuild", post(admin_rebuild))
        .route("/admin/snapshot", post(admin_snapshot))
        .route("/admin/debug", post(admin_debug))
        .route("/admin/refresh-tenants", post(admin_refresh))
        .layer(RequestBodyLimitLayer::new(1 << 20))
        .with_state(state);
    let bind = env("ENGINE_BIND", "0.0.0.0:7000");
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    log.info("engine.started", "engine listening on internal network", Default::default());
    axum::serve(listener, app).await?;
    Ok(())
}

fn authorized(headers: &HeaderMap, token: &str) -> bool {
    if token.is_empty() { return false; }
    let given = headers.get("x-engine-token").and_then(|v| v.to_str().ok()).unwrap_or("");
    if given.len() != token.len() { return false; }
    given.bytes().zip(token.bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b)) == 0
}

macro_rules! auth { ($h:expr, $s:expr) => { if !authorized(&$h, &$s.token) { return (StatusCode::UNAUTHORIZED, Json(json!({"error": "engine token required"}))).into_response(); } }; }

async fn health(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse { auth!(headers, s); Json(s.engine.health().await).into_response() }
async fn metrics(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse { auth!(headers, s); Json(s.engine.metrics().await).into_response() }
async fn tenant_status(State(s): State<AppState>, headers: HeaderMap, Path(tenant): Path<Uuid>) -> impl IntoResponse { auth!(headers, s); match s.engine.tenant_status(tenant).await { Some(st) => Json(st).into_response(), None => (StatusCode::NOT_FOUND, Json(json!({"error": "unknown tenant"}))).into_response() } }

#[derive(Deserialize)]
struct QueryBody { tenant_id: Uuid, intent: String, #[serde(default)] parameters: Value, #[serde(default)] required_cursor: Option<i64>, #[serde(default)] deadline_ms: Option<u64>, #[serde(default)] page_size: Option<usize>, #[serde(default)] cursor: Option<String>, #[serde(default)] now: Option<String>, #[serde(default)] principal: Option<String> }
async fn query(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<QueryBody>) -> impl IntoResponse {
    auth!(headers, s);
    let input = bbx_query::QueryInput { intent: b.intent, parameters: b.parameters, page_size: b.page_size.unwrap_or(100), cursor: b.cursor, now: b.now };
    match s.engine.query(b.tenant_id, input, b.required_cursor, b.deadline_ms.unwrap_or(1500), b.principal).await { Ok(v) => Json(v).into_response(), Err(e) => (StatusCode::from_u16(e.0).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(json!({"error": e.1}))).into_response() }
}

#[derive(Deserialize)]
struct StateBody { tenant_id: Uuid, entity_type: String, entity_id: String, #[serde(default)] required_cursor: Option<i64>, #[serde(default)] deadline_ms: Option<u64>, #[serde(default)] recorded_cutoff: Option<i64>, #[serde(default)] effective_at: Option<String> }
async fn entity_state(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<StateBody>) -> impl IntoResponse {
    auth!(headers, s);
    let eff = b.effective_at.as_deref().and_then(|x| x.parse().ok());
    match s.engine.entity_state(b.tenant_id, &b.entity_type, &b.entity_id, b.required_cursor, b.deadline_ms.unwrap_or(1500), b.recorded_cutoff, eff).await { Ok(v) => Json(v).into_response(), Err(e) => (StatusCode::from_u16(e.0).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(json!({"error": e.1}))).into_response() }
}

#[derive(Deserialize)]
struct EvictBody { tenant_id: Uuid, #[serde(default)] entity_type: Option<String>, #[serde(default)] entity_id: Option<String>, #[serde(default)] all: bool }
async fn admin_evict(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<EvictBody>) -> impl IntoResponse { auth!(headers, s); Json(s.engine.evict(b.tenant_id, b.entity_type, b.entity_id, b.all).await).into_response() }
#[derive(Deserialize)]
struct TenantBody { tenant_id: Uuid }
async fn admin_rebuild(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<TenantBody>) -> impl IntoResponse { auth!(headers, s); Json(s.engine.rebuild(b.tenant_id).await).into_response() }
async fn admin_snapshot(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<TenantBody>) -> impl IntoResponse { auth!(headers, s); Json(s.engine.snapshot_now(b.tenant_id).await).into_response() }
#[derive(Deserialize)]
struct DebugBody { #[serde(default)] minutes: u64 }
async fn admin_debug(State(s): State<AppState>, headers: HeaderMap, Json(b): Json<DebugBody>) -> impl IntoResponse { auth!(headers, s); let mins = b.minutes.min(15); s.engine.set_debug(mins).await; Json(json!({"debug_minutes": mins})).into_response() }
async fn admin_refresh(State(s): State<AppState>, headers: HeaderMap) -> impl IntoResponse { auth!(headers, s); s.engine.refresh_tenants().await; Json(json!({"ok": true})).into_response() }

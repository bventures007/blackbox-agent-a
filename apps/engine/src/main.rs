mod questions;
use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
};
use blackbox_domain::{Input, Observation, RULE_VERSION, State as BusinessState};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Postgres, Row, Transaction, postgres::PgPoolOptions};
use std::{num::NonZeroUsize, sync::Arc};
use subtle::ConstantTimeEq;
use tokio::sync::{Mutex, Semaphore};
use uuid::Uuid;
#[derive(Clone)]
struct App {
    db: PgPool,
    token: String,
    cache: Arc<Mutex<lru::LruCache<(Uuid, Uuid, i64), BusinessState>>>,
    queries: Arc<Semaphore>,
    scoped_queries: Arc<Mutex<std::collections::HashMap<String, std::sync::Weak<Semaphore>>>>,
}
async fn admit_scoped(
    a: &App,
    tenant: Uuid,
    principal: Uuid,
) -> Result<
    (
        tokio::sync::OwnedSemaphorePermit,
        tokio::sync::OwnedSemaphorePermit,
    ),
    Error,
> {
    let mut map = a.scoped_queries.lock().await;
    map.retain(|_, value| value.strong_count() > 0);
    let mut get = |key: String, size: usize| {
        if let Some(s) = map.get(&key).and_then(|s| s.upgrade()) {
            s
        } else {
            let s = Arc::new(Semaphore::new(size));
            map.insert(key, Arc::downgrade(&s));
            s
        }
    };
    let tenant_limit = get(format!("tenant:{tenant}"), 16);
    let principal = get(format!("principal:{tenant}:{principal}"), 8);
    let full = || {
        (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"scoped_query_capacity","retry_after_ms":250})),
        )
    };
    Ok((
        tenant_limit.try_acquire_owned().map_err(|_| full())?,
        principal.try_acquire_owned().map_err(|_| full())?,
    ))
}
type Error = (StatusCode, Json<Value>);
fn error(code: &str) -> Error {
    (StatusCode::SERVICE_UNAVAILABLE, Json(json!({"error":code})))
}
fn internal(h: &HeaderMap, a: &App) -> Result<(), Error> {
    let v = h
        .get("x-blackbox-internal")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if v.as_bytes().ct_eq(a.token.as_bytes()).unwrap_u8() != 1 {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        ));
    }
    if h.get("x-blackbox-contract").and_then(|v| v.to_str().ok())
        != Some("f44009de0ee45cf3b5d92fa8f5360099077a62fa7d3bf680384b03e1aa2090b6")
    {
        return Err(error("runtime_contract_incompatible"));
    }
    Ok(())
}
async fn transaction(db: &PgPool, tenant: Uuid) -> Result<Transaction<'_, Postgres>, Error> {
    let mut tx = db
        .begin()
        .await
        .map_err(|_| error("database_unavailable"))?;
    sqlx::query("SELECT set_config('bb.tenant_id',$1,true)")
        .bind(tenant.to_string())
        .execute(&mut *tx)
        .await
        .map_err(|_| error("database_unavailable"))?;
    Ok(tx)
}
async fn inputs(
    tx: &mut Transaction<'_, Postgres>,
    entity: Uuid,
    cutoff: i64,
    effective: Option<&str>,
) -> Result<Vec<Input>, Error> {
    let rows=sqlx::query("SELECT entry_id,sequence,evidence_id,payload FROM bb.journal WHERE entity_id=$1 AND sequence<=$2 AND record_type='source' AND ($3::text::timestamptz IS NULL OR occurred_at<=$3::text::timestamptz) ORDER BY sequence LIMIT 5001").bind(entity).bind(cutoff).bind(effective).fetch_all(&mut **tx).await.map_err(|_|error("read_failed"))?;
    if rows.len() > 5000 {
        return Err(error("entity_history_too_large"));
    }
    rows.iter()
        .map(|r| {
            Ok(Input {
                entry_id: r.get::<Uuid, _>("entry_id").to_string(),
                sequence: r.get("sequence"),
                evidence_id: r.get::<Uuid, _>("evidence_id").to_string(),
                observation: serde_json::from_value(r.get("payload"))
                    .map_err(|_| error("unsupported_event"))?,
            })
        })
        .collect()
}
#[derive(Deserialize)]
struct Apply {
    tenant_id: Uuid,
}
async fn apply(
    State(a): State<App>,
    h: HeaderMap,
    Json(req): Json<Apply>,
) -> Result<Json<Value>, Error> {
    internal(&h, &a)?;
    let mut tx = transaction(&a.db, req.tenant_id).await?;
    let head = sqlx::query("SELECT committed,applied FROM bb.heads WHERE tenant_id=$1 FOR UPDATE")
        .bind(req.tenant_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| error("scope_unavailable"))?;
    let mut end: i64 = head.get("committed");
    let rows=sqlx::query("SELECT j.* FROM bb.journal j JOIN bb.outbox o USING(tenant_id,sequence) WHERE o.state='pending' ORDER BY j.sequence LIMIT 250").fetch_all(&mut *tx).await.map_err(|_|error("read_failed"))?;
    let mut entities = std::collections::BTreeSet::new();
    for r in &rows {
        let payload: Value = r.get("payload");
        let obs: Observation =
            serde_json::from_value(payload.clone()).map_err(|_| error("unsupported_event"))?;
        for track in obs
            .record
            .as_ref()
            .map(blackbox_domain::record_tracks)
            .unwrap_or_else(|| blackbox_domain::derived_tracks(&obs.kind))
        {
            end += 1;
            sqlx::query("INSERT INTO bb.journal(tenant_id,sequence,entry_id,record_type,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,input_entry_id,rule_version,correlation_id) SELECT tenant_id,$1,$2,$3,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,entry_id,$4,correlation_id FROM bb.journal WHERE entry_id=$5")
    .bind(end).bind(Uuid::new_v4()).bind(track).bind(if obs.record.is_some() { "records-v3" } else { RULE_VERSION }).bind(r.get::<Uuid,_>("entry_id")).execute(&mut *tx).await.map_err(|_|error("derivation_failed"))?;
        }
        if let Some(record) = &obs.record {
            let dataset = record["dataset"]
                .as_str()
                .ok_or_else(|| error("dataset_missing"))?;
            sqlx::query("INSERT INTO bb.record_versions(tenant_id,sequence,record_id,dataset,entity_id,connection_id,occurred_at,payload,checksum,supersedes_entry_id,evidence_id,entry_id) SELECT tenant_id,sequence,record_id,$1,entity_id,connection_id,occurred_at,$2,$4,supersedes_entry_id,evidence_id,entry_id FROM bb.journal WHERE entry_id=$3 ON CONFLICT DO NOTHING")
                .bind(dataset).bind(record).bind(r.get::<Uuid,_>("entry_id")).bind(format!("{:x}", Sha256::digest(serde_json::to_vec(record).unwrap()))).execute(&mut *tx).await.map_err(|_|error("record_projection_failed"))?;
            sqlx::query("INSERT INTO bb.current_records SELECT * FROM bb.record_versions WHERE sequence=$1 ON CONFLICT(tenant_id,record_id) DO UPDATE SET sequence=EXCLUDED.sequence,dataset=EXCLUDED.dataset,entity_id=EXCLUDED.entity_id,occurred_at=EXCLUDED.occurred_at,payload=EXCLUDED.payload,checksum=EXCLUDED.checksum,supersedes_entry_id=EXCLUDED.supersedes_entry_id,evidence_id=EXCLUDED.evidence_id,entry_id=EXCLUDED.entry_id WHERE EXCLUDED.supersedes_entry_id=bb.current_records.entry_id OR (bb.current_records.occurred_at,bb.current_records.sequence)<(EXCLUDED.occurred_at,EXCLUDED.sequence)")
                .bind(r.get::<i64,_>("sequence")).execute(&mut *tx).await.map_err(|_|error("record_projection_failed"))?;
        }
        entities.insert(r.get::<Uuid, _>("entity_id"));
        sqlx::query("UPDATE bb.outbox SET state='applied' WHERE sequence=$1")
            .bind(r.get::<i64, _>("sequence"))
            .execute(&mut *tx)
            .await
            .map_err(|_| error("checkpoint_failed"))?;
    }
    // Publish a tenant cutoff only after every preceding source has been applied.
    let pending: i64 = sqlx::query_scalar("SELECT count(*) FROM bb.outbox WHERE state='pending'")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| error("read_failed"))?;
    let applied = if pending == 0 {
        end
    } else {
        head.get("applied")
    };
    let mut publish = vec![];
    for entity in entities {
        let state = blackbox_domain::reduce(&inputs(&mut tx, entity, end, None).await?)
            .map_err(|_| error("reducer_conflict"))?;
        let value = serde_json::to_value(&state).map_err(|_| error("encode_failed"))?;
        let checksum = format!("{:x}", Sha256::digest(serde_json::to_vec(&value).unwrap()));
        sqlx::query("INSERT INTO bb.projections(tenant_id,entity_id,applied,rule_version,state,checksum) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,entity_id) DO UPDATE SET applied=EXCLUDED.applied,rule_version=EXCLUDED.rule_version,state=EXCLUDED.state,checksum=EXCLUDED.checksum,updated_at=now()")
   .bind(req.tenant_id).bind(entity).bind(end).bind(RULE_VERSION).bind(value).bind(checksum).execute(&mut *tx).await.map_err(|_|error("projection_failed"))?;
        publish.push((entity, state));
    }
    sqlx::query("UPDATE bb.heads SET committed=$2,applied=$3,record_count=(SELECT count(*) FROM bb.current_records) WHERE tenant_id=$1")
        .bind(req.tenant_id)
        .bind(end)
        .bind(applied)
        .execute(&mut *tx)
        .await
        .map_err(|_| error("checkpoint_failed"))?;
    tx.commit().await.map_err(|_| error("commit_failed"))?;
    {
        let mut cache = a.cache.lock().await;
        for (entity, state) in publish {
            cache.put((req.tenant_id, entity, end), state);
        }
    }
    Ok(Json(
        json!({"committed_cursor":end,"applied_cursor":applied,"processed":rows.len()}),
    ))
}
#[derive(Deserialize)]
struct Query {
    tenant_id: Uuid,
    entity_id: Uuid,
    verifier: String,
    recorded_cutoff: Option<i64>,
    effective_at: Option<String>,
    at_least_cursor: Option<i64>,
}
async fn query(
    State(a): State<App>,
    h: HeaderMap,
    Json(q): Json<Query>,
) -> Result<Json<Value>, Error> {
    internal(&h, &a)?;
    let _permit = a.queries.try_acquire().map_err(|_| {
        (
            StatusCode::TOO_MANY_REQUESTS,
            Json(json!({"error":"query_capacity","retry_after_ms":250})),
        )
    })?;
    let auth = sqlx::query("SELECT tenant_id,purpose,principal_id FROM bb.authenticate($1)")
        .bind(&q.verifier)
        .fetch_optional(&a.db)
        .await
        .map_err(|_| error("authorization_unavailable"))?;
    if !auth.as_ref().is_some_and(|r| {
        r.get::<Uuid, _>("tenant_id") == q.tenant_id
            && ["session", "agent"].contains(&r.get::<String, _>("purpose").as_str())
    }) {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        ));
    }
    let _scoped = admit_scoped(&a, q.tenant_id, auth.unwrap().get("principal_id")).await?;
    let mut tx = transaction(&a.db, q.tenant_id).await?;
    let head = sqlx::query("SELECT committed,applied FROM bb.heads WHERE tenant_id=$1")
        .bind(q.tenant_id)
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| error("scope_unavailable"))?;
    let committed: i64 = head.get("committed");
    let applied: i64 = head.get("applied");
    let cutoff = q.recorded_cutoff.unwrap_or(committed);
    if cutoff < 0 || cutoff > committed {
        return Err(error("invalid_cutoff"));
    }
    if applied < cutoff || applied < q.at_least_cursor.unwrap_or(0) {
        return Err(error("projection_behind"));
    }
    let key = (q.tenant_id, q.entity_id, cutoff);
    let cached = if q.effective_at.is_none() {
        a.cache.lock().await.get(&key).cloned()
    } else {
        None
    };
    let (state, path) = if let Some(state) = cached {
        (state, "hot")
    } else {
        let projection = if q.effective_at.is_none() {
            sqlx::query("SELECT state,checksum,rule_version,applied FROM bb.projections WHERE entity_id=$1 AND applied<=$2").bind(q.entity_id).bind(cutoff).fetch_optional(&mut *tx).await.map_err(|_|error("read_failed"))?
        } else {
            None
        };
        let mut loaded = None;
        if let Some(r) = projection {
            let value: Value = r.get("state");
            let checksum = format!("{:x}", Sha256::digest(serde_json::to_vec(&value).unwrap()));
            let tail:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.journal WHERE entity_id=$1 AND record_type='source' AND sequence>$2 AND sequence<=$3)").bind(q.entity_id).bind(r.get::<i64,_>("applied")).bind(cutoff).fetch_one(&mut *tx).await.map_err(|_|error("read_failed"))?;
            if !tail
                && r.get::<String, _>("checksum") == checksum
                && r.get::<String, _>("rule_version") == RULE_VERSION
            {
                loaded = serde_json::from_value(value).ok();
            }
        }
        let state = match loaded {
            Some(s) => s,
            None => blackbox_domain::reduce(
                &inputs(&mut tx, q.entity_id, cutoff, q.effective_at.as_deref()).await?,
            )
            .map_err(|_| error("reducer_conflict"))?,
        };
        if q.effective_at.is_none() {
            a.cache.lock().await.put(key, state.clone());
        }
        (state, "cold")
    };
    tx.commit().await.map_err(|_| error("read_failed"))?;
    // Recheck after potentially slow hydration so revoked grants cannot authorize delivery.
    let valid: bool =
        sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.authenticate($1) WHERE tenant_id=$2)")
            .bind(&q.verifier)
            .bind(q.tenant_id)
            .fetch_one(&a.db)
            .await
            .map_err(|_| error("authorization_unavailable"))?;
    if !valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        ));
    }
    Ok(Json(
        json!({"status":if state.agreed_minor.is_some(){"partial"}else{"insufficient_data"},"result":state,"effective_at":q.effective_at,"recorded_cutoff":cutoff,"required_cursor":cutoff,"applied_cursor":applied,"rule_version":RULE_VERSION,"read_path":path,"coverage":{"basis":"observed_records_only","provider_completeness":"unverified"},"missing_inputs":["verified_payment_population_coverage"]}),
    ))
}
fn release_manifest() -> Value {
    let manifest: Value = serde_json::from_str(include_str!("../../../release/compatibility.json"))
        .expect("invalid compiled release manifest");
    assert_eq!(
        format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&manifest["runtime"]).unwrap())
        ),
        "f44009de0ee45cf3b5d92fa8f5360099077a62fa7d3bf680384b03e1aa2090b6",
        "unsupported compiled runtime contract"
    );
    manifest
}
async fn verify_database_contract(db: &PgPool) -> Result<(), String> {
    let manifest = release_manifest();
    let metadata: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('contract',contract,'state',state) FROM bb.runtime_contract",
    )
    .fetch_all(db)
    .await
    .map_err(|_| "database_contract_missing")?;
    let migrations: Value = sqlx::query_scalar("SELECT coalesce(jsonb_agg(jsonb_build_object('file',version,'sha256',sha256) ORDER BY version),'[]'::jsonb) FROM bb.schema_migrations")
        .fetch_one(db).await.map_err(|_| "migration_history_missing")?;
    let major: i32 =
        sqlx::query_scalar("SELECT current_setting('server_version_num')::integer/10000")
            .fetch_one(db)
            .await
            .map_err(|_| "database_version_unavailable")?;
    if metadata != vec![json!({"contract":manifest["runtime"],"state":"active"})]
        || migrations != manifest["migrations"]
        || !manifest["runtime"]["postgres_read"]
            .as_array()
            .is_some_and(|versions| versions.contains(&json!(major)))
    {
        return Err("database_contract_incompatible_or_fenced: use the matching host upgrade or isolated restore".into());
    }
    Ok(())
}
#[tokio::main]
async fn main() {
    let db = PgPoolOptions::new()
        .max_connections(12)
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL required"))
        .await
        .expect("database connection unavailable");
    verify_database_contract(&db)
        .await
        .expect("runtime preflight refused");
    let token = std::fs::read_to_string(
        std::env::var("INTERNAL_KEY_FILE").expect("internal key file required"),
    )
    .expect("internal key unavailable");
    assert!(token.len() >= 32, "invalid internal key");
    let a = App {
        db,
        token,
        cache: Arc::new(Mutex::new(lru::LruCache::new(
            NonZeroUsize::new(2000).unwrap(),
        ))),
        queries: Arc::new(Semaphore::new(32)),
        scoped_queries: Arc::new(Mutex::new(std::collections::HashMap::new())),
    };
    let app = Router::new()
        .route(
            "/health",
            get(|| async { Json(json!({"service":"engine","rpc_version":1,"runtime_contract":release_manifest()["runtime"]})) }),
        )
        .route("/v1/apply", post(apply))
        .route("/v1/state", post(query))
        .route("/v1/query", post(questions::handler))
        .layer(DefaultBodyLimit::max(64 * 1024))
        .with_state(a);
    let listener = tokio::net::TcpListener::bind(
        std::env::var("ENGINE_BIND").unwrap_or("127.0.0.1:18742".into()),
    )
    .await
    .unwrap();
    axum::serve(listener, app).await.unwrap();
}

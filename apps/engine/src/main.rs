use axum::{extract::{State,DefaultBodyLimit},http::{HeaderMap,StatusCode},routing::{get,post},Json,Router};
use blackbox_domain::{Input,Observation,State as BusinessState,RULE_VERSION};
use serde::Deserialize;
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use sqlx::{postgres::PgPoolOptions,PgPool,Postgres,Row,Transaction};
use std::{sync::Arc,num::NonZeroUsize};
use tokio::sync::{Mutex,Semaphore};
use uuid::Uuid;
use subtle::ConstantTimeEq;
#[derive(Clone)]struct App{db:PgPool,token:String,cache:Arc<Mutex<lru::LruCache<(Uuid,Uuid,i64),BusinessState>>>,queries:Arc<Semaphore>}
type Error=(StatusCode,Json<Value>);
fn error(code:&str)->Error{(StatusCode::SERVICE_UNAVAILABLE,Json(json!({"error":code})))}
fn internal(h:&HeaderMap,a:&App)->Result<(),Error>{let v=h.get("x-blackbox-internal").and_then(|v|v.to_str().ok()).unwrap_or("");if v.as_bytes().ct_eq(a.token.as_bytes()).unwrap_u8()!=1{return Err((StatusCode::UNAUTHORIZED,Json(json!({"error":"unauthorized"}))));}Ok(())}
async fn transaction(db:&PgPool,tenant:Uuid)->Result<Transaction<'_,Postgres>,Error>{let mut tx=db.begin().await.map_err(|_|error("database_unavailable"))?;sqlx::query("SELECT set_config('bb.tenant_id',$1,true)").bind(tenant.to_string()).execute(&mut *tx).await.map_err(|_|error("database_unavailable"))?;Ok(tx)}
async fn inputs(tx:&mut Transaction<'_,Postgres>,entity:Uuid,cutoff:i64,effective:Option<&str>)->Result<Vec<Input>,Error>{
 let rows=sqlx::query("SELECT entry_id,sequence,evidence_id,payload FROM bb.journal WHERE entity_id=$1 AND sequence<=$2 AND record_type='source' AND ($3::text::timestamptz IS NULL OR occurred_at<=$3::text::timestamptz) ORDER BY sequence LIMIT 5001").bind(entity).bind(cutoff).bind(effective).fetch_all(&mut **tx).await.map_err(|_|error("read_failed"))?;
 if rows.len()>5000{return Err(error("entity_history_too_large"));}
 rows.iter().map(|r|Ok(Input{entry_id:r.get::<Uuid,_>("entry_id").to_string(),sequence:r.get("sequence"),evidence_id:r.get::<Uuid,_>("evidence_id").to_string(),observation:serde_json::from_value(r.get("payload")).map_err(|_|error("unsupported_event"))?})).collect()
}
#[derive(Deserialize)]struct Apply{tenant_id:Uuid}
async fn apply(State(a):State<App>,h:HeaderMap,Json(req):Json<Apply>)->Result<Json<Value>,Error>{
 internal(&h,&a)?;let mut tx=transaction(&a.db,req.tenant_id).await?;
 let head=sqlx::query("SELECT committed,applied FROM bb.heads WHERE tenant_id=$1 FOR UPDATE").bind(req.tenant_id).fetch_one(&mut *tx).await.map_err(|_|error("scope_unavailable"))?;
 let mut end:i64=head.get("committed");
 let rows=sqlx::query("SELECT j.* FROM bb.journal j JOIN bb.outbox o USING(tenant_id,sequence) WHERE o.state='pending' ORDER BY j.sequence LIMIT 250").fetch_all(&mut *tx).await.map_err(|_|error("read_failed"))?;
 let mut entities=std::collections::BTreeSet::new();
 for r in &rows {
  let payload:Value=r.get("payload");let obs:Observation=serde_json::from_value(payload.clone()).map_err(|_|error("unsupported_event"))?;
  for track in blackbox_domain::derived_tracks(&obs.kind){
   end+=1;
   sqlx::query("INSERT INTO bb.journal(tenant_id,sequence,entry_id,record_type,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,input_entry_id,rule_version,correlation_id) SELECT tenant_id,$1,$2,$3,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,entry_id,$4,correlation_id FROM bb.journal WHERE entry_id=$5")
    .bind(end).bind(Uuid::new_v4()).bind(track).bind(RULE_VERSION).bind(r.get::<Uuid,_>("entry_id")).execute(&mut *tx).await.map_err(|_|error("derivation_failed"))?;
  }
  entities.insert(r.get::<Uuid,_>("entity_id"));
  sqlx::query("UPDATE bb.outbox SET state='applied' WHERE sequence=$1").bind(r.get::<i64,_>("sequence")).execute(&mut *tx).await.map_err(|_|error("checkpoint_failed"))?;
 }
 // Publish a tenant cutoff only after every preceding source has been applied.
 let pending:i64=sqlx::query_scalar("SELECT count(*) FROM bb.outbox WHERE state='pending'").fetch_one(&mut *tx).await.map_err(|_|error("read_failed"))?;
 let applied=if pending==0{end}else{head.get("applied")};
 let mut publish=vec![];
 for entity in entities {
  let state=blackbox_domain::reduce(&inputs(&mut tx,entity,end,None).await?).map_err(|_|error("reducer_conflict"))?;
  let value=serde_json::to_value(&state).map_err(|_|error("encode_failed"))?;
  let checksum=format!("{:x}",Sha256::digest(serde_json::to_vec(&value).unwrap()));
  sqlx::query("INSERT INTO bb.projections(tenant_id,entity_id,applied,rule_version,state,checksum) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(tenant_id,entity_id) DO UPDATE SET applied=EXCLUDED.applied,rule_version=EXCLUDED.rule_version,state=EXCLUDED.state,checksum=EXCLUDED.checksum,updated_at=now()")
   .bind(req.tenant_id).bind(entity).bind(end).bind(RULE_VERSION).bind(value).bind(checksum).execute(&mut *tx).await.map_err(|_|error("projection_failed"))?;
  publish.push((entity,state));
 }
 sqlx::query("UPDATE bb.heads SET committed=$2,applied=$3 WHERE tenant_id=$1").bind(req.tenant_id).bind(end).bind(applied).execute(&mut *tx).await.map_err(|_|error("checkpoint_failed"))?;
 tx.commit().await.map_err(|_|error("commit_failed"))?;
 {let mut cache=a.cache.lock().await;for(entity,state)in publish{cache.put((req.tenant_id,entity,end),state);}}
 Ok(Json(json!({"committed_cursor":end,"applied_cursor":applied,"processed":rows.len()})))
}
#[derive(Deserialize)]struct Query{tenant_id:Uuid,entity_id:Uuid,verifier:String,recorded_cutoff:Option<i64>,effective_at:Option<String>,at_least_cursor:Option<i64>}
async fn query(State(a):State<App>,h:HeaderMap,Json(q):Json<Query>)->Result<Json<Value>,Error>{
 internal(&h,&a)?;let _permit=a.queries.try_acquire().map_err(|_|(StatusCode::TOO_MANY_REQUESTS,Json(json!({"error":"query_capacity","retry_after_ms":250}))))?;
 let auth=sqlx::query("SELECT tenant_id,purpose FROM bb.authenticate($1)").bind(&q.verifier).fetch_optional(&a.db).await.map_err(|_|error("authorization_unavailable"))?;
 if !auth.is_some_and(|r|r.get::<Uuid,_>("tenant_id")==q.tenant_id&&["session","agent"].contains(&r.get::<String,_>("purpose").as_str())){return Err((StatusCode::UNAUTHORIZED,Json(json!({"error":"unauthorized"}))));}
 let mut tx=transaction(&a.db,q.tenant_id).await?;
 let head=sqlx::query("SELECT committed,applied FROM bb.heads WHERE tenant_id=$1").bind(q.tenant_id).fetch_one(&mut *tx).await.map_err(|_|error("scope_unavailable"))?;
 let committed:i64=head.get("committed");let applied:i64=head.get("applied");let cutoff=q.recorded_cutoff.unwrap_or(committed);
 if cutoff<0||cutoff>committed{return Err(error("invalid_cutoff"));}
 if applied<cutoff||applied<q.at_least_cursor.unwrap_or(0){return Err(error("projection_behind"));}
 let key=(q.tenant_id,q.entity_id,cutoff);
 let cached=if q.effective_at.is_none(){a.cache.lock().await.get(&key).cloned()}else{None};
 let (state,path)=if let Some(state)=cached{(state,"hot")}else{
  let projection=if q.effective_at.is_none(){sqlx::query("SELECT state,checksum,rule_version,applied FROM bb.projections WHERE entity_id=$1 AND applied<=$2").bind(q.entity_id).bind(cutoff).fetch_optional(&mut *tx).await.map_err(|_|error("read_failed"))?}else{None};
  let mut loaded=None;
  if let Some(r)=projection {
   let value:Value=r.get("state");let checksum=format!("{:x}",Sha256::digest(serde_json::to_vec(&value).unwrap()));
   let tail:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.journal WHERE entity_id=$1 AND record_type='source' AND sequence>$2 AND sequence<=$3)").bind(q.entity_id).bind(r.get::<i64,_>("applied")).bind(cutoff).fetch_one(&mut *tx).await.map_err(|_|error("read_failed"))?;
   if !tail&&r.get::<String,_>("checksum")==checksum&&r.get::<String,_>("rule_version")==RULE_VERSION{loaded=serde_json::from_value(value).ok();}
  }
  let state=match loaded{Some(s)=>s,None=>blackbox_domain::reduce(&inputs(&mut tx,q.entity_id,cutoff,q.effective_at.as_deref()).await?).map_err(|_|error("reducer_conflict"))?};
  if q.effective_at.is_none(){a.cache.lock().await.put(key,state.clone());}(state,"cold")
 };
 tx.commit().await.map_err(|_|error("read_failed"))?;
 // Recheck after potentially slow hydration so revoked grants cannot authorize delivery.
 let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.authenticate($1) WHERE tenant_id=$2)").bind(&q.verifier).bind(q.tenant_id).fetch_one(&a.db).await.map_err(|_|error("authorization_unavailable"))?;
 if !valid{return Err((StatusCode::UNAUTHORIZED,Json(json!({"error":"unauthorized"}))));}
 Ok(Json(json!({"status":if state.agreed_minor.is_some(){"partial"}else{"insufficient_data"},"result":state,"effective_at":q.effective_at,"recorded_cutoff":cutoff,"required_cursor":cutoff,"applied_cursor":applied,"rule_version":RULE_VERSION,"read_path":path,"coverage":{"basis":"observed_records_only","provider_completeness":"unverified"},"missing_inputs":["verified_payment_population_coverage"]})))
}
#[tokio::main]async fn main(){
 let db=PgPoolOptions::new().max_connections(12).connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL required")).await.expect("database connection unavailable");
 let token=std::fs::read_to_string(std::env::var("INTERNAL_KEY_FILE").expect("internal key file required")).expect("internal key unavailable");
 assert!(token.len()>=32,"invalid internal key");
 let a=App{db,token,cache:Arc::new(Mutex::new(lru::LruCache::new(NonZeroUsize::new(2000).unwrap()))),queries:Arc::new(Semaphore::new(32))};
 let app=Router::new().route("/health",get(||async{Json(json!({"service":"engine","rpc_version":1}))})).route("/v1/apply",post(apply)).route("/v1/state",post(query)).layer(DefaultBodyLimit::max(64*1024)).with_state(a);
 let listener=tokio::net::TcpListener::bind("0.0.0.0:8081").await.unwrap();axum::serve(listener,app).await.unwrap();
}

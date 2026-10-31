use super::*;
use blackbox_domain::questions::{Question, Record};
#[derive(Deserialize)]
pub struct Request {
    tenant_id: Uuid,
    verifier: String,
    recorded_cutoff: Option<i64>,
    effective_at: Option<String>,
    at_least_cursor: Option<i64>,
    request: Question,
}
pub async fn handler(
    state: State<App>,
    h: HeaderMap,
    req: Json<Request>,
) -> Result<Json<Value>, Error> {
    tokio::time::timeout(
        std::time::Duration::from_millis(4200),
        execute(state, h, req),
    )
    .await
    .unwrap_or_else(|_| Err(error("query_deadline_exceeded")))
}
async fn execute(
    State(a): State<App>,
    h: HeaderMap,
    Json(q): Json<Request>,
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
    let Some(auth) = auth.filter(|r| {
        r.get::<Uuid, _>("tenant_id") == q.tenant_id
            && ["session", "agent"].contains(&r.get::<String, _>("purpose").as_str())
    }) else {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        ));
    };
    let _scoped = admit_scoped(&a, q.tenant_id, auth.get("principal_id")).await?;
    let mut tx = transaction(&a.db, q.tenant_id).await?;
    sqlx::query("SET LOCAL statement_timeout='4000ms'")
        .execute(&mut *tx)
        .await
        .map_err(|_| error("read_failed"))?;
    let head = sqlx::query("SELECT committed,applied,record_count FROM bb.heads")
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
    require_supported_scope(&mut tx, cutoff, None).await?;
    let required = blackbox_domain::questions::INTENTS
        .iter()
        .find(|(id, _)| *id == q.request.intent)
        .ok_or_else(|| error("unsupported_intent"))?
        .1;
    let mut datasets: Vec<String> = required.iter().map(|s| s.to_string()).collect();
    datasets.push("coverage".into());
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM bb.current_records")
        .fetch_one(&mut *tx)
        .await
        .map_err(|_| error("read_failed"))?;
    let mut path = "record_projection";
    let mut rows = if cutoff == committed
        && q.effective_at.is_none()
        && count == head.get::<i64, _>("record_count")
    {
        sqlx::query("SELECT p.record_id,p.entity_id,p.connection_id,j.schema_version,j.event_type,to_char(p.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS occurred_at,p.payload,p.evidence_id,p.entry_id,p.checksum FROM bb.current_records p JOIN bb.journal j ON j.tenant_id=p.tenant_id AND j.entry_id=p.entry_id WHERE p.dataset=ANY($1) ORDER BY p.record_id LIMIT 20001").bind(&datasets).fetch_all(&mut *tx).await.map_err(|_|error("read_failed"))?
    } else {
        vec![]
    };
    let corrupt = rows.iter().any(|r| {
        let v: Value = r.get("payload");
        format!("{:x}", Sha256::digest(serde_json::to_vec(&v).unwrap()))
            != r.get::<String, _>("checksum")
    });
    if rows.is_empty() || corrupt {
        path = "indexed_cold_record_history";
        rows=sqlx::query("SELECT DISTINCT ON(j.record_id) j.record_id,j.entity_id,j.connection_id,j.schema_version,j.event_type,to_char(j.occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS occurred_at,j.payload->'record' AS payload,j.evidence_id,j.entry_id FROM bb.journal j WHERE j.record_type='source' AND j.payload ? 'record' AND j.payload->'record'->>'dataset'=ANY($1) AND j.sequence<=$2 AND ($3::text::timestamptz IS NULL OR j.occurred_at<=$3::text::timestamptz) AND NOT EXISTS(SELECT 1 FROM bb.journal correction WHERE correction.record_type='source' AND correction.supersedes_entry_id=j.entry_id AND correction.sequence<=$2 AND ($3::text::timestamptz IS NULL OR correction.occurred_at<=$3::text::timestamptz)) ORDER BY j.record_id,j.occurred_at DESC,j.sequence DESC LIMIT 20001").bind(&datasets).bind(cutoff).bind(&q.effective_at).fetch_all(&mut *tx).await.map_err(|_|error("read_failed"))?;
    }
    if rows.len() > 20000 {
        return Err(error("query_too_large_narrow_scope"));
    }
    for row in &rows {
        if row.get::<i32, _>("schema_version") != 1 {
            return Err(error("unsupported_event_version"));
        }
        let data: Value = row.get("payload");
        if blackbox_domain::reader::record_kind(&data).map_err(error)?
            != row.get::<String, _>("event_type")
        {
            return Err(error("unsupported_event"));
        }
    }
    let records: Vec<Record> = rows
        .iter()
        .map(|r| Record {
            id: r.get::<Uuid, _>("record_id").to_string(),
            entity_id: r.get::<Uuid, _>("entity_id").to_string(),
            connection_id: r.get::<Uuid, _>("connection_id").to_string(),
            occurred_at: r.get("occurred_at"),
            entry_id: r.get::<Uuid, _>("entry_id").to_string(),
            evidence_id: r.get::<Uuid, _>("evidence_id").to_string(),
            data: r.get("payload"),
        })
        .collect();
    let mut result = blackbox_domain::questions::execute(&records, &q.request)
        .map_err(|_| error("query_data_conflict"))?;
    let inputs: Vec<Uuid> = result["input_entries"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|v| v.as_str().and_then(|v| Uuid::parse_str(v).ok()))
        .collect();
    let decisions = sqlx::query("SELECT x.entry_id,d.decision_id,d.case_id,d.principal_id,d.reason_code,to_char(d.created_at AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS decided_at FROM bb.review_decision_entries x JOIN bb.review_decisions d USING(tenant_id,decision_id) WHERE x.entry_id=ANY($1) AND d.required_cursor<=$2")
        .bind(&inputs).bind(cutoff).fetch_all(&mut *tx).await.map_err(|_|error("read_failed"))?;
    result["human_confirmed_inputs"] = json!(decisions.iter().map(|r|json!({"entry_id":r.get::<Uuid,_>("entry_id"),"decision_id":r.get::<Uuid,_>("decision_id"),"case_id":r.get::<Uuid,_>("case_id"),"actor_id":r.get::<Uuid,_>("principal_id"),"reason_code":r.get::<String,_>("reason_code"),"decided_at":r.get::<String,_>("decided_at"),"origin":"human_confirmed"})).collect::<Vec<_>>());
    tx.commit().await.map_err(|_| error("read_failed"))?;
    let valid:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.authenticate($1) WHERE tenant_id=$2 AND purpose IN ('agent','session'))").bind(&q.verifier).bind(q.tenant_id).fetch_one(&a.db).await.map_err(|_|error("authorization_unavailable"))?;
    if !valid {
        return Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({"error":"unauthorized"})),
        ));
    };
    result["recorded_cutoff"] = json!(cutoff);
    result["required_cursor"] = json!(cutoff);
    result["applied_cursor"] = json!(applied);
    result["read_path"] = json!(path);
    Ok(Json(result))
}

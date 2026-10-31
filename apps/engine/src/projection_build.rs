//! Bounded candidate generations. Only the privileged host creates a build grant.
use super::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Request {
    tenant_id: Uuid,
    build_id: Uuid,
    action: String,
}

pub async fn handler(
    State(app): State<App>,
    headers: HeaderMap,
    Json(request): Json<Request>,
) -> Result<Json<Value>, Error> {
    internal(&headers, &app)?;
    if !["step", "publish"].contains(&request.action.as_str()) {
        return Err(error("unsupported_build_action"));
    }
    let result = tokio::time::timeout(std::time::Duration::from_secs(15), execute(&app, &request))
        .await
        .unwrap_or_else(|_| Err(error("projection_build_deadline")));
    // Persist terminal failures after the candidate transaction has rolled back.
    // Transient database/time-budget failures remain resumable at the last batch.
    if let Err((_, Json(value))) = &result {
        let code = value["error"].as_str().unwrap_or("");
        if [
            "unsupported_event",
            "reducer_conflict",
            "candidate_corrupt",
            "candidate_incomplete",
            "build_budget_exceeded",
        ]
        .contains(&code)
        {
            if let Ok(mut tx) = transaction(&app.db, request.tenant_id).await {
                if sqlx::query("UPDATE bb.projection_builds SET state='failed',error_code=$2,updated_at=now() WHERE build_id=$1 AND state NOT IN ('published','failed')")
                    .bind(request.build_id).bind(code).execute(&mut *tx).await.is_ok() {
                    let _ = tx.commit().await;
                }
            }
        }
    }
    result
}

fn checksum(value: &Value) -> String {
    format!("{:x}", Sha256::digest(serde_json::to_vec(value).unwrap()))
}

async fn checkpoint(
    tx: &mut Transaction<'_, Postgres>,
    build: Uuid,
    state: &str,
    cutoff: i64,
) -> Result<(), Error> {
    sqlx::query("UPDATE bb.projection_builds SET state=$2,source_cutoff=target_cutoff,target_cutoff=$3,scan_cursor=NULL,verify_cursor=NULL,verified_count=0,updated_at=now() WHERE build_id=$1")
        .bind(build).bind(state).bind(cutoff).execute(&mut **tx).await.map_err(|_|error("build_checkpoint_failed"))?;
    Ok(())
}

async fn execute(app: &App, request: &Request) -> Result<Json<Value>, Error> {
    let mut tx = transaction(&app.db, request.tenant_id).await?;
    sqlx::query("SET LOCAL statement_timeout='5000ms'")
        .execute(&mut *tx)
        .await
        .map_err(|_| error("build_unavailable"))?;
    let build = sqlx::query("SELECT * FROM bb.projection_builds WHERE build_id=$1 FOR UPDATE")
        .bind(request.build_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|_| error("build_unavailable"))?
        .ok_or_else(|| error("host_build_grant_required"))?;
    let state: String = build.get("state");
    if state == "published" {
        return Ok(Json(
            json!({"state":"published","build_id":request.build_id,"recorded_cutoff":build.get::<i64,_>("target_cutoff")}),
        ));
    }
    if state == "failed" {
        return Err(error("build_requires_explicit_retry"));
    }
    let head = sqlx::query(
        "SELECT committed,applied,projection_generation,projection_rule FROM bb.heads FOR UPDATE",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|_| error("scope_unavailable"))?;
    if head.get::<Uuid, _>("projection_generation") != build.get::<Uuid, _>("source_generation_id")
        || head.get::<String, _>("projection_rule") != build.get::<String, _>("source_rule")
    {
        sqlx::query("UPDATE bb.projection_builds SET state='failed',error_code='source_generation_changed',updated_at=now() WHERE build_id=$1")
            .bind(request.build_id).execute(&mut *tx).await.map_err(|_|error("build_checkpoint_failed"))?;
        tx.commit().await.map_err(|_| error("commit_failed"))?;
        return Err(error("source_generation_changed"));
    }
    let current: i64 = head.get("committed");
    if head.get::<i64, _>("applied") != current {
        return Err(error("projection_behind"));
    }
    let cutoff: i64 = build.get("target_cutoff");
    let from: i64 = build.get("source_cutoff");
    let rule: String = build.get("target_rule");
    if rule != "lifecycle-v3" || cutoff > current {
        return Err(error("build_contract_invalid"));
    }
    let mut outcome = state.clone();
    let mut processed = 0;
    if state == "scanning" || state == "catching_up" {
        if request.action != "step" {
            return Err(error("build_not_verified"));
        }
        let entities: Vec<Uuid> = sqlx::query_scalar("SELECT DISTINCT entity_id FROM bb.journal WHERE record_type='source' AND sequence<=$1 AND ($2::uuid IS NULL OR entity_id>$2) AND ($3::boolean OR sequence>$4) ORDER BY entity_id LIMIT 25")
            .bind(cutoff).bind(build.get::<Option<Uuid>,_>("scan_cursor")).bind(state=="scanning").bind(from)
            .fetch_all(&mut *tx).await.map_err(|_|error("build_scan_failed"))?;
        for entity in &entities {
            let state = blackbox_domain::reduce_version(
                &inputs(&mut tx, *entity, cutoff, None).await?,
                &rule,
            )
            .map_err(|_| error("reducer_conflict"))?;
            let value = serde_json::to_value(state).map_err(|_| error("encode_failed"))?;
            let hash = checksum(&value);
            sqlx::query("INSERT INTO bb.projections(tenant_id,generation_id,entity_id,applied,rule_version,state,checksum)VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(tenant_id,generation_id,entity_id) DO UPDATE SET applied=EXCLUDED.applied,rule_version=EXCLUDED.rule_version,state=EXCLUDED.state,checksum=EXCLUDED.checksum,verified_checksum=NULL,updated_at=now()")
                .bind(request.tenant_id).bind(request.build_id).bind(entity).bind(cutoff).bind(&rule).bind(value).bind(hash)
                .execute(&mut *tx).await.map_err(|_|error("candidate_write_failed"))?;
        }
        processed = entities.len();
        if let Some(last) = entities.last() {
            sqlx::query("UPDATE bb.projection_builds SET scan_cursor=$2,built_count=built_count+$3,updated_at=now() WHERE build_id=$1")
                .bind(request.build_id).bind(last).bind(entities.len()as i64).execute(&mut *tx).await.map_err(|_|error("build_checkpoint_failed"))?;
            if build.get::<i64, _>("built_count") + entities.len() as i64 > 100000 {
                return Err(error("build_budget_exceeded"));
            }
        } else if current > cutoff {
            checkpoint(&mut tx, request.build_id, "catching_up", current).await?;
            outcome = "catching_up".into();
        } else {
            checkpoint(&mut tx, request.build_id, "verifying", cutoff).await?;
            outcome = "verifying".into();
        }
    } else if state == "verifying" {
        if request.action != "step" {
            return Err(error("build_not_verified"));
        }
        if current > cutoff {
            checkpoint(&mut tx, request.build_id, "catching_up", current).await?;
            outcome = "catching_up".into();
        } else {
            let rows = sqlx::query("SELECT entity_id,applied,rule_version,state,checksum FROM bb.projections WHERE generation_id=$1 AND ($2::uuid IS NULL OR entity_id>$2) ORDER BY entity_id LIMIT 25")
                .bind(request.build_id).bind(build.get::<Option<Uuid>,_>("verify_cursor")).fetch_all(&mut *tx).await.map_err(|_|error("candidate_read_failed"))?;
            for row in &rows {
                let entity: Uuid = row.get("entity_id");
                let actual: Value = row.get("state");
                let expected = serde_json::to_value(
                    blackbox_domain::reduce_version(
                        &inputs(&mut tx, entity, cutoff, None).await?,
                        &rule,
                    )
                    .map_err(|_| error("reducer_conflict"))?,
                )
                .map_err(|_| error("encode_failed"))?;
                let hash: String = row.get("checksum");
                if row.get::<String, _>("rule_version") != rule
                    || row.get::<i64, _>("applied") > cutoff
                    || checksum(&actual) != hash
                    || actual != expected
                {
                    return Err(error("candidate_corrupt"));
                }
                sqlx::query("UPDATE bb.projections SET verified_checksum=$3 WHERE generation_id=$1 AND entity_id=$2")
                    .bind(request.build_id).bind(entity).bind(hash).execute(&mut *tx).await.map_err(|_|error("build_checkpoint_failed"))?;
            }
            processed = rows.len();
            if let Some(last) = rows.last() {
                sqlx::query("UPDATE bb.projection_builds SET verify_cursor=$2,verified_count=verified_count+$3,updated_at=now() WHERE build_id=$1")
                    .bind(request.build_id).bind(last.get::<Uuid,_>("entity_id")).bind(rows.len()as i64)
                    .execute(&mut *tx).await.map_err(|_|error("build_checkpoint_failed"))?;
            } else {
                let missing: bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.journal j WHERE record_type='source' AND sequence<=$2 AND NOT EXISTS(SELECT 1 FROM bb.projections p WHERE p.tenant_id=j.tenant_id AND p.generation_id=$1 AND p.entity_id=j.entity_id))")
                    .bind(request.build_id).bind(cutoff).fetch_one(&mut *tx).await.map_err(|_|error("build_scan_failed"))?;
                if missing {
                    return Err(error("candidate_incomplete"));
                }
                sqlx::query("UPDATE bb.projection_builds SET state='ready',updated_at=now() WHERE build_id=$1")
                    .bind(request.build_id).execute(&mut *tx).await.map_err(|_|error("build_checkpoint_failed"))?;
                outcome = "ready".into();
            }
        }
    } else if state == "ready" {
        if current > cutoff {
            checkpoint(&mut tx, request.build_id, "catching_up", current).await?;
            outcome = "catching_up".into();
        } else if request.action == "publish" {
            // Check every verified row again under the publication lock. No partial
            // pointer switch can escape; failed checks leave the old generation live.
            let mut cursor: Option<Uuid> = None;
            let mut count = 0i64;
            loop {
                let rows=sqlx::query("SELECT entity_id,rule_version,state,checksum,verified_checksum FROM bb.projections WHERE generation_id=$1 AND ($2::uuid IS NULL OR entity_id>$2) ORDER BY entity_id LIMIT 100")
                    .bind(request.build_id).bind(cursor).fetch_all(&mut *tx).await.map_err(|_|error("candidate_read_failed"))?;
                if rows.is_empty() {
                    break;
                }
                for row in &rows {
                    let value: Value = row.get("state");
                    let hash: String = row.get("checksum");
                    if row.get::<String, _>("rule_version") != rule
                        || value["rule_version"] != rule
                        || row.get::<Option<String>, _>("verified_checksum").as_deref()
                            != Some(hash.as_str())
                        || checksum(&value) != hash
                    {
                        return Err(error("candidate_corrupt"));
                    }
                    cursor = Some(row.get("entity_id"));
                    count += 1;
                    if count > 100000 {
                        return Err(error("build_budget_exceeded"));
                    }
                }
            }
            if count != build.get::<i64, _>("verified_count") {
                return Err(error("candidate_incomplete"));
            }
            let expected_count: i64 = sqlx::query_scalar("SELECT count(DISTINCT entity_id) FROM bb.journal WHERE record_type='source' AND sequence<=$1")
                .bind(cutoff).fetch_one(&mut *tx).await.map_err(|_|error("build_scan_failed"))?;
            let mismatched: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM bb.journal j WHERE record_type='source' AND sequence<=$2 AND NOT EXISTS(SELECT 1 FROM bb.projections p WHERE p.tenant_id=j.tenant_id AND p.generation_id=$1 AND p.entity_id=j.entity_id))")
                .bind(request.build_id).bind(cutoff).fetch_one(&mut *tx).await.map_err(|_|error("build_scan_failed"))?;
            if count != expected_count || mismatched {
                return Err(error("candidate_incomplete"));
            }
            sqlx::query("UPDATE bb.heads SET projection_generation=$1,projection_rule=$2")
                .bind(request.build_id)
                .bind(&rule)
                .execute(&mut *tx)
                .await
                .map_err(|_| error("publication_failed"))?;
            sqlx::query("UPDATE bb.projection_builds SET state='published',published_at=now(),updated_at=now() WHERE build_id=$1")
                .bind(request.build_id).execute(&mut *tx).await.map_err(|_|error("publication_failed"))?;
            sqlx::query("INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES($1,$2,$2,'projection.generation_published')")
                .bind(request.tenant_id).bind(request.build_id).execute(&mut *tx).await.map_err(|_|error("publication_audit_failed"))?;
            outcome = "published".into();
        }
    } else {
        return Err(error("unknown_build_phase"));
    }
    tx.commit().await.map_err(|_| error("commit_failed"))?;
    Ok(Json(
        json!({"state":outcome,"build_id":request.build_id,"processed":processed,"recorded_cutoff":cutoff,"target_rule":rule}),
    ))
}

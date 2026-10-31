import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { pool, scoped } from "../database/index.js";
import { openSecret, sealSecret, opaqueIdentity } from "../auth/secrets.js";
import {
  authorizeShopify,
  validateShopify,
} from "../connectors/shopify-client.js";
import { ProviderError } from "../connectors/transport.js";
import {
  fetchOrderPage,
  normalizeSourceOrder,
  scopedSnapshotCoverage,
  type Checkpoint,
  type ImportParameters,
  type SourceObject,
} from "../connectors/shopify-source.js";
import { enqueueJob } from "./sources.js";
import { ingest, type IngestResult } from "./ingest.js";
import { log } from "../diagnostics/index.js";
type Job = {
  tenant_id: string;
  job_id: string;
  connection_id: string;
  plan_id: string;
  capability: string;
  kind: string;
  run_id: string;
  fence: string;
  lease_owner: string;
  checkpoint: Checkpoint;
  parameters: ImportParameters;
  account_anchor: string;
  attempts: number;
  phase: string;
  secret_revision: number;
  sealed: unknown;
};
const workerId = randomUUID();
export class LostLease extends Error {}
export async function assertLease(c: PoolClient, j: Job) {
  // Job/connection locks serialize pause, reconnect, expiry and the journal+cohort commit.
  const valid = await c.query(
    `SELECT 1 FROM bb.source_jobs j JOIN bb.connections c USING(tenant_id,connection_id)
    JOIN bb.source_secrets s USING(tenant_id,connection_id)
    WHERE j.job_id=$1 AND j.fence=$2 AND j.lease_owner=$3 AND j.state='running'
    AND j.leased_until>clock_timestamp() AND c.state NOT IN ('paused','disconnected','reauthorization_required')
    AND s.revision=$4 FOR UPDATE OF j,c,s`,
    [j.job_id, j.fence, j.lease_owner, j.secret_revision],
  );
  if (!valid.rowCount) throw new LostLease();
}
export async function claimSourceJob(tenant: string): Promise<Job | null> {
  return scoped(tenant, async (c) => {
    const candidate = (
      await c.query(`SELECT j.job_id FROM bb.source_jobs j JOIN bb.connections c USING(tenant_id,connection_id)
      WHERE j.state IN ('queued','running') AND j.next_at<=now() AND (j.leased_until IS NULL OR j.leased_until<now())
      AND c.state NOT IN ('paused','disconnected','reauthorization_required')
      AND NOT EXISTS(SELECT 1 FROM bb.source_jobs other WHERE other.tenant_id=j.tenant_id AND other.connection_id=j.connection_id
        AND other.capability=j.capability AND other.job_id<>j.job_id AND other.state='running')
      ORDER BY j.next_at,CASE j.kind WHEN 'incremental' THEN 0 ELSE 1 END,j.created_at LIMIT 1 FOR UPDATE OF j,c SKIP LOCKED`)
    ).rows[0];
    if (!candidate) return null;
    await c.query(
      "UPDATE bb.source_jobs SET state='running',lease_owner=$2,leased_until=now()+interval '60 seconds',fence=fence+1,attempts=attempts+1,updated_at=now() WHERE job_id=$1",
      [candidate.job_id, workerId],
    );
    const j = (
      await c.query(
        `SELECT j.*,p.parameters,c.account_anchor,s.sealed,s.revision secret_revision FROM bb.source_jobs j
      JOIN bb.import_plans p USING(tenant_id,plan_id) JOIN bb.connections c ON c.tenant_id=j.tenant_id AND c.connection_id=j.connection_id
      JOIN bb.source_secrets s ON s.tenant_id=j.tenant_id AND s.connection_id=j.connection_id WHERE j.job_id=$1`,
        [candidate.job_id],
      )
    ).rows[0] as Job;
    if (!j.checkpoint.through) {
      j.checkpoint.through = new Date().toISOString();
      await c.query("UPDATE bb.source_jobs SET checkpoint=$2 WHERE job_id=$1", [
        j.job_id,
        j.checkpoint,
      ]);
    }
    await c.query(
      "UPDATE bb.import_runs SET state='running',phase=$2,updated_at=now() WHERE run_id=$1",
      [j.run_id, j.phase],
    );
    await c.query(
      "UPDATE bb.source_health SET last_attempt_at=now(),observed_at=now() WHERE connection_id=$1 AND capability=$2",
      [j.connection_id, j.capability],
    );
    return j;
  });
}
async function objectCommitted(
  c: PoolClient,
  j: Job,
  o: SourceObject,
  r: IngestResult,
) {
  const state =
    o.error_code || r.conflicts
      ? "quarantined"
      : o.skipped
        ? "skipped"
        : r.added
          ? "committed"
          : "duplicate";
  await c.query(
    `INSERT INTO bb.import_objects(tenant_id,run_id,object_id,dataset,state,emitted_entries,required_cursor,evidence_id,error_code)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(tenant_id,run_id,object_id) DO UPDATE SET
    state=CASE WHEN bb.import_objects.state='committed' AND EXCLUDED.state='duplicate' THEN 'committed' ELSE EXCLUDED.state END,
    emitted_entries=bb.import_objects.emitted_entries+EXCLUDED.emitted_entries,required_cursor=GREATEST(bb.import_objects.required_cursor,EXCLUDED.required_cursor),
    evidence_id=EXCLUDED.evidence_id,error_code=EXCLUDED.error_code`,
    [
      j.tenant_id,
      j.run_id,
      o.object_id,
      o.dataset,
      state,
      r.added,
      r.committed_cursor,
      r.evidence_id,
      o.error_code ?? (r.conflicts ? "provider_content_conflict" : null),
    ],
  );
  if (r.review_case_ids.length) {
    await c.query(
      "UPDATE bb.review_cases SET run_id=COALESCE(run_id,$2),object_id=COALESCE(object_id,$3) WHERE case_id=ANY($1::uuid[])",
      [r.review_case_ids, j.run_id, o.object_id],
    );
  }
  if (state === "quarantined" && !r.review_case_ids.length)
    await c.query(
      `INSERT INTO bb.review_cases(tenant_id,case_id,connection_id,kind,evidence_id,run_id,object_id)
    VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [
        j.tenant_id,
        randomUUID(),
        j.connection_id,
        o.error_code ?? "provider_content_conflict",
        r.evidence_id,
        j.run_id,
        o.object_id,
      ],
    );
  if (r.added)
    await c.query(
      "UPDATE bb.source_health SET last_new_at=now(),observed_at=now() WHERE connection_id=$1 AND capability=$2",
      [j.connection_id, j.capability],
    );
  await c.query(
    `UPDATE bb.import_runs SET fetched=(SELECT count(*) FROM bb.import_objects WHERE run_id=$1),
    committed=(SELECT count(*) FROM bb.import_objects WHERE run_id=$1 AND state IN ('committed','duplicate')),
    last_new_at=CASE WHEN $2>0 THEN now() ELSE last_new_at END,updated_at=now() WHERE run_id=$1`,
    [j.run_id, r.added],
  );
}
export async function commitSourceObject(j: Job, o: SourceObject) {
  return ingest(j.tenant_id, j.connection_id, o.observations, o.raw, {
    providerSnapshot: true,
    before: (c) => assertLease(c, j),
    committed: (c, r) => objectCommitted(c, j, o, r),
  });
}
async function yieldPage(
  j: Job,
  checkpoint: Checkpoint,
  phase: string,
  delay = 250,
) {
  await scoped(j.tenant_id, async (c) => {
    await assertLease(c, j);
    await c.query(
      "UPDATE bb.source_jobs SET state='queued',phase=$2,checkpoint=$3,attempts=0,lease_owner=NULL,leased_until=NULL,next_at=now()+$4::interval,error_code=NULL,updated_at=now() WHERE job_id=$1",
      [j.job_id, phase, checkpoint, delay + " milliseconds"],
    );
    await c.query(
      "UPDATE bb.import_runs SET state='running',phase=$2,cursor=$3,updated_at=now() WHERE run_id=$1",
      [j.run_id, phase, checkpoint.after],
    );
  });
}
async function finish(j: Job) {
  await scoped(j.tenant_id, async (c) => {
    await assertLease(c, j);
    const head = (await c.query("SELECT committed,applied FROM bb.heads"))
        .rows[0],
      pending = (
        await c.query(
          "SELECT 1 FROM bb.import_objects WHERE run_id=$1 AND required_cursor>$2 LIMIT 1",
          [j.run_id, head.applied],
        )
      ).rowCount;
    if (pending || Number(head.applied) < (j.checkpoint.required_cursor ?? 0)) {
      await c.query(
        "UPDATE bb.source_jobs SET state='queued',lease_owner=NULL,leased_until=NULL,next_at=now()+interval '1 second',attempts=0 WHERE job_id=$1",
        [j.job_id],
      );
      return;
    }
    const quarantined = Number(
      (
        await c.query(
          "SELECT count(*) FROM bb.import_objects WHERE run_id=$1 AND state='quarantined'",
          [j.run_id],
        )
      ).rows[0].count,
    );
    const unresolved = Number(
      (
        await c.query(
          "SELECT count(DISTINCT r.object_id) FROM bb.review_cases r JOIN bb.source_jobs prior USING(tenant_id,run_id) WHERE r.connection_id=$1 AND prior.capability=$2 AND r.state<>'resolved'",
          [j.connection_id, j.capability],
        )
      ).rows[0].count,
    );
    const coverage = {
      quarantined_objects: quarantined,
      unresolved_review_objects: unresolved,
      requested_from: j.parameters.requested_from,
      checked_from: j.checkpoint.from,
      checked_through: j.checkpoint.through,
      history_kind: "mixed",
      history_completeness: "partial",
      restrictions: j.parameters.restrictions ?? [],
      opening_state: j.parameters.include_opening_state
        ? "not_provided_by_orders"
        : "declined",
      related_context: j.parameters.include_related_records
        ? "accessible_only"
        : "declined",
      required_cursor: Number(head.applied),
      run_id: j.run_id,
    };
    await c.query(
      "INSERT INTO bb.source_checks(tenant_id,check_id,connection_id,capability,run_id,scope,outcome,committed_cursor)VALUES($1,$2,$3,$4,$5,$6,'complete_with_gaps',$7)",
      [
        j.tenant_id,
        randomUUID(),
        j.connection_id,
        j.capability,
        j.run_id,
        coverage,
        head.applied,
      ],
    );
    await c.query(
      "UPDATE bb.source_jobs SET state='complete_with_gaps',phase=CASE WHEN $2>0 THEN 'needs_review' ELSE 'ready_for_queries' END,completed_at=now(),updated_at=now(),lease_owner=NULL,leased_until=NULL,attempts=0,error_code=CASE WHEN $2>0 THEN 'source_records_quarantined' ELSE NULL END WHERE job_id=$1",
      [j.job_id, quarantined],
    );
    await c.query(
      "UPDATE bb.import_runs SET state='complete_with_gaps',phase=CASE WHEN $2>0 THEN 'needs_review' ELSE 'ready_for_queries' END,completed_at=now(),last_success_at=CASE WHEN $2=0 THEN now() ELSE last_success_at END,updated_at=now(),error_code=CASE WHEN $2>0 THEN 'source_records_quarantined' ELSE NULL END WHERE run_id=$1",
      [j.run_id, quarantined],
    );
    const health = (
      await c.query(
        "SELECT * FROM bb.source_health WHERE connection_id=$1 AND capability=$2 FOR UPDATE",
        [j.connection_id, j.capability],
      )
    ).rows[0];
    await c.query(
      `UPDATE bb.source_health SET collection_state=CASE WHEN $6>0 THEN 'needs_review' ELSE 'ready_with_gaps' END,observed_at=now(),last_success_at=CASE WHEN $5=0 THEN now() ELSE last_success_at END,coverage=$3,error_code=CASE WHEN $6>0 THEN 'source_records_quarantined' ELSE NULL END,next_action=CASE WHEN $6>0 THEN 'review_source_records' ELSE 'inspect_coverage' END,
      last_reconciliation_at=CASE WHEN $4='reconciliation' AND $5=0 THEN now() ELSE last_reconciliation_at END WHERE connection_id=$1 AND capability=$2`,
      [
        j.connection_id,
        j.capability,
        coverage,
        j.kind,
        quarantined,
        unresolved,
      ],
    );
    await c.query(
      "UPDATE bb.connections SET state='degraded' WHERE connection_id=$1 AND state NOT IN ('paused','disconnected','reauthorization_required')",
      [j.connection_id],
    );
    if (["incremental", "reconciliation"].includes(j.kind)) {
      const seconds =
        j.kind === "incremental"
          ? health.poll_seconds
          : health.reconciliation_seconds;
      const next = new Date(
          Date.now() +
            seconds * 1000 +
            Math.floor(Math.random() * seconds * 100),
        ).toISOString(),
        latest = (
          await c.query(
            "SELECT plan_id,parameters FROM bb.import_plans WHERE connection_id=$1 ORDER BY revision DESC LIMIT 1",
            [j.connection_id],
          )
        ).rows[0],
        from =
          j.kind === "incremental"
            ? new Date(
                Math.max(
                  Date.parse(latest.parameters.requested_from),
                  Date.parse(j.checkpoint.through!) - 300000,
                ),
              ).toISOString()
            : latest.parameters.requested_from;
      await enqueueJob(
        c,
        j.tenant_id,
        j.connection_id,
        latest.plan_id,
        j.capability,
        j.kind,
        { from, stage: "recent", after: null, pages: 0 },
        next,
      );
      await c.query(
        `UPDATE bb.source_health SET ${j.kind === "incremental" ? "next_poll_at" : "next_reconciliation_at"}=$3 WHERE connection_id=$1 AND capability=$2`,
        [j.connection_id, j.capability, next],
      );
    }
  });
}
async function fail(j: Job, error: unknown) {
  if (error instanceof LostLease) return;
  const e =
    error instanceof ProviderError
      ? error
      : new ProviderError(
          error instanceof z.ZodError
            ? "provider_schema_changed"
            : "source_processing_failed",
        );
  const delay =
    Math.max(
      e.retryAfterMs,
      Math.min(3600000, 1000 * 2 ** Math.min(j.attempts, 12)),
    ) + Math.floor(Math.random() * 1000);
  const terminal = e.reauthorization || j.attempts >= 8,
    state = e.reauthorization
      ? "reauthorization_required"
      : terminal
        ? "failed"
        : "queued";
  await scoped(j.tenant_id, async (c) => {
    // Expired leases may record a retry only while their fencing token still owns the job.
    const result = await c.query(
      "UPDATE bb.source_jobs SET state=$4,error_code=$5,next_at=now()+$6::interval,lease_owner=NULL,leased_until=NULL,updated_at=now() WHERE job_id=$1 AND fence=$2 AND lease_owner=$3 AND state='running' RETURNING run_id",
      [
        j.job_id,
        j.fence,
        j.lease_owner,
        state,
        e.code,
        delay + " milliseconds",
      ],
    );
    if (!result.rowCount) return;
    await c.query(
      "UPDATE bb.import_runs SET state=$2,error_code=$3,next_action=$4,updated_at=now() WHERE run_id=$1",
      [
        j.run_id,
        state,
        e.code,
        terminal ? "owner_retry_required" : "scheduled_retry",
      ],
    );
    await c.query(
      "UPDATE bb.source_health SET collection_state=$3,error_code=$4,next_action=$5,observed_at=now() WHERE connection_id=$1 AND capability=$2",
      [
        j.connection_id,
        j.capability,
        terminal ? state : "retry_wait",
        e.code,
        terminal ? "reconnect_or_retry" : "scheduled_retry",
      ],
    );
    if (e.reauthorization)
      await c.query(
        "UPDATE bb.connections SET state='reauthorization_required' WHERE connection_id=$1",
        [j.connection_id],
      );
  });
  log("source.retry_scheduled", {
    tenant_id: j.tenant_id,
    connection_id: j.connection_id,
    run_id: j.run_id,
    error_code: e.code,
  });
}
export async function processSourceJob(j: Job) {
  try {
    if (j.phase === "link_and_process") {
      await finish(j);
      return;
    }
    const secret = await openSecret(j.tenant_id, j.connection_id, j.sealed);
    const credentials = await authorizeShopify(secret.credentials);
    // Scope and immutable account identity are checked on every logical page, including after token renewal.
    const validated = await validateShopify(credentials);
    if (validated.account_id !== secret.account_id)
      throw new ProviderError("provider_account_changed", 0, true);
    if (JSON.stringify(credentials) !== JSON.stringify(secret.credentials)) {
      const sealed = await sealSecret(j.tenant_id, j.connection_id, {
        ...secret,
        credentials,
      });
      await scoped(j.tenant_id, async (c) => {
        await assertLease(c, j);
        await c.query(
          "UPDATE bb.source_secrets SET sealed=$2,validated_at=now(),scopes=$3,updated_at=now() WHERE connection_id=$1",
          [j.connection_id, sealed, validated.scopes],
        );
      });
    }
    const data = await fetchOrderPage(
      credentials,
      j.capability,
      j.checkpoint,
      j.parameters,
      AbortSignal.timeout(45000),
    );
    for (const raw of data.nodes) {
      let objects: SourceObject[];
      try {
        objects = await normalizeSourceOrder(
          raw,
          j.connection_id,
          j.account_anchor,
          j.capability,
          j.parameters,
          j.checkpoint.stage,
        );
      } catch (e) {
        const id = z.object({ id: z.string() }).parse(raw).id;
        objects = [
          {
            object_id: await opaqueIdentity(
              j.connection_id,
              j.capability + ":" + id,
            ),
            dataset: j.capability,
            observations: [],
            raw,
            error_code:
              e instanceof ProviderError ? e.code : "provider_record_invalid",
          },
        ];
      }
      let conflict = false;
      const sourceEvidence: string[] = [];
      for (const object of objects) {
        const result = await commitSourceObject(j, object);
        conflict ||= result.conflicts > 0;
        sourceEvidence.push(result.evidence_id);
      }
      const source = z
        .object({ createdAt: z.iso.datetime({ offset: true }) })
        .safeParse(raw);
      if (
        source.success &&
        !objects.some((o) => o.error_code || o.skipped) &&
        (!j.parameters.strict_from_now ||
          Date.parse(source.data.createdAt) >=
            Date.parse(j.parameters.requested_from))
      ) {
        const observations = await scopedSnapshotCoverage(
          raw,
          j.connection_id,
          j.capability,
          j.checkpoint.through!,
          conflict,
        );
        const result = await ingest(
          j.tenant_id,
          j.connection_id,
          observations,
          {
            snapshot_scope: true,
            capability: j.capability,
            checked_through: j.checkpoint.through,
            source_evidence_ids: sourceEvidence,
          },
          {
            before: (c) => assertLease(c, j),
          },
        );
        j.checkpoint.required_cursor = Math.max(
          j.checkpoint.required_cursor ?? 0,
          result.committed_cursor,
        );
      }
    }
    log("source.fetched", {
      tenant_id: j.tenant_id,
      connection_id: j.connection_id,
      run_id: j.run_id,
      record_count: data.nodes.length,
    });
    const next = {
      ...j.checkpoint,
      after: data.pageInfo.endCursor,
      pages: j.checkpoint.pages + 1,
    };
    if (data.pageInfo.hasNextPage) {
      await yieldPage(j, next, "import_records");
      return;
    }
    if (
      j.checkpoint.stage === "recent" &&
      j.parameters.include_open_items &&
      j.kind !== "incremental"
    ) {
      await yieldPage(
        j,
        { ...next, stage: "open", after: null },
        "import_records",
      );
      return;
    }
    await yieldPage(j, next, "link_and_process");
  } catch (e) {
    await fail(j, e);
  }
}
// One bounded page per tenant and at most two concurrent sources; collection does not block projection delivery.
let cursor = 0;
export async function sourceTick() {
  const tenants = (
    await pool.query(
      "SELECT * FROM bb.pending_source_tenants() ORDER BY tenant_id",
    )
  ).rows;
  if (!tenants.length) return;
  const selected = [
    ...tenants.slice(cursor),
    ...tenants.slice(0, cursor),
  ].slice(0, 2);
  cursor = (cursor + selected.length) % tenants.length;
  const results = await Promise.allSettled(
    selected.map(async ({ tenant_id }) => {
      const job = await claimSourceJob(tenant_id);
      if (job) await processSourceJob(job);
    }),
  );
  results.forEach((result, index) => {
    if (result.status === "rejected")
      log("source.scheduler_failed", { tenant_id: selected[index].tenant_id });
  });
}

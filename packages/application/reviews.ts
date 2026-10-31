import { runtimeFingerprint } from "../runtime/compatibility.js";
import { randomUUID, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { scoped } from "../database/index.js";
import {
  datasetRecord,
  recordKind,
  type RecordObservation,
} from "../contracts/records.js";
import { type Principal, verifier, authenticate } from "../auth/index.js";
import { opaqueIdentity } from "../auth/secrets.js";
import { canonical } from "../auth/producer.js";
import { ingest } from "./ingest.js";
import type { IngestObservation } from "../contracts/index.js";
import { log } from "../diagnostics/index.js";
import { readEvidence } from "./evidence.js";
import {
  normalizeSourceOrder,
  type ImportParameters,
} from "../connectors/shopify-source.js";
import type { PoolClient } from "pg";
import { normalizeStock } from "../connectors/shopify-stock.js";
import { normalizeAllocations } from "../connectors/shopify-allocations.js";
import { normalizeFulfillments } from "../connectors/shopify-fulfillments.js";

const catalogue = JSON.parse(
  await readFile(
    new URL("../../specs/question-data-contracts.json", import.meta.url),
    "utf8",
  ),
);
function affected(dataset: string): string[] {
  const intents = catalogue.questions
    .filter(
      (q: any) =>
        q.required_datasets.includes(dataset) ||
        q.optional_datasets.includes(dataset),
    )
    .map((q: any) => q.intent);
  // The implementation also reads dispatch facts to compute remaining fulfillment need.
  if (dataset === "fulfillments") intents.push("orders.fulfillable");
  return [...new Set<string>(intents)];
}
export class ReviewError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
class ExistingDecision extends Error {
  constructor(public result: unknown) {
    super("decision_exists");
  }
}
export const decisionInput = z
  .object({
    command_id: z.uuid(),
    revision: z.number().int().positive(),
    action: z.enum([
      "leave",
      "retry",
      "correct",
      "confirm_link",
      "reject_link",
    ]),
    reason_code: z.enum([
      "original_confirmed",
      "provider_claim_confirmed",
      "external_document",
      "human_observation",
      "link_confirmed",
      "link_rejected",
      "retry_mapping",
      "needs_more_evidence",
    ]),
    note: z.string().trim().min(10).max(2000),
    evidence_ids: z.array(z.uuid()).max(20),
    supporting_content: z.string().max(65536).optional(),
    expected_entry_id: z.uuid().optional(),
    record: datasetRecord.optional(),
    acknowledged: z.literal(true),
  })
  .strict();
type DecisionInput = z.infer<typeof decisionInput>;
async function active(c: PoolClient, p: Principal) {
  const row = await c.query(
    "SELECT 1 FROM bb.credentials WHERE credential_id=$1 AND principal_id=$2 AND purpose='session' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND (idle_seconds IS NULL OR COALESCE(last_used_at,created_at)+make_interval(secs=>idle_seconds)>clock_timestamp()) FOR SHARE",
    [p.credential_id, p.principal_id],
  );
  if (!row.rowCount) throw new ReviewError("unauthorized", 401);
}
async function details(c: PoolClient, id: string) {
  const row = (
    await c.query(
      `SELECT r.*,s.provider,s.account_anchor,s.config->>'name' source_name,
    j.entity_id,j.record_id,j.payload original_observation,j.evidence_id original_evidence_id,
    cl.claim proposed_observation,cl.evidence_id claim_evidence_id,
    sj.capability,sj.parameters,sj.checkpoint,sj.plan_id
    FROM bb.review_cases r JOIN bb.connections s USING(tenant_id,connection_id)
    LEFT JOIN bb.journal j ON j.tenant_id=r.tenant_id AND j.entry_id=r.entry_id
    LEFT JOIN bb.review_claims cl ON cl.tenant_id=r.tenant_id AND cl.case_id=r.case_id
    LEFT JOIN (SELECT j.*,p.parameters FROM bb.source_jobs j JOIN bb.import_plans p USING(tenant_id,plan_id)) sj ON sj.tenant_id=r.tenant_id AND sj.run_id=r.run_id
    WHERE r.case_id=$1`,
      [id],
    )
  ).rows[0];
  if (!row) throw new ReviewError("review_not_found", 404);
  let current;
  if (row.record_id)
    current = (
      await c.query(
        "SELECT entry_id,payload,evidence_id,rule_version FROM bb.journal j WHERE record_type='source' AND record_id=$1 AND NOT EXISTS(SELECT 1 FROM bb.journal s WHERE s.supersedes_entry_id=j.entry_id) ORDER BY occurred_at DESC,sequence DESC LIMIT 1",
        [row.record_id],
      )
    ).rows[0];
  return {
    ...row,
    current,
    affected_intents: affected(
      current?.payload?.record?.dataset ?? row.capability ?? "",
    ),
    history: (
      await c.query(
        "SELECT decision_id,principal_id,action,reason_code,evidence_id,required_cursor,outcome,created_at FROM bb.review_decisions WHERE case_id=$1 ORDER BY created_at",
        [id],
      )
    ).rows,
  };
}
export async function reviewList(tenant: string) {
  return scoped(tenant, async (c) => ({
    cases: (
      await c.query(`SELECT r.*,s.provider,s.config->>'name' source_name,j.entity_id,
    j.evidence_id original_evidence_id FROM bb.review_cases r JOIN bb.connections s USING(tenant_id,connection_id)
    LEFT JOIN bb.journal j ON j.tenant_id=r.tenant_id AND j.entry_id=r.entry_id
    ORDER BY (r.state='resolved'),r.created_at DESC LIMIT 100`)
    ).rows,
  }));
}
export async function reviewDetail(tenant: string, id: string) {
  return scoped(tenant, (c) => details(c, id));
}
function lockedReferences(old: any, next: any, path = "") {
  if (Array.isArray(old)) {
    if (!Array.isArray(next) || old.length !== next.length)
      throw new ReviewError("review_identity_change");
    old.forEach((v, i) => lockedReferences(v, next[i], path + "." + i));
    return;
  }
  if (old && typeof old === "object")
    for (const k of new Set([
      ...Object.keys(old),
      ...Object.keys(next ?? {}),
    ])) {
      const v = old[k];
      if (
        (["dataset", "priority_order", "reference", "trace_reference"].includes(
          k,
        ) ||
          k.endsWith("_id") ||
          k.endsWith("_ids")) &&
        canonical(v) !== canonical(next?.[k])
      )
        throw new ReviewError("review_identity_change");
      lockedReferences(v, next?.[k], path + "." + k);
    }
}
async function linkedRecords(c: PoolClient, record: any) {
  const fields =
    record.dataset === "payment_allocations"
      ? ["invoice_id", "transaction_id"]
      : record.dataset === "identity"
        ? ["entity_id", "target_id"]
        : record.dataset === "bank"
          ? ["payout_id"]
          : [];
  for (const field of fields) {
    if (
      !record[field] ||
      !(
        await c.query(
          "SELECT 1 FROM bb.journal WHERE record_type='source' AND (record_id=$1 OR entity_id=$1) LIMIT 1",
          [record[field]],
        )
      ).rowCount
    )
      throw new ReviewError("review_link_target_unavailable");
  }
}
export async function decideReview(
  p: Principal,
  caseId: string,
  input: unknown,
  internal: string,
) {
  const body = decisionInput.parse(input),
    fingerprint = createHmac("sha256", internal)
      .update(canonical({ caseId, ...body }))
      .digest("hex");
  const current = await scoped(p.tenant_id, async (c) => {
    const old = (
      await c.query("SELECT * FROM bb.review_decisions WHERE decision_id=$1", [
        body.command_id,
      ])
    ).rows[0];
    if (old) {
      if (
        old.request_fingerprint !== fingerprint ||
        old.principal_id !== p.principal_id
      )
        throw new ReviewError("review_command_conflict");
      return { existing: old };
    }
    return {
      case: await details(c, caseId),
      head: (await c.query("SELECT committed FROM bb.heads")).rows[0].committed,
    };
  });
  if (current.existing)
    return {
      decision_id: body.command_id,
      required_cursor: Number(current.existing.required_cursor),
      state: current.existing.outcome,
      idempotent: true,
    };
  const item = current.case!,
    target = item.current?.payload as RecordObservation | undefined;
  let observations: IngestObservation[] = [],
    retryFailed = false;
  if (body.action === "retry") {
    if (item.retry_count >= 3) throw new ReviewError("review_retry_limit");
    if (!item.run_id || !item.parameters || !item.object_id)
      throw new ReviewError("review_retry_unavailable");
    const raw = await readEvidence(p.tenant_id, item.evidence_id);
    if (raw === null) throw new ReviewError("review_evidence_unavailable");
    try {
      const replayRaw =
        raw.source_scope === "single_transaction"
          ? {
              ...raw.order_context,
              transactions: [raw.transaction],
              transactionsCount: { count: 1, precision: "EXACT" },
            }
          : raw.source_scope === "single_fulfillment"
            ? {
                ...raw.order_context,
                fulfillments: [raw.fulfillment],
                fulfillmentsCount: { count: 1, precision: "EXACT" },
              }
            : raw;
      const normalized =
        item.capability === "allocations"
          ? await normalizeAllocations(
              raw.source_scope === "allocation_order_snapshot" &&
                !raw.openingAssignmentsDeclined
                ? raw.order
                : raw,
              item.connection_id,
              item.parameters as ImportParameters,
              item.checkpoint.stage,
              raw.through ?? item.checkpoint.through,
            )
          : item.capability === "stock"
            ? await normalizeStock(
                raw.source_scope === "inventory_item_snapshot" ? raw.item : raw,
                item.connection_id,
                item.parameters as ImportParameters,
                raw.source_scope === "inventory_item_snapshot"
                  ? raw.through
                  : item.checkpoint.through,
                raw.synthetic === true,
              )
            : item.capability === "fulfillments"
              ? await normalizeFulfillments(
                  replayRaw,
                  item.connection_id,
                  item.parameters as ImportParameters,
                  item.checkpoint.stage,
                  item.checkpoint.through,
                )
              : await normalizeSourceOrder(
                  replayRaw,
                  item.connection_id,
                  item.account_anchor,
                  item.capability,
                  item.parameters as ImportParameters,
                  item.checkpoint.stage === "open" ? "open" : "recent",
                );
      const original = normalized.find((o) => o.object_id === item.object_id);
      const group = original
        ? [original]
        : typeof replayRaw.id === "string" &&
            item.object_id ===
              (await opaqueIdentity(
                item.connection_id,
                item.capability + ":" + replayRaw.id,
              ))
          ? normalized
          : [];
      if (!group.length || group.some((o) => o.error_code || o.skipped))
        retryFailed = true;
      else observations = group.flatMap((o) => o.observations);
    } catch {
      retryFailed = true;
    }
  } else if (body.action !== "leave") {
    if (
      !target ||
      !("record" in target) ||
      target.record.dataset === "coverage"
    )
      throw new ReviewError("review_typed_input_required");
    if (body.expected_entry_id !== item.current.entry_id)
      throw new ReviewError("review_stale_entry");
    let record = body.record ?? target.record;
    lockedReferences(target.record, record);
    if (body.action === "confirm_link" || body.action === "reject_link") {
      if (!["payment_allocations", "identity", "bank"].includes(record.dataset))
        throw new ReviewError("review_not_a_link");
      const field =
        record.dataset === "bank" ? "match_confidence" : "confidence";
      record = datasetRecord.parse({
        ...record,
        [field]: body.action === "confirm_link" ? "verified" : "rejected",
      });
    }
    observations = [
      {
        ...target,
        record,
        id: body.command_id,
        kind: recordKind(record),
        supersedes_entry_id: item.current.entry_id,
      },
    ];
  }
  const raw = {
    origin:
      body.action === "retry" ? "retry_original_input" : "human_confirmed",
    case_id: caseId,
    decision_id: body.command_id,
    actor_id: p.principal_id,
    reason_code: body.reason_code,
    note: body.note,
    supporting_content: body.supporting_content,
    evidence_ids: body.evidence_ids,
    original_evidence_id: item.original_evidence_id,
    claim_evidence_id: item.claim_evidence_id,
  };
  let intended = observations;
  // A human decision cannot certify provider history. Clear only this resolved contradiction,
  // while retaining an explicit reviewed gap and all unrelated conflicts.
  if (body.action !== "leave" && body.action !== "retry" && target?.record) {
    const coverage = await scoped(p.tenant_id, async (c) => {
      const other = (
        await c.query(
          `SELECT 1 FROM bb.review_cases r LEFT JOIN bb.journal j ON j.tenant_id=r.tenant_id AND j.entry_id=r.entry_id
        WHERE r.connection_id=$1 AND r.case_id<>$2 AND r.state<>'resolved' AND
        ((j.entity_id=$3 AND j.payload->'record'->>'dataset'=$4) OR (r.entry_id IS NULL AND r.run_id IN(SELECT run_id FROM bb.source_jobs WHERE connection_id=$1 AND capability=$4))) LIMIT 1`,
          [item.connection_id, caseId, target.entity_id, target.record.dataset],
        )
      ).rowCount;
      if (other) return [];
      return (
        await c.query(
          `SELECT DISTINCT ON(record_id) entry_id,payload FROM bb.journal WHERE connection_id=$1 AND record_type='source' AND payload->'record'->>'dataset'='coverage' AND payload->'record'->>'capability'=$2 AND payload->'record'->>'entity_scope'=$3 ORDER BY record_id,occurred_at DESC,sequence DESC`,
          [item.connection_id, target.record.dataset, target.entity_id],
        )
      ).rows;
    });
    intended = [
      ...observations,
      ...coverage
        .filter((r) =>
          r.payload.record.missing_fields.includes("source_conflict"),
        )
        .map((r) => ({
          ...r.payload,
          id: randomUUID(),
          supersedes_entry_id: r.entry_id,
          record: {
            ...r.payload.record,
            backfill_complete: false,
            failure_state: "incomplete",
            missing_fields: [
              ...r.payload.record.missing_fields.filter(
                (x: string) => x !== "source_conflict",
              ),
              "source_reviewed_gap",
            ],
          },
        })),
    ];
  }
  try {
    const result = await ingest(
      p.tenant_id,
      item.connection_id,
      intended,
      raw,
      {
        origin: body.action === "retry" ? undefined : "owner_decision",
        providerSnapshot: body.action === "retry",
        before: async (c) => {
          await active(c, p);
          await c.query(
            "SELECT connection_id FROM bb.connections WHERE connection_id=$1 FOR UPDATE",
            [item.connection_id],
          );
          const row = (
            await c.query(
              "SELECT * FROM bb.review_cases WHERE case_id=$1 FOR UPDATE",
              [caseId],
            )
          ).rows[0];
          const prior = (
            await c.query(
              "SELECT * FROM bb.review_decisions WHERE decision_id=$1",
              [body.command_id],
            )
          ).rows[0];
          if (prior) {
            if (
              prior.request_fingerprint !== fingerprint ||
              prior.principal_id !== p.principal_id
            )
              throw new ReviewError("review_command_conflict");
            throw new ExistingDecision({
              decision_id: body.command_id,
              required_cursor: Number(prior.required_cursor),
              state: prior.outcome,
              idempotent: true,
            });
          }
          const lockedHead = (
            await c.query("SELECT committed FROM bb.heads FOR UPDATE")
          ).rows[0].committed;
          if (lockedHead !== current.head)
            throw new ReviewError("review_revision_conflict");
          if (row.revision !== body.revision || row.state === "resolved")
            throw new ReviewError("review_revision_conflict");
          if (body.action === "retry" && row.retry_count >= 3)
            throw new ReviewError("review_retry_limit");
          if (body.action !== "retry" && body.action !== "leave") {
            const latest = await details(c, caseId);
            if (latest.current?.entry_id !== body.expected_entry_id)
              throw new ReviewError("review_stale_entry");
            if (
              body.action === "confirm_link" ||
              ("record" in intended[0] &&
                (("confidence" in intended[0].record &&
                  intended[0].record.confidence === "verified") ||
                  ("match_confidence" in intended[0].record &&
                    intended[0].record.match_confidence === "verified")))
            )
              await linkedRecords(
                c,
                intended[0] && "record" in intended[0]
                  ? intended[0].record
                  : null,
              );
          }
          for (const id of body.evidence_ids)
            if (
              !(
                await c.query(
                  "SELECT 1 FROM bb.evidence WHERE evidence_id=$1 AND expires_at>now()",
                  [id],
                )
              ).rowCount
            )
              throw new ReviewError("review_evidence_unavailable");
        },
        committed: async (c, r) => {
          const recalculating =
            body.action !== "leave" &&
            !retryFailed &&
            !r.conflicts &&
            intended.length > 0;
          const checks = affected(
            target?.record?.dataset ?? item.capability ?? "",
          );
          await c.query(
            "INSERT INTO bb.review_decisions(tenant_id,decision_id,case_id,principal_id,request_fingerprint,case_revision,action,reason_code,evidence_id,required_cursor,outcome,checks)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            [
              p.tenant_id,
              body.command_id,
              caseId,
              p.principal_id,
              fingerprint,
              body.revision,
              body.action,
              body.reason_code,
              r.evidence_id,
              r.committed_cursor,
              recalculating ? "recalculating" : "unresolved",
              JSON.stringify(checks),
            ],
          );
          if (body.action === "retry" && recalculating && !item.entry_id)
            await c.query(
              "UPDATE bb.review_cases SET entry_id=(SELECT entry_id FROM bb.journal WHERE connection_id=$2 AND provider_identity=$3 AND record_type='source') WHERE case_id=$1",
              [caseId, item.connection_id, intended[0].id],
            );
          if (body.action !== "leave" && body.action !== "retry")
            await c.query(
              "INSERT INTO bb.review_decision_entries(tenant_id,decision_id,entry_id) SELECT tenant_id,$1,entry_id FROM bb.journal WHERE connection_id=$2 AND provider_identity=ANY($3::text[]) AND record_type='source'",
              [body.command_id, item.connection_id, intended.map((o) => o.id)],
            );
          await c.query(
            "UPDATE bb.review_cases SET revision=revision+1,state=$2,resolution_id=$3,retry_count=retry_count+$4,updated_at=now() WHERE case_id=$1",
            [
              caseId,
              recalculating ? "in_progress" : "open",
              body.command_id,
              body.action === "retry" ? 1 : 0,
            ],
          );
          await c.query(
            "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES($1,$2,$3,$4)",
            [
              p.tenant_id,
              randomUUID(),
              p.principal_id,
              "review." + body.action,
            ],
          );
        },
      },
    );
    log("review.decision_saved", {
      tenant_id: p.tenant_id,
      connection_id: item.connection_id,
      operation_id: body.command_id,
      committed_cursor: result.committed_cursor,
    });
    return {
      decision_id: body.command_id,
      required_cursor: result.committed_cursor,
      state:
        body.action !== "leave" &&
        !retryFailed &&
        !result.conflicts &&
        intended.length
          ? "recalculating"
          : "unresolved",
      revision: body.revision + 1,
    };
  } catch (e) {
    if (e instanceof ExistingDecision) return e.result;
    throw e;
  }
}

export async function checkReview(
  p: Principal,
  caseId: string,
  key: string,
  internal: string,
) {
  const state = await scoped(p.tenant_id, async (c) => {
    await active(c, p);
    const item = await details(c, caseId);
    if (item.state !== "in_progress") return { item };
    const d = (
      await c.query("SELECT * FROM bb.review_decisions WHERE decision_id=$1", [
        item.resolution_id,
      ])
    ).rows[0];
    const head = (await c.query("SELECT committed,applied FROM bb.heads"))
      .rows[0];
    const checks = (
      await c.query(
        "SELECT results FROM bb.review_checks WHERE decision_id=$1",
        [d.decision_id],
      )
    ).rows.map((r) => r.results);
    return { item, d, head, checks };
  });
  if (!state.d)
    return { state: state.item.state, revision: state.item.revision };
  const { d, head, checks, item } = state;
  if (Number(head.applied) < Number(d.required_cursor))
    return {
      state: "recalculating",
      required_cursor: Number(d.required_cursor),
      applied_cursor: Number(head.applied),
    };
  const next = (d.checks as string[]).find(
    (intent) => !checks!.some((c) => c.intent === intent),
  );
  if (next) {
    const entity = item.current?.payload?.entity_id ?? item.entity_id;
    if (!entity) throw new ReviewError("review_entity_unavailable");
    const response = await fetch(process.env.ENGINE_URL + "/v1/query", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-blackbox-contract": runtimeFingerprint,
        "x-blackbox-internal": internal,
      },
      body: JSON.stringify({
        tenant_id: p.tenant_id,
        verifier: verifier(key),
        recorded_cutoff: Number(d.required_cursor),
        at_least_cursor: Number(d.required_cursor),
        request: {
          intent: next,
          entity_id: entity,
          as_of: new Date(d.created_at).toISOString(),
          limit: 100,
          offset: 0,
        },
      }),
      signal: AbortSignal.timeout(4500),
    });
    if (!response.ok)
      throw new ReviewError("review_recalculation_unavailable", 503);
    const answer = await response.json();
    await authenticate(key, ["session"]);
    await scoped(p.tenant_id, async (c) => {
      await active(c, p);
      await c.query(
        "INSERT INTO bb.review_checks(tenant_id,check_id,decision_id,checked_cursor,results)VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
        [
          p.tenant_id,
          randomUUID(),
          d.decision_id,
          answer.recorded_cutoff,
          {
            intent: next,
            status: answer.status,
            rule_version: answer.rule_version,
            missing_inputs: answer.missing_inputs,
            conflicts: answer.conflicts,
          },
        ],
      );
    });
    log("review.readiness_checked", {
      tenant_id: p.tenant_id,
      operation_id: d.decision_id,
      applied_cursor: answer.applied_cursor,
    });
    return {
      state: "recalculating",
      checked: checks!.length + 1,
      total: d.checks.length,
      required_cursor: Number(d.required_cursor),
    };
  }
  const completed = await scoped(p.tenant_id, async (c) => {
    await active(c, p);
    await c.query(
      "SELECT connection_id FROM bb.connections WHERE connection_id=$1 FOR UPDATE",
      [item.connection_id],
    );
    const row = (
      await c.query(
        "SELECT * FROM bb.review_cases WHERE case_id=$1 FOR UPDATE",
        [caseId],
      )
    ).rows[0];
    if (row.resolution_id !== d.decision_id || row.state !== "in_progress")
      return { state: row.state, revision: row.revision };
    // Explicit supersession is the precedence rule, not arrival time or a generic manual flag.
    const authored = (
      await c.query(
        "SELECT j.record_id,j.entry_id,j.payload FROM bb.review_decision_entries x JOIN bb.journal j USING(tenant_id,entry_id) WHERE x.decision_id=$1 AND j.payload->'record'->>'dataset'<>'coverage'",
        [d.decision_id],
      )
    ).rows;
    for (const fact of authored) {
      const current = (
        await c.query(
          "SELECT entry_id FROM bb.journal j WHERE record_type='source' AND record_id=$1 AND NOT EXISTS(SELECT 1 FROM bb.journal x WHERE x.supersedes_entry_id=j.entry_id) ORDER BY occurred_at DESC,sequence DESC LIMIT 1",
          [fact.record_id],
        )
      ).rows[0];
      if (current?.entry_id !== fact.entry_id)
        throw new ReviewError("review_decision_superseded");
    }
    await c.query(
      "UPDATE bb.review_cases SET state='resolved',revision=revision+1,resolved_at=now(),updated_at=now() WHERE case_id=$1",
      [caseId],
    );
    await c.query(
      "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES($1,$2,$3,'review.resolved_after_query_checks')",
      [p.tenant_id, randomUUID(), p.principal_id],
    );
    await c.query(
      `WITH remaining AS (SELECT h.tenant_id,h.connection_id,h.capability,(SELECT count(DISTINCT r.case_id) FROM bb.review_cases r JOIN bb.source_jobs j USING(tenant_id,run_id) WHERE r.connection_id=h.connection_id AND j.capability=h.capability AND r.state<>'resolved') count FROM bb.source_health h WHERE h.connection_id=$1)
      UPDATE bb.source_health h SET collection_state=CASE WHEN r.count=0 THEN 'ready_with_gaps' ELSE 'needs_review' END,observed_at=now(),coverage=jsonb_set(h.coverage,'{unresolved_review_objects}',to_jsonb(r.count)),error_code=CASE WHEN r.count=0 AND h.error_code='source_records_quarantined' THEN NULL ELSE h.error_code END,next_action=CASE WHEN r.count=0 THEN 'inspect_coverage' ELSE h.next_action END FROM remaining r WHERE h.tenant_id=r.tenant_id AND h.connection_id=r.connection_id AND h.capability=r.capability AND h.collection_state='needs_review'`,
      [item.connection_id],
    );
    // A decision resolves this case; historical import cohorts/checks remain untouched.
    return {
      state: "resolved",
      revision: row.revision + 1,
      required_cursor: Number(d.required_cursor),
      checks,
    };
  });
  if (completed.state === "resolved")
    log("review.resolved", {
      tenant_id: p.tenant_id,
      operation_id: d.decision_id,
    });
  return completed;
}

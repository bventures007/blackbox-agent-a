import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import type { Principal } from "../auth/index.js";
import { scoped } from "../database/index.js";
import { SourceRequestError, auditSource } from "./sources.js";
import { evidenceMaintenanceStatus } from "./evidence-control.js";

export const evidenceClass = z.enum([
  "provider_response",
  "typed_submission",
  "imported_document",
  "owner_assertion",
  "legacy_unclassified",
]);
export const policyInput = z
  .object({
    connection_id: z.uuid().nullable(),
    evidence_class: evidenceClass.nullable(),
    days: z.number().int().min(1).max(3650),
    reason: z.enum([
      "business_requirement",
      "minimize_content",
      "default_policy",
    ]),
    acknowledged: z.literal(true),
  })
  .strict();
async function activeOwner(c: PoolClient, p: Principal) {
  await c.query("SELECT tenant_id FROM bb.heads FOR UPDATE");
  if (
    !(
      await c.query(
        "SELECT 1 FROM bb.credentials WHERE credential_id=$1 AND principal_id=$2 AND purpose='session' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND (idle_seconds IS NULL OR coalesce(last_used_at,created_at)+make_interval(secs=>idle_seconds)>clock_timestamp()) FOR SHARE",
        [p.credential_id, p.principal_id],
      )
    ).rowCount
  )
    throw new SourceRequestError("session_expired", 401);
}
export async function saveEvidencePolicy(p: Principal, input: unknown) {
  const b = policyInput.parse(input);
  if (b.days > 90 && b.reason !== "business_requirement")
    throw new SourceRequestError(
      "retention_longer_requires_business_reason",
      400,
    );
  return scoped(p.tenant_id, async (c) => {
    await activeOwner(c, p);
    if (
      b.connection_id &&
      !(
        await c.query("SELECT 1 FROM bb.connections WHERE connection_id=$1", [
          b.connection_id,
        ])
      ).rowCount
    )
      throw new SourceRequestError("missing_connection", 404);
    const id = randomUUID();
    await c.query(
      "INSERT INTO bb.evidence_policies(tenant_id,policy_id,connection_id,evidence_class,days,principal_id,reason)VALUES($1,$2,$3,$4,$5,$6,$7)",
      [
        p.tenant_id,
        id,
        b.connection_id,
        b.evidence_class,
        b.days,
        p.principal_id,
        b.reason,
      ],
    );
    await auditSource(c, p, "evidence.policy_selected");
    return { policy_id: id, longer_applies_to_future_receipts_only: true };
  });
}
export async function restrictEvidence(p: Principal, id: string) {
  return scoped(p.tenant_id, async (c) => {
    await activeOwner(c, p);
    if (
      !(await c.query("SELECT 1 FROM bb.evidence WHERE evidence_id=$1", [id]))
        .rowCount
    )
      throw new SourceRequestError("evidence_unavailable", 404);
    await c.query(
      "INSERT INTO bb.evidence_restrictions(tenant_id,evidence_id,restriction_id,principal_id,reason)VALUES($1,$2,$3,$4,'owner_restriction')ON CONFLICT(tenant_id,evidence_id)DO NOTHING",
      [p.tenant_id, id, randomUUID(), p.principal_id],
    );
    await auditSource(c, p, "evidence.restriction_requested");
    return { status: "restricted", physical_removal_pending: true };
  });
}
export async function evidencePolicyStatus(tenant: string) {
  return scoped(tenant, async (c) => ({
    default_days: 90,
    maintenance: await evidenceMaintenanceStatus(tenant),
    latest_content_policy_change: (
      await c.query(
        "SELECT max(changed_at) changed_at FROM (SELECT created_at changed_at FROM bb.evidence_policies UNION ALL SELECT created_at FROM bb.evidence_provider_limits UNION ALL SELECT restricted_at FROM bb.evidence_restrictions UNION ALL SELECT effective_expires_at FROM bb.evidence_retention WHERE effective_expires_at<=now()) changes",
      )
    ).rows[0].changed_at,
    policies: (
      await c.query(
        "SELECT policy_id,connection_id,evidence_class,days,reason,created_at FROM bb.evidence_policies ORDER BY created_at DESC,policy_id DESC LIMIT 100",
      )
    ).rows,
    provider_limits: (
      await c.query(
        "SELECT connection_id,evidence_class,min(days) days FROM bb.evidence_provider_limits GROUP BY connection_id,evidence_class ORDER BY connection_id,evidence_class LIMIT 100",
      )
    ).rows,
    counts: (
      await c.query(
        "SELECT count(*)::integer total,count(*) FILTER(WHERE (connection_id IS NULL OR evidence_class='legacy_unclassified') AND disposed_at IS NULL)::integer unclassified,count(*) FILTER(WHERE accessible)::integer accessible,count(*) FILTER(WHERE NOT retained AND disposed_at IS NULL)::integer removal_pending,count(*) FILTER(WHERE disposed_at IS NOT NULL)::integer disposed FROM bb.evidence_retention",
      )
    ).rows[0],
    recovery_blocked: !!(
      await c.query("SELECT 1 FROM bb.recovery_guards WHERE evidence_blocked")
    ).rowCount,
    sources: (
      await c.query(
        "SELECT connection_id,coalesce(config->>'name',provider) name FROM bb.connections ORDER BY created_at LIMIT 500",
      )
    ).rows,
  }));
}

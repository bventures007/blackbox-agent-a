import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { scoped } from "../database/index.js";
import { sealSecret, opaqueIdentity } from "../auth/secrets.js";
import {
  validateShopify,
  revision,
  requireCapabilityScopes,
  allocationScopeCategories,
} from "../connectors/shopify-client.js";
import {
  importSelection,
  resolveImportSelection,
} from "../contracts/import-plan.js";
import type { Principal } from "../auth/index.js";

// Each route uses this same capability declaration and never equates credentials with coverage.
export const scheduledCapabilities = [
  "orders",
  "payments",
  "refunds",
  "stock",
  "fulfillments",
  "allocations",
] as const;
export const startImport = z
  .object({
    selection: importSelection,
    capabilities: z.array(z.enum(scheduledCapabilities)).min(1).max(6),
    acknowledge_restrictions: z.boolean().default(false),
  })
  .strict();
export class SourceRequestError extends Error {
  constructor(
    public code: string,
    public status = 409,
  ) {
    super(code);
  }
}
export async function auditSource(c: PoolClient, p: Principal, action: string) {
  await c.query(
    "INSERT INTO bb.security_audit(tenant_id,audit_id,principal_id,action)VALUES($1,$2,$3,$4)",
    [p.tenant_id, randomUUID(), p.principal_id, action],
  );
}
export async function connectShopify(
  p: Principal,
  input: unknown,
  name: string,
  reconnect?: string,
) {
  const validated = await validateShopify(input),
    connection = reconnect ?? randomUUID();
  const anchor = await opaqueIdentity(
    p.tenant_id,
    "shopify:" + validated.account_id,
  );
  const sealed = await sealSecret(p.tenant_id, connection, {
    credentials: validated.credentials,
    account_id: validated.account_id,
  });
  await scoped(p.tenant_id, async (c) => {
    await c.query("SELECT tenant_id FROM bb.heads FOR UPDATE");
    const active = await c.query(
      "SELECT 1 FROM bb.credentials WHERE credential_id=$1 AND purpose='session' AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND (idle_seconds IS NULL OR COALESCE(last_used_at,created_at)+make_interval(secs=>idle_seconds)>clock_timestamp()) FOR SHARE",
      [p.credential_id],
    );
    if (!active.rowCount) throw new SourceRequestError("session_expired", 401);
    if (reconnect) {
      const previous = (
        await c.query(
          "SELECT account_anchor,provider FROM bb.connections WHERE connection_id=$1 FOR UPDATE",
          [reconnect],
        )
      ).rows[0];
      if (!previous) throw new SourceRequestError("missing_connection", 404);
      if (previous.provider !== "shopify" || previous.account_anchor !== anchor)
        throw new SourceRequestError(
          "different_account_requires_new_connection",
        );
      await c.query(
        "UPDATE bb.connections SET state='configured' WHERE connection_id=$1",
        [connection],
      );
    } else {
      if (
        (
          await c.query(
            "SELECT 1 FROM bb.connections WHERE provider='shopify' AND account_anchor=$1",
            [anchor],
          )
        ).rowCount
      )
        throw new SourceRequestError("account_already_connected");
      await c.query(
        "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'shopify',$3,$4)",
        [
          p.tenant_id,
          connection,
          anchor,
          {
            name,
            shop: validated.credentials.shop,
            timezone: validated.timezone,
            mode: "local_standalone",
            provider_revision: revision,
          },
        ],
      );
    }
    await c.query(
      `INSERT INTO bb.source_secrets(tenant_id,connection_id,key_version,sealed,scopes,validated_at)VALUES($1,$2,$5,$3,$4,now())
      ON CONFLICT(tenant_id,connection_id) DO UPDATE SET key_version=EXCLUDED.key_version,sealed=EXCLUDED.sealed,scopes=EXCLUDED.scopes,validated_at=now(),revision=bb.source_secrets.revision+1,updated_at=now()`,
      [p.tenant_id, connection, sealed, validated.scopes, sealed.key_version],
    );
    await auditSource(
      c,
      p,
      reconnect ? "source.reauthorized" : "source.credentials_validated",
    );
  });
  return {
    connection_id: connection,
    account_anchor: anchor,
    scopes: validated.scopes,
    timezone: validated.timezone,
    state: "configured",
  };
}
export function restrictions(scopes: string[], from: string, cutoff: string) {
  const result = [
    "current_snapshots_cannot_reconstruct_intermediate_changes",
    "order_line_cancellation_and_gross_may_require_review",
    "open_order_filter_cannot_certify_all_unresolved_obligations",
  ];
  if (!scopes.includes("read_all_orders"))
    result.push("older_orders_require_read_all_orders");
  if (
    !scopes.includes("read_all_orders") &&
    Date.parse(from) < Date.parse(cutoff) - 60 * 86400000
  )
    result.push("requested_history_exceeds_order_permission");
  return result;
}
export async function planPreview(
  tenant: string,
  connection: string,
  input: unknown,
) {
  const body = startImport.parse(input),
    parameters = resolveImportSelection(body.selection);
  return scoped(tenant, async (c) => {
    const source = (
      await c.query(
        "SELECT c.provider,c.state,s.scopes FROM bb.connections c JOIN bb.source_secrets s USING(tenant_id,connection_id) WHERE connection_id=$1",
        [connection],
      )
    ).rows[0];
    if (!source || source.provider !== "shopify")
      throw new SourceRequestError("missing_connection", 404);
    for (const capability of body.capabilities)
      requireCapabilityScopes(source.scopes, capability);
    return {
      raw_evidence_retention: {
        days: Number(
          (
            await c.query(
              "SELECT bb.evidence_policy_days($1,$2,'provider_response') days",
              [tenant, connection],
            )
          ).rows[0].days,
        ),
        from: "local_receipt",
        longer_changes_future_only: true,
      },
      parameters: {
        ...parameters,
        allocation_scope_categories: allocationScopeCategories(source.scopes),
      },
      capabilities: [...new Set(body.capabilities)],
      provider_revision: revision,
      restrictions: [
        ...restrictions(
          source.scopes,
          parameters.requested_from,
          parameters.initial_cutoff,
        ),
        ...(body.capabilities.includes("stock")
          ? [
              "inventory_current_snapshot_only",
              "inventory_non_atomic_locations",
              "inventory_scan_bounded",
            ]
          : []),
        ...(body.capabilities.includes("allocations")
          ? [
              "allocation_assignments_not_reservations",
              "allocation_accessible_subset",
            ]
          : []),
        ...(body.capabilities.includes("fulfillments")
          ? ["fulfillment_preparation_is_not_handover"]
          : []),
      ],
      available_from: source.scopes.includes("read_all_orders")
        ? null
        : new Date(
            Date.parse(parameters.initial_cutoff) - 60 * 86400000,
          ).toISOString(),
      history_kind: "mixed",
      history_completeness: "partial",
      exact_total: null,
    };
  });
}
export async function enqueueJob(
  c: PoolClient,
  tenant: string,
  connection: string,
  plan: string,
  capability: string,
  kind: string,
  checkpoint: unknown,
  nextAt = new Date().toISOString(),
) {
  const run = randomUUID(),
    job = randomUUID();
  await c.query(
    "INSERT INTO bb.import_runs(tenant_id,run_id,connection_id,plan_id,kind,state,phase)VALUES($1,$2,$3,$4,$5,'queued','check_connection')",
    [tenant, run, connection, plan, kind],
  );
  await c.query(
    "INSERT INTO bb.source_jobs(tenant_id,job_id,connection_id,plan_id,capability,kind,run_id,checkpoint,next_at)VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
    [tenant, job, connection, plan, capability, kind, run, checkpoint, nextAt],
  );
  return { run_id: run, job_id: job };
}
export async function beginImport(
  p: Principal,
  connection: string,
  input: unknown,
) {
  const body = startImport.parse(input),
    preview = await planPreview(p.tenant_id, connection, body);
  if (preview.restrictions.length && !body.acknowledge_restrictions)
    throw new SourceRequestError("restrictions_acknowledgement_required", 400);
  return scoped(p.tenant_id, async (c) => {
    const source = (
      await c.query(
        "SELECT state FROM bb.connections WHERE connection_id=$1 FOR UPDATE",
        [connection],
      )
    ).rows[0];
    if (
      !source ||
      ["disconnected", "reauthorization_required"].includes(source.state)
    )
      throw new SourceRequestError("source_requires_connection");
    const previous = (
      await c.query(
        "SELECT revision,parameters,capabilities FROM bb.import_plans WHERE connection_id=$1 ORDER BY revision DESC LIMIT 1",
        [connection],
      )
    ).rows[0];
    const knownCapabilities = new Set(
      (
        await c.query(
          "SELECT capability FROM bb.source_health WHERE connection_id=$1",
          [connection],
        )
      ).rows.map((r) => r.capability),
    );
    if (
      previous &&
      preview.capabilities.every((cap) => knownCapabilities.has(cap)) &&
      Date.parse(preview.parameters.requested_from) >=
        Date.parse(previous.parameters.requested_from) &&
      ![
        "include_open_items",
        "include_related_records",
        "include_opening_state",
      ].some((k) => (preview.parameters as any)[k] && !previous.parameters[k])
    )
      throw new SourceRequestError("history_expansion_required");
    if (
      (
        await c.query(
          "SELECT 1 FROM bb.source_jobs WHERE connection_id=$1 AND kind IN ('initial','history_expansion') AND state IN ('queued','running','paused')",
          [connection],
        )
      ).rowCount
    )
      throw new SourceRequestError("history_import_already_active");
    const plan = randomUUID(),
      version = (previous?.revision ?? 0) + 1;
    await c.query(
      "INSERT INTO bb.import_plans(tenant_id,plan_id,connection_id,revision,selected_by,parameters,capabilities,provider_revision)VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [
        p.tenant_id,
        plan,
        connection,
        version,
        p.principal_id,
        {
          ...preview.parameters,
          restrictions: preview.restrictions,
          available_from: preview.available_from,
        },
        preview.capabilities,
        revision,
      ],
    );
    await c.query(
      "UPDATE bb.workspaces SET suggested_history_from=COALESCE(suggested_history_from,$1),timezone=CASE WHEN suggested_history_from IS NULL THEN $2 ELSE timezone END",
      [preview.parameters.requested_from, preview.parameters.timezone],
    );
    const jobs = [];
    for (const capability of preview.capabilities) {
      await c.query(
        `INSERT INTO bb.source_health(tenant_id,connection_id,capability,poll_seconds,reconciliation_seconds,collection_state,next_poll_at,next_reconciliation_at,coverage)
        VALUES($1,$2,$3,120,21600,'backfilling',now(),now()+interval '6 hours',$4) ON CONFLICT(tenant_id,connection_id,capability) DO UPDATE SET collection_state='backfilling',observed_at=now()`,
        [
          p.tenant_id,
          connection,
          capability,
          {
            requested_from: preview.parameters.requested_from,
            history_kind: "mixed",
            history_completeness: "partial",
            restrictions: preview.restrictions,
          },
        ],
      );
      jobs.push(
        await enqueueJob(
          c,
          p.tenant_id,
          connection,
          plan,
          capability,
          previous ? "history_expansion" : "initial",
          {
            from: preview.parameters.requested_from,
            through: preview.parameters.initial_cutoff,
            stage: "recent",
            after: null,
            pages: 0,
          },
        ),
      );
      if (!knownCapabilities.has(capability)) {
        jobs.push(
          await enqueueJob(
            c,
            p.tenant_id,
            connection,
            plan,
            capability,
            "incremental",
            {
              from: preview.parameters.initial_cutoff,
              stage: "recent",
              after: null,
              pages: 0,
            },
          ),
        );
        jobs.push(
          await enqueueJob(
            c,
            p.tenant_id,
            connection,
            plan,
            capability,
            "reconciliation",
            {
              from: preview.parameters.requested_from,
              stage: "recent",
              after: null,
              pages: 0,
            },
            new Date(Date.now() + 21600000).toISOString(),
          ),
        );
      }
    }
    await c.query(
      "UPDATE bb.connections SET state='backfilling' WHERE connection_id=$1",
      [connection],
    );
    await auditSource(
      c,
      p,
      previous ? "source.history_expanded" : "source.import_started",
    );
    return { plan_id: plan, revision: version, ...preview, jobs };
  });
}
export async function sourceReadiness(tenant: string) {
  return scoped(tenant, async (c) => ({
    observed_at: new Date().toISOString(),
    workspace: (
      await c.query("SELECT suggested_history_from,timezone FROM bb.workspaces")
    ).rows[0],
    heads: (await c.query("SELECT committed,applied FROM bb.heads")).rows[0],
    capabilities: (
      await c.query(`SELECT h.*,c.provider,c.state connection_state,
      CASE WHEN c.state IN ('paused','disconnected','reauthorization_required') THEN c.state
           WHEN h.collection_state='needs_review' THEN 'needs_review'
           WHEN h.last_success_at IS NOT NULL AND h.last_success_at < now()-make_interval(secs=>h.poll_seconds*3) THEN 'delayed'
           ELSE h.collection_state END effective_state
      FROM bb.source_health h JOIN bb.connections c USING(tenant_id,connection_id) ORDER BY connection_id,capability`)
    ).rows,
    plans: (
      await c.query(
        "SELECT plan_id,connection_id,revision,selected_at,parameters,capabilities,provider_revision FROM bb.import_plans ORDER BY selected_at DESC LIMIT 100",
      )
    ).rows,
    runs: (
      await c.query(`SELECT j.job_id,j.connection_id,j.plan_id,j.run_id,j.capability,j.kind,j.state,j.phase,j.next_at,j.attempts,j.error_code,j.created_at,j.updated_at,j.completed_at,
      count(o.object_id)::integer discovered,
      count(o.object_id) FILTER(WHERE o.state IN ('committed','duplicate'))::integer committed_objects,
      count(o.object_id) FILTER(WHERE o.state IN ('committed','duplicate') AND o.required_cursor<=h.applied)::integer processed_objects,
      count(o.object_id) FILTER(WHERE o.state='duplicate')::integer duplicates,
      count(o.object_id) FILTER(WHERE o.state='skipped')::integer skipped,
      count(o.object_id) FILTER(WHERE o.state='quarantined')::integer quarantined,
      COALESCE(sum(o.emitted_entries),0)::integer emitted_entries
      FROM (SELECT * FROM bb.source_jobs ORDER BY created_at DESC LIMIT 100) j
      JOIN bb.heads h USING(tenant_id) LEFT JOIN bb.import_objects o USING(tenant_id,run_id)
      GROUP BY j.tenant_id,j.job_id,j.connection_id,j.plan_id,j.run_id,j.capability,j.kind,j.state,j.phase,j.next_at,j.attempts,j.error_code,j.created_at,j.updated_at,j.completed_at
      ORDER BY j.created_at DESC`)
    ).rows,
  }));
}

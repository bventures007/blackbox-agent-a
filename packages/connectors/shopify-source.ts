import { z } from "zod";
import { opaqueIdentity } from "../auth/secrets.js";
import { canonical } from "../auth/producer.js";
import {
  recordObservation,
  recordKind,
  type RecordObservation,
  type datasetRecord,
} from "../contracts/records.js";
import { shopifyGraphql, type ShopifyCredentials } from "./shopify-client.js";
import { ProviderError } from "./transport.js";
import { minor } from "./shopify.js";
import type { resolveImportSelection } from "../contracts/import-plan.js";
export type ImportParameters = ReturnType<typeof resolveImportSelection> & {
  restrictions?: string[];
  allocation_scope_categories?: string[];
};
export type Checkpoint = {
  from: string;
  through?: string;
  stage: "recent" | "open";
  after: string | null;
  pages: number;
  required_cursor?: number;
};
export type SourceObject = {
  object_id: string;
  dataset: string;
  observations: RecordObservation[];
  raw: unknown;
  error_code?: string;
  skipped?: boolean;
  coverage_missing?: string[];
};
const time = z.iso.datetime({ offset: true });
const money = z.object({
  shopMoney: z.object({
    amount: z.string().regex(/^[0-9]+(?:\.[0-9]+)?$/),
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
  }),
});
export const pageInfo = z.object({
  hasNextPage: z.boolean(),
  endCursor: z.string().max(4096).nullable(),
});
const lineSchema = z.object({
  id: z.string().max(200),
  quantity: z.number().int().nonnegative(),
  currentQuantity: z.number().int().nonnegative(),
  variant: z
    .object({ inventoryItem: z.object({ id: z.string().max(200) }) })
    .nullable(),
  originalTotalSet: money,
  discountAllocations: z
    .array(z.object({ allocatedAmountSet: money }))
    .max(100),
  taxLines: z.array(z.object({ priceSet: money })).max(100),
});
const transactionSchema = z.object({
  id: z.string().max(200),
  kind: z.string(),
  status: z.string(),
  processedAt: time.nullable(),
  test: z.boolean(),
  amountSet: money,
  parentTransaction: z.object({ id: z.string().max(200) }).nullable(),
});
const header = "id createdAt updatedAt test currencyCode";
const lineFields =
  "id quantity currentQuantity variant{inventoryItem{id}} originalTotalSet{shopMoney{amount currencyCode}} discountAllocations{allocatedAmountSet{shopMoney{amount currencyCode}}} taxLines{priceSet{shopMoney{amount currencyCode}}}";
export const sourceOrderQuery = (capability: string) =>
  `query BlackboxSourceOrders($after:String,$query:String!){orders(first:5,after:$after,query:$query,sortKey:UPDATED_AT){nodes{${header} ${
    capability === "orders"
      ? `closed cancelledAt taxesIncluded totalPriceSet{shopMoney{amount currencyCode}} lineItems(first:20){nodes{${lineFields}}pageInfo{hasNextPage endCursor}}`
      : "transactionsCount{count precision} transactions{id kind status processedAt test amountSet{shopMoney{amount currencyCode}}parentTransaction{id}}"
  } }pageInfo{hasNextPage endCursor}}}`;
const sourceLinesQuery = `query BlackboxSourceLines($id:ID!,$after:String){order(id:$id){updatedAt lineItems(first:20,after:$after){nodes{${lineFields}}pageInfo{hasNextPage endCursor}}}}`;
export function selectionQuery(
  checkpoint: Checkpoint,
  parameters: ImportParameters,
) {
  if (!checkpoint.through)
    throw new ProviderError("fixed_poll_cutoff_required");
  if (checkpoint.stage === "open") {
    // Provider-declared open/unsettled subset. Archived is not treated as proof of settlement.
    return `updated_at:<'${parameters.requested_from}' (status:open OR financial_status:authorized OR financial_status:pending OR financial_status:partially_paid OR financial_status:partially_refunded)`;
  }
  return `updated_at:>='${checkpoint.from}' updated_at:<'${checkpoint.through}'`;
}
function amount(value: z.infer<typeof money>, currency: string) {
  if (value.shopMoney.currencyCode !== currency)
    throw new ProviderError("provider_currency_conflict");
  return minor(value.shopMoney.amount, currency);
}
export async function record(
  connection: string,
  entity: string,
  sourceId: string,
  occurredAt: string,
  test: boolean,
  value: z.infer<typeof datasetRecord>,
) {
  const economic =
    value.dataset === "orders"
      ? entity
      : await opaqueIdentity(connection, `${value.dataset}:${sourceId}`);
  const kind = recordKind(value);
  const version =
    value.dataset === "coverage"
      ? canonical(value)
      : value.dataset === "payments" || value.dataset === "refunds"
        ? kind
        : "snapshot";
  return recordObservation.parse({
    id: await opaqueIdentity(
      connection,
      `${economic}:${occurredAt}:${version}`,
    ),
    economic_id: economic,
    entity_id: entity,
    kind,
    occurred_at: occurredAt,
    test,
    record: value,
  });
}
export async function normalizeSourceOrder(
  raw: unknown,
  connection: string,
  account: string,
  capability: string,
  parameters: ImportParameters,
  stage: string,
): Promise<SourceObject[]> {
  const base = z
      .object({
        id: z.string().max(200),
        createdAt: time,
        updatedAt: time,
        test: z.boolean(),
        currencyCode: z.string(),
      })
      .parse(raw),
    entity = await opaqueIdentity(connection, base.id),
    object = await opaqueIdentity(connection, capability + ":" + base.id);
  if (capability === "orders") {
    const o = z
      .object({
        closed: z.boolean(),
        cancelledAt: time.nullable(),
        taxesIncluded: z.boolean(),
        totalPriceSet: money,
        lineItems: z.object({ nodes: z.array(lineSchema).max(500), pageInfo }),
      })
      .parse(raw);
    if (
      parameters.strict_from_now &&
      Date.parse(base.createdAt) < Date.parse(parameters.requested_from)
    )
      return [
        {
          object_id: object,
          dataset: capability,
          observations: [],
          raw: {
            id: base.id,
            updatedAt: base.updatedAt,
            reason: "older_parent_declined",
          },
          skipped: true,
        },
      ];
    if (o.lineItems.pageInfo.hasNextPage)
      throw new ProviderError("line_pagination_required");
    const lines = [];
    for (const l of o.lineItems.nodes) {
      if (!l.variant)
        throw new ProviderError("line_inventory_identity_missing");
      // Removed and refunded quantities share one provider field. Never invent a cancellation.
      if (l.currentQuantity !== l.quantity && !o.cancelledAt)
        throw new ProviderError("line_cancellation_quantity_unresolved");
      let gross = BigInt(amount(l.originalTotalSet, base.currencyCode));
      for (const d of l.discountAllocations)
        gross -= BigInt(amount(d.allocatedAmountSet, base.currencyCode));
      if (!o.taxesIncluded)
        for (const t of l.taxLines)
          gross += BigInt(amount(t.priceSet, base.currencyCode));
      if (gross < 0n || gross > BigInt(Number.MAX_SAFE_INTEGER))
        throw new ProviderError("line_money_out_of_range");
      lines.push({
        line_id: await opaqueIdentity(connection, l.id),
        item_id: await opaqueIdentity(connection, l.variant.inventoryItem.id),
        quantity: String(l.quantity),
        cancelled_quantity: o.cancelledAt ? String(l.quantity) : "0",
        unit: "piece" as const,
        line_gross_minor: Number(gross),
      });
    }
    const observation = await record(
      connection,
      entity,
      base.id,
      base.updatedAt,
      base.test,
      {
        dataset: "orders",
        status: o.cancelledAt ? "cancelled" : o.closed ? "closed" : "open",
        created_at: base.createdAt,
        currency: base.currencyCode,
        gross_minor: amount(o.totalPriceSet, base.currencyCode),
        lines,
      },
    );
    return [
      {
        object_id: object,
        dataset: capability,
        observations: [observation],
        raw,
      },
    ];
  }
  const data = z
    .object({
      transactions: z.array(transactionSchema).max(200),
      transactionsCount: z
        .object({
          count: z.number().int().nonnegative(),
          precision: z.literal("EXACT"),
        })
        .nullable(),
    })
    .parse(raw);
  if (
    !data.transactionsCount ||
    data.transactionsCount.count !== data.transactions.length
  )
    throw new ProviderError("transaction_population_incomplete");
  const results: SourceObject[] = [];
  for (const t of data.transactions) {
    const refund = t.kind === "REFUND";
    if ((capability === "refunds") !== refund) continue;
    if (
      !refund &&
      !["AUTHORIZATION", "CAPTURE", "SALE", "VOID"].includes(t.kind)
    )
      continue;
    const txObject = await opaqueIdentity(connection, capability + ":" + t.id);
    const retainedInput = {
      source_scope: "single_transaction",
      order_context: base,
      transaction: t,
    };
    if (!t.processedAt) {
      results.push({
        object_id: txObject,
        dataset: capability,
        observations: [],
        raw: retainedInput,
        error_code: "transaction_time_missing",
      });
      continue;
    }
    const related =
      parameters.include_related_records ||
      (stage === "open" && parameters.include_open_items);
    if (
      !related &&
      Date.parse(t.processedAt) < Date.parse(parameters.requested_from)
    ) {
      results.push({
        object_id: txObject,
        dataset: capability,
        observations: [],
        raw: { id: t.id, reason: "older_context_declined" },
        skipped: true,
      });
      continue;
    }
    const status = refund
      ? (
          {
            SUCCESS: "completed",
            FAILURE: "failed",
            ERROR: "failed",
            PENDING: "pending",
            AWAITING_RESPONSE: "pending",
          } as const
        )[t.status]
      : t.status === "SUCCESS"
        ? (
            {
              AUTHORIZATION: "authorized",
              CAPTURE: "captured",
              SALE: "captured",
              VOID: "voided",
            } as const
          )[t.kind]
        : ["FAILURE", "ERROR"].includes(t.status)
          ? "failed"
          : null;
    if (!status) {
      results.push({
        object_id: txObject,
        dataset: capability,
        observations: [],
        raw: retainedInput,
        error_code: "transaction_status_unresolved",
      });
      continue;
    }
    if (refund && !t.parentTransaction) {
      results.push({
        object_id: txObject,
        dataset: capability,
        observations: [],
        raw: retainedInput,
        error_code: "refund_parent_missing",
      });
      continue;
    }
    const effect = await opaqueIdentity(connection, t.id),
      original = t.parentTransaction
        ? await opaqueIdentity(connection, "payments:" + t.parentTransaction.id)
        : undefined;
    const observation = await record(
      connection,
      entity,
      t.id,
      t.processedAt,
      t.test,
      refund
        ? {
            dataset: "refunds",
            order_id: entity,
            original_transaction_id: original!,
            amount_minor: amount(
              t.amountSet,
              t.amountSet.shopMoney.currencyCode,
            ),
            currency: t.amountSet.shopMoney.currencyCode,
            status: status as "completed" | "pending" | "failed",
            destination: "cash",
            economic_effect_id: effect,
          }
        : {
            dataset: "payments",
            order_id: entity,
            account_id: account,
            ...(original ? { original_transaction_id: original } : {}),
            amount_minor: amount(
              t.amountSet,
              t.amountSet.shopMoney.currencyCode,
            ),
            currency: t.amountSet.shopMoney.currencyCode,
            status: status as "captured" | "authorized" | "failed" | "voided",
            economic_effect_id: effect,
          },
    );
    results.push({
      object_id: txObject,
      dataset: capability,
      observations: [observation],
      raw: retainedInput,
    });
  }
  return results;
}
export async function scopedSnapshotCoverage(
  raw: unknown,
  connection: string,
  capability: string,
  through: string,
  conflict = false,
  missing: string[] = [],
) {
  const base = z.object({ id: z.string(), test: z.boolean() }).parse(raw),
    entity = await opaqueIdentity(connection, base.id);
  const caps = capability === "orders" ? ["orders", "identity"] : [capability];
  return Promise.all(
    caps.map((cap) =>
      record(connection, entity, cap + ":" + base.id, through, base.test, {
        dataset: "coverage",
        capability: cap as
          "orders" | "payments" | "refunds" | "identity" | "fulfillments",
        entity_scope: entity,
        history_start: through,
        complete_through: through,
        backfill_complete: !conflict && !missing.length,
        missing_fields: [
          ...new Set([...(conflict ? ["source_conflict"] : []), ...missing]),
        ],
        failure_state: conflict
          ? "error"
          : missing.length
            ? "incomplete"
            : "none",
        basis: "declared",
        history_kind: "snapshot_only",
      }),
    ),
  );
}
export async function fetchOrderPage(
  credentials: ShopifyCredentials,
  capability: string,
  checkpoint: Checkpoint,
  parameters: ImportParameters,
  signal: AbortSignal,
) {
  if (checkpoint.pages >= 10000)
    throw new ProviderError("page_budget_exceeded");
  const result = await shopifyGraphql(
      credentials,
      sourceOrderQuery(capability),
      {
        after: checkpoint.after,
        query: selectionQuery(checkpoint, parameters),
      },
      signal,
    ),
    data = z
      .object({ nodes: z.array(z.unknown()).max(5), pageInfo })
      .parse(result.orders);
  if (
    data.pageInfo.hasNextPage &&
    (!data.pageInfo.endCursor || data.pageInfo.endCursor === checkpoint.after)
  )
    throw new ProviderError("invalid_pagination");
  const objects: unknown[] = [];
  for (const raw of data.nodes) {
    if (capability !== "orders") {
      objects.push(raw);
      continue;
    }
    const node = z
      .object({
        id: z.string(),
        updatedAt: time,
        lineItems: z.object({ nodes: z.array(z.unknown()).max(100), pageInfo }),
      })
      .passthrough()
      .parse(raw);
    let info = node.lineItems.pageInfo;
    while (info.hasNextPage) {
      if (node.lineItems.nodes.length >= 500)
        throw new ProviderError("order_line_budget_exceeded");
      const next = await shopifyGraphql(
          credentials,
          sourceLinesQuery,
          { id: node.id, after: info.endCursor },
          signal,
        ),
        parsed = z
          .object({
            updatedAt: time,
            lineItems: z.object({
              nodes: z.array(z.unknown()).max(100),
              pageInfo,
            }),
          })
          .parse(next.order);
      if (parsed.updatedAt !== node.updatedAt)
        throw new ProviderError("order_changed_during_pagination", 1000);
      if (
        parsed.lineItems.pageInfo.hasNextPage &&
        (!parsed.lineItems.pageInfo.endCursor ||
          parsed.lineItems.pageInfo.endCursor === info.endCursor)
      )
        throw new ProviderError("invalid_pagination");
      node.lineItems.nodes.push(...parsed.lineItems.nodes);
      info = parsed.lineItems.pageInfo;
    }
    node.lineItems.pageInfo = info;
    objects.push(node);
  }
  return { nodes: objects, pageInfo: data.pageInfo };
}

import { z } from "zod";
import { opaqueIdentity } from "../auth/secrets.js";
import { shopifyGraphql, type ShopifyCredentials } from "./shopify-client.js";
import { ProviderError } from "./transport.js";
import {
  pageInfo,
  record,
  selectionQuery,
  type Checkpoint,
  type ImportParameters,
  type SourceObject,
} from "./shopify-source.js";
const id = z.string().min(1).max(200),
  time = z.iso.datetime({ offset: true });
const header = z.object({
  id,
  createdAt: time,
  updatedAt: time,
  test: z.boolean(),
  currencyCode: z.string(),
});
const line = z.object({
  id,
  inventoryItemId: id.nullable(),
  lineItem: z.object({ id }),
  totalQuantity: z.number().int(),
  remainingQuantity: z.number().int(),
  requiresShipping: z.boolean(),
});
const linePage = z.object({ nodes: z.array(line).max(500), pageInfo });
const group = z.object({
  id,
  createdAt: time,
  updatedAt: time,
  status: z.enum([
    "OPEN",
    "IN_PROGRESS",
    "INCOMPLETE",
    "ON_HOLD",
    "SCHEDULED",
    "CLOSED",
    "CANCELLED",
  ]),
  assignedLocation: z.object({ location: z.object({ id }).nullable() }),
  lineItems: linePage,
});
const groups = z.object({ nodes: z.array(group).max(200), pageInfo });
const lineFields =
  "id inventoryItemId lineItem{id} totalQuantity remainingQuantity requiresShipping";
const fields = `id createdAt updatedAt status assignedLocation{location{id}} lineItems(first:100){nodes{${lineFields}}pageInfo{hasNextPage endCursor}}`;
export const allocationsQuery = `query BlackboxAllocations($after:String,$query:String!){orders(first:10,after:$after,query:$query,sortKey:UPDATED_AT){nodes{id createdAt updatedAt test currencyCode fulfillmentOrders(first:100){nodes{${fields}}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}`;
const moreGroups = `query BlackboxAllocationGroups($id:ID!,$after:String){order(id:$id){updatedAt fulfillmentOrders(first:100,after:$after){nodes{${fields}}pageInfo{hasNextPage endCursor}}}}`;
const moreLines = `query BlackboxAllocationLines($id:ID!,$after:String){fulfillmentOrder(id:$id){updatedAt lineItems(first:100,after:$after){nodes{${lineFields}}pageInfo{hasNextPage endCursor}}}}`;
export async function fetchAllocationPage(
  c: ShopifyCredentials,
  checkpoint: Checkpoint,
  p: ImportParameters,
  signal: AbortSignal,
) {
  if (checkpoint.pages >= 10000)
    throw new ProviderError("page_budget_exceeded");
  const result = await shopifyGraphql(
    c,
    allocationsQuery,
    { after: checkpoint.after, query: selectionQuery(checkpoint, p) },
    signal,
  );
  const page = z
    .object({ nodes: z.array(z.unknown()).max(10), pageInfo })
    .parse(result.orders);
  if (
    page.pageInfo.hasNextPage &&
    (!page.pageInfo.endCursor || page.pageInfo.endCursor === checkpoint.after)
  )
    throw new ProviderError("invalid_pagination");
  const nodes = [];
  let totalLines = 0;
  for (const raw of page.nodes) {
    const order = header.extend({ fulfillmentOrders: groups }).parse(raw);
    let cursor = order.fulfillmentOrders.pageInfo;
    const groupCursors = new Set<string>();
    while (cursor.hasNextPage) {
      if (!cursor.endCursor || groupCursors.has(cursor.endCursor))
        throw new ProviderError("invalid_pagination");
      groupCursors.add(cursor.endCursor);
      if (order.fulfillmentOrders.nodes.length >= 200)
        throw new ProviderError("allocation_group_budget_exceeded");
      const response = await shopifyGraphql(
        c,
        moreGroups,
        { id: order.id, after: cursor.endCursor },
        signal,
      );
      const next = z
        .object({ updatedAt: time, fulfillmentOrders: groups })
        .parse(response.order);
      if (next.updatedAt !== order.updatedAt)
        throw new ProviderError("allocation_changed_during_pagination", 1000);
      order.fulfillmentOrders.nodes.push(...next.fulfillmentOrders.nodes);
      if (order.fulfillmentOrders.nodes.length > 200)
        throw new ProviderError("allocation_group_budget_exceeded");
      cursor = next.fulfillmentOrders.pageInfo;
    }
    order.fulfillmentOrders.pageInfo = cursor;
    const seen = new Set<string>();
    for (const g of order.fulfillmentOrders.nodes) {
      if (seen.has(g.id))
        throw new ProviderError("allocation_duplicate_identity");
      seen.add(g.id);
      let next = g.lineItems.pageInfo;
      const lineCursors = new Set<string>();
      totalLines += g.lineItems.nodes.length;
      if (totalLines > 10000)
        throw new ProviderError("allocation_page_line_budget_exceeded");
      while (next.hasNextPage) {
        if (!next.endCursor || lineCursors.has(next.endCursor))
          throw new ProviderError("invalid_pagination");
        lineCursors.add(next.endCursor);
        if (g.lineItems.nodes.length >= 500)
          throw new ProviderError("allocation_line_budget_exceeded");
        const response = await shopifyGraphql(
          c,
          moreLines,
          { id: g.id, after: next.endCursor },
          signal,
        );
        const value = z
          .object({ updatedAt: time, lineItems: linePage })
          .parse(response.fulfillmentOrder);
        if (value.updatedAt !== g.updatedAt)
          throw new ProviderError("allocation_changed_during_pagination", 1000);
        totalLines += value.lineItems.nodes.length;
        if (totalLines > 10000)
          throw new ProviderError("allocation_page_line_budget_exceeded");
        g.lineItems.nodes.push(...value.lineItems.nodes);
        if (g.lineItems.nodes.length > 500)
          throw new ProviderError("allocation_line_budget_exceeded");
        next = value.lineItems.pageInfo;
      }
      g.lineItems.pageInfo = next;
    }
    nodes.push(order);
  }
  return { nodes, pageInfo: page.pageInfo };
}
export async function normalizeAllocations(
  raw: unknown,
  connection: string,
  p: ImportParameters,
  stage: string,
  through: string,
): Promise<SourceObject[]> {
  const retainedDecline = z
    .object({
      source_scope: z.literal("allocation_order_snapshot"),
      openingAssignmentsDeclined: z.literal(true),
      order_context: header,
    })
    .safeParse(raw);
  const order = header.extend({ fulfillmentOrders: groups }).parse(
      retainedDecline.success
        ? {
            ...retainedDecline.data.order_context,
            fulfillmentOrders: {
              nodes: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          }
        : raw,
    ),
    entity = await opaqueIdentity(connection, order.id),
    object = await opaqueIdentity(connection, "allocations:" + order.id);
  const retained = {
    source_scope: "allocation_order_snapshot",
    through,
    order,
  };
  const observations = [];
  const members: string[] = [];
  let error: string | undefined,
    declined = retainedDecline.success;
  try {
    if (order.fulfillmentOrders.pageInfo.hasNextPage)
      throw new ProviderError("allocation_pagination_required");
    if (Date.parse(order.createdAt) > Date.parse(order.updatedAt))
      throw new ProviderError("allocation_timestamp_conflict");
    if (Date.parse(order.updatedAt) > Date.parse(through))
      throw new ProviderError("allocation_after_fixed_cutoff");
    const seen = new Set<string>();
    for (const g of order.fulfillmentOrders.nodes) {
      if (g.lineItems.pageInfo.hasNextPage)
        throw new ProviderError("allocation_line_pagination_required");
      if (
        Date.parse(g.updatedAt) > Date.parse(through) ||
        Date.parse(g.createdAt) > Date.parse(g.updatedAt)
      )
        throw new ProviderError("allocation_timestamp_conflict");
      const related =
        p.include_related_records ||
        p.include_opening_state ||
        (stage === "open" && p.include_open_items);
      if (!related && Date.parse(g.createdAt) < Date.parse(p.requested_from)) {
        declined = true;
        continue;
      }
      if (!g.assignedLocation.location)
        throw new ProviderError("allocation_location_missing");
      for (const l of g.lineItems.nodes) {
        if (!l.requiresShipping) continue;
        if (!l.inventoryItemId)
          throw new ProviderError("allocation_item_missing");
        if (
          l.totalQuantity < 0 ||
          l.remainingQuantity < 0 ||
          l.remainingQuantity > l.totalQuantity
        )
          throw new ProviderError("allocation_quantity_conflict");
        if (seen.has(l.id))
          throw new ProviderError("allocation_duplicate_line");
        seen.add(l.id);
        if (observations.length >= 248)
          throw new ProviderError("allocation_order_budget_exceeded");
        const active =
          !["CLOSED", "CANCELLED"].includes(g.status) &&
          l.remainingQuantity > 0;
        const o = await record(
          connection,
          entity,
          l.id,
          g.updatedAt,
          order.test,
          {
            dataset: "allocations",
            order_id: entity,
            line_id: await opaqueIdentity(connection, l.lineItem.id),
            item_id: await opaqueIdentity(connection, l.inventoryItemId),
            location_id: await opaqueIdentity(
              connection,
              g.assignedLocation.location.id,
            ),
            quantity: String(l.remainingQuantity),
            unit: "piece",
            status: active ? "active" : "released",
            basis: "derived_plan",
            snapshot_scope: entity,
          },
        );
        observations.push(o);
        members.push(o.economic_id);
      }
    }
  } catch (e) {
    error = e instanceof ProviderError ? e.code : "provider_record_invalid";
    observations.length = 0;
    members.length = 0;
  }
  if (declined) {
    observations.length = 0;
    members.length = 0;
  }
  // Provider assignments do not establish actual stock reservations or allocation policy.
  // The bounded cohort prevents omitted/moved assignments lingering in a later current snapshot.
  const coverage = await record(
    connection,
    entity,
    "allocations:" + order.id,
    through,
    order.test,
    {
      dataset: "coverage",
      capability: "allocations",
      entity_scope: entity,
      history_start: through,
      complete_through: through,
      backfill_complete: false,
      missing_fields: [
        "allocations.reservation_basis",
        ...(error ? ["allocations.invalid_snapshot"] : []),
        ...(declined ? ["allocations.opening_state_declined"] : []),
      ],
      failure_state: error ? "error" : "incomplete",
      basis: "declared",
      history_kind: "snapshot_only",
      allocation_ids: members,
      limitations: [
        "allocations.assignments_not_stock_reservations",
        "allocations.accessible_subset_only",
      ],
    },
  );
  observations.push(coverage);
  return [
    {
      object_id: object,
      dataset: "allocations",
      observations,
      raw: declined
        ? {
            source_scope: "allocation_order_snapshot",
            through,
            order_context: header.parse(order),
            openingAssignmentsDeclined: true,
          }
        : retained,
      ...(error ? { error_code: error } : {}),
    },
  ];
}

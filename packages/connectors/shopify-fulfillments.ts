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

const time = z.iso.datetime({ offset: true }),
  id = z.string().max(200);
const header = z.object({
  id,
  createdAt: time,
  updatedAt: time,
  test: z.boolean(),
  currencyCode: z.string(),
});
const line = z.object({
  id,
  quantity: z.number().int().nullable(),
  lineItem: z.object({ id }),
});
const linesPage = z.object({ nodes: z.array(line).max(500), pageInfo });
const shipment = z.object({
  id,
  createdAt: time,
  updatedAt: time,
  status: z.enum(["SUCCESS", "CANCELLED", "FAILURE", "ERROR"]),
  inTransitAt: time.nullable(),
  deliveredAt: time.nullable(),
  location: z.object({ id }).nullable(),
  fulfillmentLineItems: linesPage,
});
const lineFields = "id quantity lineItem{id}";
const fields = `id createdAt updatedAt status inTransitAt deliveredAt location{id} fulfillmentLineItems(first:20){nodes{${lineFields}}pageInfo{hasNextPage endCursor}}`;
export const fulfillmentsQuery = `query BlackboxFulfillments($after:String,$query:String!){orders(first:5,after:$after,query:$query,sortKey:UPDATED_AT){nodes{id createdAt updatedAt test currencyCode fulfillmentsCount{count precision} fulfillments{${fields}}}pageInfo{hasNextPage endCursor}}}`;
const moreLines = `query BlackboxFulfillmentLines($id:ID!,$after:String){fulfillment(id:$id){updatedAt fulfillmentLineItems(first:20,after:$after){nodes{${lineFields}}pageInfo{hasNextPage endCursor}}}}`;

export async function fetchFulfillmentPage(
  credentials: ShopifyCredentials,
  checkpoint: Checkpoint,
  parameters: ImportParameters,
  signal: AbortSignal,
) {
  if (checkpoint.pages >= 10000)
    throw new ProviderError("page_budget_exceeded");
  const data = await shopifyGraphql(
    credentials,
    fulfillmentsQuery,
    { after: checkpoint.after, query: selectionQuery(checkpoint, parameters) },
    signal,
  );
  const page = z
    .object({ nodes: z.array(z.unknown()).max(5), pageInfo })
    .parse(data.orders);
  if (
    page.pageInfo.hasNextPage &&
    (!page.pageInfo.endCursor || page.pageInfo.endCursor === checkpoint.after)
  )
    throw new ProviderError("invalid_pagination");
  const nodes = [];
  let totalLines = 0;
  for (const raw of page.nodes) {
    const order = header
      .extend({
        fulfillmentsCount: z
          .object({
            count: z.number().int().nonnegative(),
            precision: z.literal("EXACT"),
          })
          .nullable(),
        fulfillments: z.array(shipment).max(1000),
      })
      .parse(raw);
    if (
      !order.fulfillmentsCount ||
      order.fulfillmentsCount.count !== order.fulfillments.length
    )
      throw new ProviderError("fulfillment_population_incomplete");
    const identities = new Set<string>();
    for (const ship of order.fulfillments) {
      if (identities.has(ship.id))
        throw new ProviderError("fulfillment_duplicate_identity");
      identities.add(ship.id);
      totalLines += ship.fulfillmentLineItems.nodes.length;
      if (totalLines > 10000)
        throw new ProviderError("fulfillment_page_line_budget_exceeded");
      let info = ship.fulfillmentLineItems.pageInfo;
      const cursors = new Set<string>();
      while (info.hasNextPage) {
        if (!info.endCursor || cursors.has(info.endCursor))
          throw new ProviderError("invalid_pagination");
        cursors.add(info.endCursor);
        if (ship.fulfillmentLineItems.nodes.length >= 500)
          throw new ProviderError("fulfillment_line_budget_exceeded");
        const response = await shopifyGraphql(
          credentials,
          moreLines,
          { id: ship.id, after: info.endCursor },
          signal,
        );
        const parsed = z
          .object({ updatedAt: time, fulfillmentLineItems: linesPage })
          .parse(response.fulfillment);
        if (parsed.updatedAt !== ship.updatedAt)
          throw new ProviderError(
            "fulfillment_changed_during_pagination",
            1000,
          );
        totalLines += parsed.fulfillmentLineItems.nodes.length;
        if (totalLines > 10000)
          throw new ProviderError("fulfillment_page_line_budget_exceeded");
        ship.fulfillmentLineItems.nodes.push(
          ...parsed.fulfillmentLineItems.nodes,
        );
        if (ship.fulfillmentLineItems.nodes.length > 500)
          throw new ProviderError("fulfillment_line_budget_exceeded");
        info = parsed.fulfillmentLineItems.pageInfo;
      }
      ship.fulfillmentLineItems.pageInfo = info;
    }
    nodes.push(order);
  }
  return { nodes, pageInfo: page.pageInfo };
}
export async function normalizeFulfillments(
  raw: unknown,
  connection: string,
  parameters: ImportParameters,
  stage: string,
  through: string,
): Promise<SourceObject[]> {
  const order = header
    .extend({
      fulfillmentsCount: z
        .object({
          count: z.number().int().nonnegative(),
          precision: z.literal("EXACT"),
        })
        .nullable(),
      fulfillments: z.array(shipment).max(1000),
    })
    .parse(raw);
  if (
    !order.fulfillmentsCount ||
    order.fulfillmentsCount.count !== order.fulfillments.length
  )
    throw new ProviderError("fulfillment_population_incomplete");
  if (Date.parse(order.updatedAt) > Date.parse(through))
    throw new ProviderError("fulfillment_after_fixed_cutoff");
  const entity = await opaqueIdentity(connection, order.id),
    results: SourceObject[] = [];
  for (const ship of order.fulfillments) {
    const object = await opaqueIdentity(connection, "fulfillments:" + ship.id);
    const retained = {
      source_scope: "single_fulfillment",
      order_context: header.parse(order),
      fulfillment: ship,
    };
    try {
      if (ship.fulfillmentLineItems.pageInfo.hasNextPage)
        throw new ProviderError("fulfillment_line_pagination_required");
      if (
        [
          ship.createdAt,
          ship.updatedAt,
          ship.inTransitAt,
          ship.deliveredAt,
        ].some((t) => t && Date.parse(t) > Date.parse(through))
      )
        throw new ProviderError("fulfillment_after_fixed_cutoff");
      if (
        Date.parse(ship.createdAt) > Date.parse(ship.updatedAt) ||
        [ship.inTransitAt, ship.deliveredAt].some(
          (t) =>
            t &&
            (Date.parse(t) < Date.parse(ship.createdAt) ||
              Date.parse(t) > Date.parse(ship.updatedAt)),
        )
      )
        throw new ProviderError("fulfillment_milestone_order_conflict");
      if (
        ship.inTransitAt &&
        ship.deliveredAt &&
        Date.parse(ship.inTransitAt) > Date.parse(ship.deliveredAt)
      )
        throw new ProviderError("fulfillment_milestone_order_conflict");
      const physical = ship.deliveredAt
        ? "delivered"
        : ship.inTransitAt
          ? "handed_over"
          : ship.status === "CANCELLED"
            ? "cancelled"
            : ship.status === "SUCCESS"
              ? "prepared"
              : "failed";
      const businessAt =
        ship.deliveredAt ??
        ship.inTransitAt ??
        (physical === "prepared" ? ship.createdAt : ship.updatedAt);
      const related =
        parameters.include_related_records ||
        (stage === "open" && parameters.include_open_items);
      if (
        !related &&
        Date.parse(businessAt) < Date.parse(parameters.requested_from)
      ) {
        results.push({
          object_id: object,
          dataset: "fulfillments",
          observations: [],
          raw: { id: ship.id, reason: "older_context_declined" },
          skipped: true,
        });
        continue;
      }
      const identities = new Set<string>(),
        canonicalLines = [];
      for (const l of ship.fulfillmentLineItems.nodes) {
        if (l.quantity === null)
          throw new ProviderError("fulfillment_quantity_missing");
        if (l.quantity < 0)
          throw new ProviderError("fulfillment_quantity_negative");
        if (identities.has(l.lineItem.id))
          throw new ProviderError("fulfillment_duplicate_line");
        identities.add(l.lineItem.id);
        canonicalLines.push({
          line_id: await opaqueIdentity(connection, l.lineItem.id),
          quantity: String(l.quantity),
          unit: "piece" as const,
        });
      }
      const observation = await record(
        connection,
        entity,
        ship.id,
        ship.updatedAt,
        order.test,
        {
          dataset: "fulfillments",
          order_id: entity,
          state: physical,
          lines: canonicalLines,
          ...(ship.location
            ? {
                location_id: await opaqueIdentity(connection, ship.location.id),
              }
            : {}),
          ...(ship.inTransitAt ? { handover_at: ship.inTransitAt } : {}),
          ...(ship.deliveredAt ? { delivered_at: ship.deliveredAt } : {}),
          administrative_status: (
            {
              SUCCESS: "success",
              CANCELLED: "cancelled",
              ERROR: "error",
              FAILURE: "failure",
            } as const
          )[ship.status],
        },
      );
      results.push({
        object_id: object,
        dataset: "fulfillments",
        observations: [observation],
        raw: retained,
        ...(["prepared", "failed"].includes(physical)
          ? { coverage_missing: ["fulfillments.handover_confirmation"] }
          : {}),
      });
    } catch (e) {
      results.push({
        object_id: object,
        dataset: "fulfillments",
        observations: [],
        raw: retained,
        error_code:
          e instanceof ProviderError ? e.code : "provider_record_invalid",
      });
    }
  }
  return results;
}

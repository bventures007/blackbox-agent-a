import { z } from "zod";
import { opaqueIdentity } from "../auth/secrets.js";
import { type RecordObservation } from "../contracts/records.js";
import { shopifyGraphql, type ShopifyCredentials } from "./shopify-client.js";
import { ProviderError } from "./transport.js";
import {
  pageInfo,
  record,
  type Checkpoint,
  type ImportParameters,
  type SourceObject,
} from "./shopify-source.js";

const time = z.iso.datetime({ offset: true });
const quantityNames = [
  "available",
  "on_hand",
  "committed",
  "reserved",
  "damaged",
  "safety_stock",
  "quality_control",
  "incoming",
] as const;
const levelFields = `id createdAt updatedAt isActive location{id} quantities(names:${JSON.stringify(quantityNames)}){name quantity updatedAt}`;
const levels = `inventoryLevels(first:20,includeInactive:true){nodes{${levelFields}}pageInfo{hasNextPage endCursor}}`;
// A full bounded scan is intentional: InventoryItem.updatedAt is not a quantity-change cursor.
export const stockQuery = `query BlackboxStock($after:String){inventoryItems(first:5,after:$after){nodes{id createdAt updatedAt tracked ${levels}}pageInfo{hasNextPage endCursor}}}`;
export const levelsQuery = `query BlackboxStockLevels($id:ID!,$after:String){inventoryItem(id:$id){id updatedAt tracked inventoryLevels(first:20,after:$after,includeInactive:true){nodes{${levelFields}}pageInfo{hasNextPage endCursor}}}}`;
const connectionPage = z.object({
  nodes: z.array(z.unknown()).max(100),
  pageInfo,
});
const itemHeader = z.object({
  id: z.string().regex(/^gid:\/\/shopify\/InventoryItem\/\d+$/),
  createdAt: time,
  updatedAt: time,
  tracked: z.boolean(),
});
const item = itemHeader.extend({
  inventoryLevels: z.object({
    nodes: z
      .array(
        z.object({
          id: z.string().max(200),
          createdAt: time,
          updatedAt: time,
          isActive: z.boolean(),
          location: z.object({
            id: z.string().regex(/^gid:\/\/shopify\/Location\/\d+$/),
          }),
          quantities: z
            .array(
              z.object({
                name: z.enum(quantityNames),
                quantity: z.number().int().safe(),
                updatedAt: time.nullable(),
              }),
            )
            .max(8),
        }),
      )
      .max(248),
    pageInfo,
  }),
});

export async function fetchStockPage(
  credentials: ShopifyCredentials,
  checkpoint: Checkpoint,
  signal: AbortSignal,
) {
  if (!checkpoint.through)
    throw new ProviderError("fixed_poll_cutoff_required");
  if (checkpoint.pages >= 10000)
    throw new ProviderError("page_budget_exceeded");
  const result = await shopifyGraphql(
    credentials,
    stockQuery,
    { after: checkpoint.after },
    signal,
  );
  const page = connectionPage.parse(result.inventoryItems);
  if (
    page.nodes.length > 5 ||
    (page.pageInfo.hasNextPage &&
      (!page.pageInfo.endCursor ||
        page.pageInfo.endCursor === checkpoint.after))
  )
    throw new ProviderError("invalid_pagination");
  const nodes = [];
  for (const raw of page.nodes) {
    const node = itemHeader
      .extend({ inventoryLevels: connectionPage })
      .parse(raw);
    let info = node.inventoryLevels.pageInfo;
    const seen = new Set<string>();
    while (info.hasNextPage) {
      if (!info.endCursor || seen.has(info.endCursor))
        throw new ProviderError("invalid_pagination");
      seen.add(info.endCursor);
      if (node.inventoryLevels.nodes.length >= 248)
        throw new ProviderError("inventory_location_budget_exceeded");
      const next = await shopifyGraphql(
        credentials,
        levelsQuery,
        { id: node.id, after: info.endCursor },
        signal,
      );
      const parsed = itemHeader
        .omit({ createdAt: true })
        .extend({ inventoryLevels: connectionPage })
        .parse(next.inventoryItem);
      if (
        parsed.id !== node.id ||
        parsed.updatedAt !== node.updatedAt ||
        parsed.tracked !== node.tracked
      )
        throw new ProviderError("inventory_changed_during_pagination", 1000);
      node.inventoryLevels.nodes.push(...parsed.inventoryLevels.nodes);
      if (node.inventoryLevels.nodes.length > 248)
        throw new ProviderError("inventory_location_budget_exceeded");
      info = parsed.inventoryLevels.pageInfo;
    }
    node.inventoryLevels.pageInfo = info;
    nodes.push(node);
  }
  return { nodes, pageInfo: page.pageInfo };
}

export async function normalizeStock(
  raw: unknown,
  connection: string,
  parameters: ImportParameters,
  through: string,
  synthetic = false,
): Promise<SourceObject[]> {
  const header = itemHeader.parse(raw),
    entity = await opaqueIdentity(connection, header.id),
    object = await opaqueIdentity(connection, "stock:" + header.id),
    snapshot = await opaqueIdentity(
      connection,
      `stock-snapshot:${header.id}:${through}`,
    );
  const missing = new Set<string>();
  const observations: RecordObservation[] = [];
  let error: string | undefined,
    skipped = false;
  let retainedRaw: unknown = raw;
  try {
    const value = item.parse(raw);
    if (value.inventoryLevels.pageInfo.hasNextPage)
      throw new ProviderError("inventory_pagination_required");
    if (!value.tracked) throw new ProviderError("inventory_not_tracked");
    if (
      Date.parse(value.createdAt) > Date.parse(through) ||
      Date.parse(value.updatedAt) > Date.parse(through)
    )
      throw new ProviderError("inventory_after_fixed_cutoff");
    if ((raw as any).openingLevelsDeclined === true) {
      skipped = true;
      missing.add("stock.opening_declined");
    }
    const locations = new Set<string>(),
      ids = new Set<string>();
    for (const level of value.inventoryLevels.nodes) {
      if (locations.has(level.location.id) || ids.has(level.id))
        throw new ProviderError("inventory_duplicate_location");
      locations.add(level.location.id);
      ids.add(level.id);
      if (
        Date.parse(level.createdAt) > Date.parse(through) ||
        Date.parse(level.updatedAt) > Date.parse(through)
      )
        throw new ProviderError("inventory_after_fixed_cutoff");
      if (!level.isActive) continue;
      const names = new Set(level.quantities.map((q) => q.name));
      if (
        names.size !== quantityNames.length ||
        names.size !== level.quantities.length
      )
        throw new ProviderError("inventory_quantities_incomplete");
      if (level.quantities.some((q) => q.updatedAt === null))
        throw new ProviderError("inventory_quantity_time_missing");
      if (
        Date.parse(level.updatedAt) > Date.parse(through) ||
        level.quantities.some(
          (q) => Date.parse(q.updatedAt!) > Date.parse(through),
        )
      )
        throw new ProviderError("inventory_after_fixed_cutoff");
      // Neither an old opening balance nor a mixture of new and old quantity states is silently imported.
      if (
        !parameters.include_opening_state &&
        level.quantities.some(
          (q) =>
            Date.parse(q.updatedAt!) < Date.parse(parameters.requested_from),
        )
      ) {
        missing.add("stock.opening_declined");
        skipped = true;
        continue;
      }
      if (level.quantities.some((q) => q.quantity < 0))
        throw new ProviderError("inventory_negative_quantity");
      const quantities = Object.fromEntries(
        level.quantities.map((q) => [
          q.name === "on_hand" ? "physical" : q.name,
          String(q.quantity),
        ]),
      );
      observations.push(
        await record(connection, entity, level.id, through, synthetic, {
          dataset: "stock",
          item_id: entity,
          location_id: await opaqueIdentity(connection, level.location.id),
          unit: "piece",
          basis: "provider_available",
          snapshot_id: snapshot,
          ...quantities,
        }),
      );
    }
  } catch (e) {
    observations.length = 0;
    error = e instanceof ProviderError ? e.code : "provider_record_invalid";
    missing.add("stock.invalid_snapshot");
  }
  if (skipped || (error && !parameters.include_opening_state)) {
    observations.length = 0;
    retainedRaw = {
      ...header,
      openingLevelsDeclined: true,
      inventoryLevels: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  }
  // One atomic item cohort retires locations absent from a subsequent full enumeration without inventing a zero balance.
  observations.push(
    await record(
      connection,
      entity,
      "stock-cohort:" + header.id,
      through,
      synthetic,
      {
        dataset: "coverage",
        capability: "stock",
        entity_scope: entity,
        history_start: through,
        complete_through: through,
        backfill_complete: !error && !skipped,
        missing_fields: [...missing],
        failure_state: error ? "error" : skipped ? "incomplete" : "none",
        basis: "declared",
        history_kind: "snapshot_only",
        stock_snapshot_id: snapshot,
        limitations: [
          "stock.non_atomic_snapshot",
          "stock.no_historical_opening",
        ],
      },
    ),
  );
  if (!error && !skipped)
    observations.push(
      await record(
        connection,
        entity,
        "stock-identity:" + header.id,
        through,
        synthetic,
        {
          dataset: "coverage",
          capability: "identity",
          entity_scope: entity,
          history_start: through,
          complete_through: through,
          backfill_complete: true,
          missing_fields: [],
          failure_state: "none",
          basis: "declared",
          history_kind: "snapshot_only",
        },
      ),
    );
  return [
    {
      object_id: object,
      dataset: "stock",
      observations,
      raw: {
        source_scope: "inventory_item_snapshot",
        through,
        synthetic,
        item: retainedRaw,
      },
      ...(error ? { error_code: error } : skipped ? { skipped: true } : {}),
    },
  ];
}

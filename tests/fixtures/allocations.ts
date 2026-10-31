import { fulfillmentOrder } from "./fulfillments.js";
export function assignmentOrder(n: number, at: string, extra = false) {
  const order = fulfillmentOrder(n, at, "cancelled", extra);
  const line = (m: number) => ({
    id: `gid://shopify/FulfillmentOrderLineItem/${m}`,
    inventoryItemId: `gid://shopify/InventoryItem/${m}` as string | null,
    lineItem: { id: `gid://shopify/LineItem/${m}` },
    totalQuantity: 3,
    remainingQuantity: 3,
    requiresShipping: true,
  });
  const group = (m: number, lines = false) => ({
    id: `gid://shopify/FulfillmentOrder/${m}`,
    createdAt: at,
    updatedAt: at,
    status: "OPEN",
    assignedLocation: {
      location: { id: "gid://shopify/Location/1" } as { id: string } | null,
    },
    lineItems: {
      nodes: [line(m)],
      pageInfo: {
        hasNextPage: lines,
        endCursor: lines ? "allocation-lines-next" : (null as string | null),
      },
    },
    extraLines: lines ? [line(m + 1000)] : [],
  });
  return {
    ...order,
    cancelledAt: order.cancelledAt as string | null,
    fulfillments: [],
    fulfillmentsCount: { count: 0, precision: "EXACT" },
    fulfillmentOrders: {
      nodes: [group(n, extra)],
      pageInfo: {
        hasNextPage: extra,
        endCursor: extra ? "allocation-groups-next" : (null as string | null),
      },
    },
    extraGroups: extra ? [group(n + 2000)] : [],
  };
}

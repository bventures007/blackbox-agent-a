export function fulfillmentOrder(
  n: number,
  at: string,
  state = "handed_over",
  extra = false,
) {
  const money = (amount: string) => ({
    shopMoney: { amount, currencyCode: "EUR" },
  });
  const item = (m: number) => ({
    id: `gid://shopify/LineItem/${m}`,
    quantity: 3,
    currentQuantity: 3,
    variant: { inventoryItem: { id: `gid://shopify/InventoryItem/${m}` } },
    originalTotalSet: money("30.00"),
    discountAllocations: [],
    taxLines: [],
  });
  const line = (m: number) => ({
    id: `gid://shopify/FulfillmentLineItem/${m}`,
    quantity: 2 as number | null,
    lineItem: { id: `gid://shopify/LineItem/${m}` },
  });
  return {
    id: `gid://shopify/Order/${n}`,
    createdAt: at,
    updatedAt: at,
    test: true,
    currencyCode: "EUR",
    closed: false,
    cancelledAt: null,
    taxesIncluded: true,
    totalPriceSet: money(extra ? "60.00" : "30.00"),
    lineItems: {
      nodes: [item(n), ...(extra ? [item(n + 1000)] : [])],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    transactionsCount: { count: 0, precision: "EXACT" },
    transactions: [],
    fulfillmentsCount: { count: 1, precision: "EXACT" },
    fulfillments: [
      {
        id: `gid://shopify/Fulfillment/${n}`,
        createdAt: at,
        updatedAt: at,
        status: state === "cancelled" ? "CANCELLED" : "SUCCESS",
        inTransitAt: state === "prepared" || state === "cancelled" ? null : at,
        deliveredAt: state === "delivered" ? at : null,
        location: { id: "gid://shopify/Location/1" },
        fulfillmentLineItems: {
          nodes: [line(n)],
          pageInfo: {
            hasNextPage: extra,
            endCursor: extra ? "fulfillment-next" : null,
          },
        },
        extraLines: extra ? [line(n + 1000)] : [],
      },
    ],
  };
}

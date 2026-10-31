export function stockItem(
  n: number,
  available = 7,
  at = "2026-10-30T12:00:00Z",
) {
  return {
    id: "gid://shopify/InventoryItem/" + n,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: at,
    tracked: true,
    inventoryLevels: {
      nodes: [
        {
          id: "gid://shopify/InventoryLevel/" + n,
          createdAt: at,
          updatedAt: at,
          isActive: true,
          location: { id: "gid://shopify/Location/" + n },
          quantities: Object.entries({
            available,
            on_hand: 90,
            committed: 20,
            reserved: 3,
            damaged: 2,
            safety_stock: 1,
            quality_control: 4,
            incoming: 500,
          }).map(([name, quantity]) => ({
            name,
            quantity,
            updatedAt: at as string | null,
          })),
        },
      ],
      pageInfo: { hasNextPage: false, endCursor: null as string | null },
    },
  };
}

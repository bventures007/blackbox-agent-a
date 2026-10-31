import Fastify from "fastify";
const app = Fastify({ logger: false });
let revision = 0;
let sourceScenario: Record<string, any> = {};
let sourceRequests: Record<string, unknown>[] = [];
export function fixtureOrder(n: number, amount: string) {
  return {
    id: `gid://shopify/Order/${n}`,
    updatedAt: revision === 1 ? "2026-10-31T10:30:00Z" : "2026-10-31T10:00:00Z",
    createdAt: "2026-10-30T09:00:00Z",
    test: true,
    currencyCode: "EUR",
    currentTotalPriceSet: {
      shopMoney: {
        amount: [1, 3].includes(revision) ? "130.00" : amount,
        currencyCode: "EUR",
      },
    },
    lineItems: {
      nodes: [{ id: `gid://shopify/LineItem/${n}`, quantity: 2 }],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    transactions: [
      {
        id: `gid://shopify/OrderTransaction/${n + 100}`,
        kind: "CAPTURE",
        status: "SUCCESS",
        processedAt: "2026-10-31T09:05:00Z",
        test: true,
        amountSet: { shopMoney: { amount, currencyCode: "EUR" } },
        parentTransaction: { id: `gid://shopify/OrderTransaction/${n + 200}` },
      },
      {
        id: `gid://shopify/OrderTransaction/${n + 200}`,
        kind: "AUTHORIZATION",
        status: "SUCCESS",
        processedAt: "2026-10-31T09:00:00Z",
        test: true,
        amountSet: { shopMoney: { amount, currencyCode: "EUR" } },
        parentTransaction: null,
      },
    ],
  };
}
app.post("/admin/api/2026-10/graphql.json", async (req) => {
  if (req.headers["x-shopify-access-token"] !== "synthetic-fixture-token")
    return { errors: [{ message: "Unauthorized" }] };
  const body = req.body as {
    variables: { after: string | null };
    query: string;
  };
  if (body.query.includes("BlackboxIdentity"))
    return {
      data: {
        shop: {
          id: sourceScenario.account_id ?? "gid://shopify/Shop/7001",
          ianaTimezone: "Europe/Berlin",
        },
        currentAppInstallation: {
          accessScopes: (
            sourceScenario.scopes ?? ["read_orders", "read_all_orders"]
          ).map((handle: string) => ({ handle })),
        },
      },
    };
  if (body.query.includes("BlackboxStock")) {
    const vars = body.variables as any;
    const items = sourceScenario.stock_items ?? [];
    sourceRequests.push({
      query: body.query.includes("BlackboxStockLevels")
        ? "stock_levels"
        : "stock",
      variables: vars,
    });
    if (body.query.includes("BlackboxStockLevels")) {
      const item = items.find((i: any) => i.id === vars.id);
      return {
        data: {
          inventoryItem: {
            id: item.id,
            updatedAt: item.updatedAt,
            tracked: item.tracked,
            inventoryLevels: {
              nodes: item.extraLevels ?? [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    }
    const index = vars.after ? Number(vars.after) : 0,
      item = items[index];
    return {
      data: {
        inventoryItems: {
          nodes: item ? [item] : [],
          pageInfo: {
            hasNextPage: index + 1 < items.length,
            endCursor: item ? String(index + 1) : null,
          },
        },
      },
    };
  }
  if (
    body.query.includes("BlackboxSource") ||
    body.query.includes("BlackboxFulfillment")
  ) {
    sourceRequests.push({
      query: body.query.includes("BlackboxSourceLines")
        ? "lines"
        : body.query.includes("BlackboxFulfillmentLines")
          ? "fulfillment_lines"
          : body.query.includes("BlackboxFulfillments")
            ? "fulfillments"
            : "orders",
      variables: body.variables,
    });
    if (sourceScenario.rate_limit) {
      sourceScenario.rate_limit--;
      return {
        errors: [{ extensions: { code: "THROTTLED" } }],
        extensions: {
          cost: {
            requestedQueryCost: 50,
            throttleStatus: { currentlyAvailable: 0, restoreRate: 10 },
          },
        },
      };
    }
    const orders = sourceScenario.orders ?? [];
    if (body.query.includes("BlackboxFulfillmentLines")) {
      const vars = body.variables as any,
        shipment = orders
          .flatMap((o: any) => o.fulfillments ?? [])
          .find((s: any) => s.id === vars.id);
      return {
        data: {
          fulfillment: {
            updatedAt: shipment.updatedAt,
            fulfillmentLineItems: {
              nodes: shipment.extraLines ?? [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    }
    if (body.query.includes("BlackboxSourceLines")) {
      const vars = body.variables as any,
        node = orders.find((o: any) => o.id === vars.id);
      return {
        data: {
          order: {
            updatedAt: node.updatedAt,
            lineItems: {
              nodes: node.extraLines ?? [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        },
      };
    }
    const vars = body.variables as any,
      after = vars.after ? Number(vars.after) : 0,
      query = vars.query as string,
      bounds = [...query.matchAll(/updated_at:(>=|<)'([^']+)'/g)],
      selected = orders.filter(
        (o: any) =>
          bounds.every((m) =>
            m[1] === ">="
              ? Date.parse(o.updatedAt) >= Date.parse(m[2])
              : Date.parse(o.updatedAt) < Date.parse(m[2]),
          ) &&
          (!query.includes("status:open") || !o.closed || o.unsettled),
      );
    const node = selected[after],
      hasNext = after + 1 < selected.length;
    return {
      data: {
        orders: {
          nodes: node ? [node] : [],
          pageInfo: {
            hasNextPage: hasNext,
            endCursor: node ? String(after + 1) : null,
          },
        },
      },
    };
  }
  if (!body.query.includes("transactions"))
    return { errors: [{ message: "Missing selection" }] };
  const second = body.variables.after === "page-1";
  return {
    data: {
      orders: {
        nodes: [
          (() => {
            const order = fixtureOrder(
              second ? 202 : 101,
              second ? "55.73" : "119.00",
            );
            if (revision === 2) {
              if (second) order.transactions = [];
              else
                order.transactions.unshift({
                  id: "gid://shopify/OrderTransaction/999",
                  kind: "REFUND",
                  status: "SUCCESS",
                  processedAt: "2026-10-31T09:09:00Z",
                  test: true,
                  amountSet: {
                    shopMoney: { amount: "23.80", currencyCode: "EUR" },
                  },
                  parentTransaction: {
                    id: "gid://shopify/OrderTransaction/201",
                  },
                });
            }
            return order;
          })(),
        ],
        pageInfo: {
          hasNextPage: !second,
          endCursor: second ? "page-2" : "page-1",
        },
      },
    },
  };
});
app.post("/source-scenario", async (req) => {
  sourceScenario = req.body as any;
  sourceRequests = [];
  return { ok: true };
});
app.get("/source-requests", async () => ({ requests: sourceRequests }));
app.post("/admin/oauth/access_token", async (_req, reply) =>
  reply.code(400).send({ error: "synthetic_access_token_fixture_only" }),
);
app.post("/revision", async (req) => {
  revision = (req.body as { revision: number }).revision;
  return { ok: true };
});
await app.listen({
  host: process.env.CONTAINER_RUNTIME === "1" ? "0.0.0.0" : "127.0.0.1",
  port: Number(process.env.FIXTURE_PORT ?? 8082),
});

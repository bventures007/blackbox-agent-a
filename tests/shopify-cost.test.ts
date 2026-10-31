import { test } from "node:test";
import assert from "node:assert/strict";
import { shopifyGraphql } from "../packages/connectors/shopify-client.js";
import { ProviderError } from "../packages/connectors/transport.js";
test("Shopify requested-cost reduction is bounded, keeps cursor/cutoff and does not immediately retry throttling", async () => {
  const previous = globalThis.fetch;
  const calls: any[] = [];
  const c = {
    shop: "synthetic-cost.myshopify.com",
    auth: "access_token" as const,
    access_token: "synthetic-token",
    fixture: false,
  };
  const variables = {
    after: "opaque-cursor-2",
    query: "updated_at:<'2026-10-31T00:00:00Z'",
  };
  const query =
    "query Cost($after:String,$query:String){orders(first:5,after:$after,query:$query){nodes{lineItems(first:20){nodes{id}pageInfo{hasNextPage endCursor}}}pageInfo{hasNextPage endCursor}}}";
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      calls.push(body);
      return Response.json(
        calls.length < 3
          ? {
              errors: [{ extensions: { code: "MAX_COST_EXCEEDED" } }],
              data: { unsafe_partial: true },
            }
          : {
              data: {
                orders: {
                  nodes: [],
                  pageInfo: { hasNextPage: true, endCursor: "next" },
                },
              },
            },
      );
    };
    const result = await shopifyGraphql(
      c,
      query,
      variables,
      AbortSignal.timeout(1000),
    );
    assert.equal(result.orders.pageInfo.hasNextPage, true);
    assert.equal(calls.length, 3);
    assert.deepEqual(
      calls.map((c) =>
        [...c.query.matchAll(/first:(\d+)/g)].map((m) => Number(m[1])),
      ),
      [
        [5, 20],
        [2, 10],
        [1, 5],
      ],
    );
    for (const call of calls) assert.deepEqual(call.variables, variables);
    calls.length = 0;
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({
        errors: [{ extensions: { code: "MAX_COST_EXCEEDED" } }],
      });
    };
    await assert.rejects(
      () => shopifyGraphql(c, query, variables),
      (e) =>
        e instanceof ProviderError &&
        e.code === "provider_query_cost_exceeded" &&
        e.terminal,
    );
    assert.ok(calls.length <= 8);
    assert.ok(calls.at(-1).query.includes("lineItems(first:1)"));
    calls.length = 0;
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({
        errors: [{ extensions: { code: "THROTTLED" } }],
        extensions: {
          cost: {
            requestedQueryCost: 100,
            throttleStatus: { currentlyAvailable: 0, restoreRate: 10 },
          },
        },
      });
    };
    await assert.rejects(
      () => shopifyGraphql(c, query, variables),
      (e) =>
        e instanceof ProviderError &&
        e.code === "provider_rate_limited" &&
        e.retryAfterMs === 10000,
    );
    assert.equal(calls.length, 1);
    calls.length = 0;
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({
        errors: [{ extensions: { code: "MAX_COST_EXCEEDED" } }],
      });
    };
    await assert.rejects(
      () =>
        shopifyGraphql(
          c,
          'query Array {order(id:"opaque"){transactions(first:100){id}}}',
          {},
        ),
      (e) =>
        e instanceof ProviderError && e.code === "provider_query_cost_exceeded",
    );
    assert.equal(calls.length, 1);
    assert.ok(calls[0].query.includes("transactions(first:100)"));
    calls.length = 0;
    globalThis.fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json({
        errors: [
          { extensions: { code: "MAX_COST_EXCEEDED" } },
          { extensions: { code: "THROTTLED" } },
        ],
      });
    };
    await assert.rejects(
      () => shopifyGraphql(c, query, variables),
      (e) => e instanceof ProviderError && e.code === "provider_rate_limited",
    );
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = previous;
  }
});

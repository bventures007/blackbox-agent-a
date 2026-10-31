import { identityKey } from "../auth/key-material.js";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import type { Observation } from "../contracts/index.js";
import { ingest } from "../application/ingest.js";
import { scoped } from "../database/index.js";
import { log } from "../diagnostics/index.js";
import { providerRequest } from "./transport.js";
export const API_VERSION = "2026-10";
// Explicit provider-shaped selections; no address/name/email enters canonical data.
export const orderQuery = `query BlackboxOrders($after:String,$query:String!){orders(first:1,after:$after,query:$query,sortKey:UPDATED_AT){nodes{id updatedAt createdAt test currencyCode currentTotalPriceSet{shopMoney{amount currencyCode}} lineItems(first:100){nodes{id quantity} pageInfo{hasNextPage endCursor}} transactions(first:100){id kind status processedAt test amountSet{shopMoney{amount currencyCode}} parentTransaction{id}}}pageInfo{hasNextPage endCursor}}}`;
const amount = z.object({
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
});
const order = z.object({
  id: z.string().max(200),
  updatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  test: z.boolean(),
  currencyCode: z.string(),
  currentTotalPriceSet: z.object({ shopMoney: amount }),
  lineItems: z.object({
    nodes: z
      .array(
        z.object({ id: z.string(), quantity: z.number().int().nonnegative() }),
      )
      .max(100),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
  transactions: z
    .array(
      z.object({
        id: z.string().max(200),
        kind: z.string(),
        status: z.string(),
        processedAt: z.iso.datetime().nullable(),
        test: z.boolean(),
        amountSet: z.object({ shopMoney: amount }),
        parentTransaction: z.object({ id: z.string() }).nullable(),
      }),
    )
    .max(100),
});
export function minor(value: string, currency: string) {
  const decimals: Record<string, number> = {
    EUR: 2,
    USD: 2,
    GBP: 2,
    CHF: 2,
    JPY: 0,
    KWD: 3,
  };
  const d = decimals[currency];
  if (d === undefined) throw new Error("unsupported_currency");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > d && /[1-9]/.test(fraction.slice(d)))
    throw new Error("invalid_money_precision");
  const result =
    BigInt(whole) * 10n ** BigInt(d) +
    BigInt(fraction.slice(0, d).padEnd(d, "0") || "0");
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("money_out_of_range");
  return Number(result);
}
export async function normalize(
  raw: unknown,
  connection: string,
): Promise<Observation[]> {
  const o = order.parse(raw),
    secret = await identityKey();
  const id = (s: string) => {
    const b = createHmac("sha256", secret)
      .update(`${connection}:${s}`)
      .digest()
      .subarray(0, 16);
    b[6] = (b[6] & 15) | 80;
    b[8] = (b[8] & 63) | 128;
    const h = b.toString("hex");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  if (o.lineItems.pageInfo.hasNextPage)
    throw new Error("line_pagination_required");
  if (o.transactions.length === 100)
    throw new Error("transaction_population_may_be_truncated");
  const entity = id(o.id),
    economic = id(`order:${o.id}`);
  const events: Observation[] = [
    {
      id: id(`${o.id}:${o.updatedAt}`),
      entity_id: entity,
      kind: "order.accepted",
      occurred_at: new Date(o.updatedAt).toISOString(),
      currency: o.currencyCode,
      amount_minor: minor(
        o.currentTotalPriceSet.shopMoney.amount,
        o.currencyCode,
      ),
      economic_id: economic,
      test: o.test,
    },
  ];
  for (const t of o.transactions) {
    const kind =
      t.status === "SUCCESS"
        ? (
            {
              AUTHORIZATION: "payment.authorized",
              CAPTURE: "payment.captured",
              SALE: "payment.captured",
              REFUND: "refund.completed",
              VOID: "payment.voided",
            } as const
          )[t.kind as "SALE"]
        : t.status === "FAILURE"
          ? "payment.failed"
          : undefined;
    if (!kind) continue;
    if (!t.processedAt) throw new Error("transaction_time_missing");
    events.push({
      id: id(`${t.id}:${t.status}`),
      entity_id: entity,
      kind,
      occurred_at: new Date(t.processedAt).toISOString(),
      currency: t.amountSet.shopMoney.currencyCode,
      amount_minor: minor(
        t.amountSet.shopMoney.amount,
        t.amountSet.shopMoney.currencyCode,
      ),
      economic_id: id(t.id),
      test: t.test,
    });
  }
  return events;
}
export async function importShopify(args: {
  tenant: string;
  connection: string;
  run: string;
  shop: string;
  token: string;
  from: string;
  fixture?: boolean;
}) {
  if (
    !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(args.shop) &&
    !(
      args.fixture &&
      args.shop === (process.env.FIXTURE_HOST ?? "fixture:8082") &&
      process.env.ALLOW_SYNTHETIC_FIXTURE === "1"
    )
  )
    throw new Error("invalid_shop");
  const endpoint = `${args.fixture ? "http" : "https"}://${args.shop}/admin/api/${API_VERSION}/graphql.json`;
  let after: string | null = await scoped(
    args.tenant,
    async (c) =>
      (
        await c.query("SELECT cursor FROM bb.import_runs WHERE run_id=$1", [
          args.run,
        ])
      ).rows[0]?.cursor ?? null,
  );
  for (let page = 0; page < 10000; page++) {
    const body = await providerRequest(
      endpoint,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-Shopify-Access-Token": args.token,
        },
        body: JSON.stringify({
          query: orderQuery,
          variables: { after, query: `updated_at:>=${args.from}` },
        }),
      },
      AbortSignal.timeout(15000),
    );
    if (body.errors?.length || !body.data?.orders)
      throw new Error("provider_query_incomplete");
    const data = body.data.orders;
    const nodes = z.array(order).max(50).parse(data.nodes);
    log("source.fetched", {
      tenant_id: args.tenant,
      connection_id: args.connection,
      run_id: args.run,
      record_count: nodes.length,
    });
    let count = 0;
    for (const node of nodes) {
      const result = await ingest(
        args.tenant,
        args.connection,
        await normalize(node, args.connection),
        node,
      );
      count += result.added;
      log("journal.batch_committed", {
        tenant_id: args.tenant,
        connection_id: args.connection,
        run_id: args.run,
        committed_cursor: result.committed_cursor,
        record_count: result.added,
      });
    }
    const info = z
      .object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
      .parse(data.pageInfo);
    if (info.hasNextPage && (!info.endCursor || info.endCursor === after))
      throw new Error("invalid_pagination");
    after = info.endCursor;
    await scoped(args.tenant, (c) =>
      c.query(
        "UPDATE bb.import_runs SET cursor=$2,fetched=fetched+$3,committed=committed+$4,state=$5,updated_at=now(),last_success_at=CASE WHEN $5='complete' THEN now() ELSE last_success_at END,last_new_at=CASE WHEN $4>0 THEN now() ELSE last_new_at END WHERE run_id=$1",
        [
          args.run,
          after,
          nodes.length,
          count,
          info.hasNextPage ? "running" : "complete",
        ],
      ),
    );
    if (!info.hasNextPage) return;
  }
  throw new Error("page_budget_exceeded");
}

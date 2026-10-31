import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  normalizeSourceOrder,
  selectionQuery,
} from "../packages/connectors/shopify-source.js";
import { resolveImportSelection } from "../packages/contracts/import-plan.js";
import { boundedJson, retryAfter } from "../packages/connectors/transport.js";
import { authorizeShopify } from "../packages/connectors/shopify-client.js";
test("bounded provider transport rejects oversized JSON and never accepts arbitrary token destinations", async () => {
  await assert.rejects(
    () =>
      boundedJson(
        new Response(JSON.stringify({ value: "x".repeat(400) })),
        100,
      ),
    /provider_page_too_large/,
  );
  await assert.rejects(
    () => boundedJson(new Response("{broken")),
    /provider_invalid_json/,
  );
  assert.equal(retryAfter("5", 0), 5000);
  assert.equal(retryAfter("Thu, 01 Jan 1970 00:00:09 GMT", 0), 9000);
  assert.equal(retryAfter("-2", 0), 60000);
  for (const shop of [
    "example.com",
    "shop.myshopify.com.evil.test",
    "user@shop.myshopify.com",
    "127.0.0.1:9000",
    "shop.myshopify.com/path",
  ])
    await assert.rejects(
      () =>
        authorizeShopify({
          shop,
          auth: "access_token",
          access_token: "synthetic-token",
        }),
      /invalid_shop/,
    );
});
test("Shopify normalization preserves refund links, unknown transitions and strict context consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blackbox-a-source-")),
    previous = process.env.IDENTITY_KEY_FILE;
  process.env.IDENTITY_KEY_FILE = join(dir, "identity");
  await writeFile(process.env.IDENTITY_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  try {
    const connection = randomUUID(),
      account = randomUUID(),
      plan = resolveImportSelection(
        {
          preset: "from_now",
          timezone: "UTC",
          include_open_items: false,
          include_related_records: false,
          include_opening_state: false,
        },
        "2026-10-30T12:00:00Z",
      );
    const money = (amount: string) => ({
      shopMoney: { amount, currencyCode: "EUR" },
    });
    const raw = {
      id: "gid://shopify/Order/1",
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-10-31T12:00:00Z",
      test: true,
      currencyCode: "EUR",
      closed: false,
      cancelledAt: null,
      taxesIncluded: false,
      totalPriceSet: money("99.00"),
      lineItems: {
        nodes: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
      transactionsCount: { count: 2, precision: "EXACT" },
      transactions: [
        {
          id: "gid://shopify/OrderTransaction/1",
          kind: "CAPTURE",
          status: "SUCCESS",
          processedAt: "2026-01-02T00:00:00Z",
          test: true,
          amountSet: money("99.00"),
          parentTransaction: null,
        },
        {
          id: "gid://shopify/OrderTransaction/2",
          kind: "REFUND",
          status: "SUCCESS",
          processedAt: "2026-10-31T10:00:00Z",
          test: true,
          amountSet: money("17.23"),
          parentTransaction: { id: "gid://shopify/OrderTransaction/1" },
        },
      ],
    };
    const orders = await normalizeSourceOrder(
      raw,
      connection,
      account,
      "orders",
      plan,
      "recent",
    );
    assert.equal(orders[0].skipped, true);
    assert.ok(!JSON.stringify(orders[0].raw).includes("99.00"));
    const payments = await normalizeSourceOrder(
      raw,
      connection,
      account,
      "payments",
      plan,
      "recent",
    );
    assert.equal(payments[0].skipped, true);
    const refunds = await normalizeSourceOrder(
      raw,
      connection,
      account,
      "refunds",
      plan,
      "recent",
    );
    assert.equal((refunds[0].observations[0].record as any).amount_minor, 1723);
    assert.equal(refunds[0].observations[0].record.dataset, "refunds");
    const changed = structuredClone(raw);
    changed.transactions[1].amountSet = money("18.00");
    const changedRefund = await normalizeSourceOrder(
      changed,
      connection,
      account,
      "refunds",
      plan,
      "recent",
    );
    assert.equal(
      changedRefund[0].observations[0].id,
      refunds[0].observations[0].id,
    );
    assert.notDeepEqual(
      changedRefund[0].observations[0].record,
      refunds[0].observations[0].record,
    );
    const orphan = structuredClone(raw);
    orphan.transactions[1].parentTransaction = null;
    const unresolved = await normalizeSourceOrder(
      orphan,
      connection,
      account,
      "refunds",
      plan,
      "recent",
    );
    assert.equal(unresolved[0].error_code, "refund_parent_missing");
    assert.equal(unresolved[0].observations.length, 0);
    const partial = structuredClone(raw);
    partial.transactionsCount.count = 3;
    await assert.rejects(
      () =>
        normalizeSourceOrder(
          partial,
          connection,
          account,
          "payments",
          plan,
          "recent",
        ),
      /transaction_population_incomplete/,
    );
    assert.ok(
      selectionQuery(
        {
          from: plan.requested_from,
          through: plan.initial_cutoff,
          stage: "recent",
          after: null,
          pages: 0,
        },
        plan,
      ).includes("updated_at:<"),
    );
  } finally {
    if (previous) process.env.IDENTITY_KEY_FILE = previous;
    else delete process.env.IDENTITY_KEY_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

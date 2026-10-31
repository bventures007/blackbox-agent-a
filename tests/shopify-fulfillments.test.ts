import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { normalizeFulfillments } from "../packages/connectors/shopify-fulfillments.js";
import { resolveImportSelection } from "../packages/contracts/import-plan.js";
test("fulfillment preparation is not handover and cancellation cannot erase physical evidence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blackbox-a-fulfillment-")),
    previous = process.env.IDENTITY_KEY_FILE;
  process.env.IDENTITY_KEY_FILE = join(dir, "identity");
  await writeFile(process.env.IDENTITY_KEY_FILE, randomBytes(32), {
    mode: 0o600,
  });
  try {
    const connection = randomUUID(),
      through = "2026-10-31T12:00:00Z",
      plan = resolveImportSelection(
        { preset: "last_30_days", timezone: "UTC" },
        through,
      );
    const ship = {
      id: "gid://shopify/Fulfillment/1",
      createdAt: "2026-10-30T10:00:00Z",
      updatedAt: "2026-10-30T11:00:00Z",
      status: "SUCCESS",
      inTransitAt: null as string | null,
      deliveredAt: null as string | null,
      location: null,
      fulfillmentLineItems: {
        nodes: [
          {
            id: "gid://shopify/FulfillmentLineItem/1",
            quantity: 2 as number | null,
            lineItem: { id: "gid://shopify/LineItem/1" },
          },
        ],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const order = {
      id: "gid://shopify/Order/1",
      createdAt: "2026-10-29T10:00:00Z",
      updatedAt: ship.updatedAt,
      test: true,
      currencyCode: "EUR",
      fulfillmentsCount: { count: 1, precision: "EXACT" },
      fulfillments: [ship],
    };
    const normalize = (raw: unknown, p = plan) =>
      normalizeFulfillments(raw, connection, p, "recent", through);
    const prepared = (await normalize(order))[0];
    assert.equal((prepared.observations[0].record as any).state, "prepared");
    assert.ok(
      prepared.coverage_missing?.includes("fulfillments.handover_confirmation"),
    );
    assert.equal(prepared.error_code, undefined);
    ship.status = "CANCELLED";
    ship.inTransitAt = "2026-10-30T10:30:00Z";
    const dispatched = (await normalize(order))[0];
    assert.equal(
      (dispatched.observations[0].record as any).state,
      "handed_over",
    );
    assert.equal(
      (dispatched.observations[0].record as any).administrative_status,
      "cancelled",
    );
    ship.deliveredAt = "2026-10-30T10:45:00Z";
    const delivered = (await normalize(order))[0];
    assert.equal((delivered.observations[0].record as any).state, "delivered");
    assert.equal(delivered.observations[0].id, dispatched.observations[0].id);
    ship.fulfillmentLineItems.nodes[0].quantity = null;
    assert.equal(
      (await normalize(order))[0].error_code,
      "fulfillment_quantity_missing",
    );
    ship.fulfillmentLineItems.nodes[0].quantity = -2;
    assert.equal(
      (await normalize(order))[0].error_code,
      "fulfillment_quantity_negative",
    );
    ship.fulfillmentLineItems.nodes[0].quantity = 2;
    ship.deliveredAt = "2026-10-30T10:15:00Z";
    assert.equal(
      (await normalize(order))[0].error_code,
      "fulfillment_milestone_order_conflict",
    );
    ship.deliveredAt = null;
    ship.inTransitAt = "2026-11-01T00:00:00Z";
    assert.equal(
      (await normalize(order))[0].error_code,
      "fulfillment_after_fixed_cutoff",
    );
    ship.inTransitAt = null;
    ship.status = "SUCCESS";
    const strict = resolveImportSelection(
      {
        preset: "from_now",
        timezone: "UTC",
        include_open_items: false,
        include_related_records: false,
        include_opening_state: false,
      },
      through,
    );
    const skipped = (await normalize(order, strict))[0];
    assert.equal(skipped.skipped, true);
    assert.ok(!JSON.stringify(skipped.raw).includes("quantity"));
    order.fulfillmentsCount.count = 2;
    await assert.rejects(
      () => normalize(order),
      /fulfillment_population_incomplete/,
    );
  } finally {
    if (previous) process.env.IDENTITY_KEY_FILE = previous;
    else delete process.env.IDENTITY_KEY_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

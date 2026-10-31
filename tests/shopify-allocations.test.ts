import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { normalizeAllocations } from "../packages/connectors/shopify-allocations.js";
import { requireCapabilityScopes } from "../packages/connectors/shopify-client.js";
import { resolveImportSelection } from "../packages/contracts/import-plan.js";
import { assignmentOrder } from "./fixtures/allocations.js";
test("Shopify assignments retain incomplete reservation basis, exact quantities and strict context consent", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blackbox-a-assignment-")),
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
    const order = assignmentOrder(1, "2026-10-30T10:00:00Z"),
      normalize = (raw: unknown, p = plan) =>
        normalizeAllocations(raw, connection, p, "recent", through);
    const [result] = await normalize(order),
      record = result.observations[0].record as any,
      coverage = result.observations.at(-1)!.record as any;
    assert.equal(record.basis, "derived_plan");
    assert.equal(record.quantity, "3");
    assert.equal(record.status, "active");
    assert.equal(coverage.backfill_complete, false);
    assert.ok(
      coverage.missing_fields.includes("allocations.reservation_basis"),
    );
    assert.deepEqual(coverage.allocation_ids, [
      result.observations[0].economic_id,
    ]);
    const group = order.fulfillmentOrders.nodes[0],
      line = group.lineItems.nodes[0];
    line.remainingQuantity = 1;
    const [changed] = await normalize(order);
    assert.equal(
      changed.observations[0].id,
      result.observations[0].id,
      "same revision changed content must collide for quarantine",
    );
    line.remainingQuantity = 4;
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_quantity_conflict",
    );
    line.remainingQuantity = -1;
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_quantity_conflict",
    );
    line.remainingQuantity = 0;
    assert.equal(
      ((await normalize(order))[0].observations[0].record as any).status,
      "released",
    );
    line.remainingQuantity = 3;
    group.status = "CANCELLED";
    assert.equal(
      ((await normalize(order))[0].observations[0].record as any).status,
      "released",
    );
    group.status = "OPEN";
    group.assignedLocation.location = null;
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_location_missing",
    );
    group.assignedLocation.location = { id: "gid://shopify/Location/1" };
    line.inventoryItemId = null;
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_item_missing",
    );
    line.inventoryItemId = "gid://shopify/InventoryItem/1";
    group.lineItems.nodes.push({ ...line });
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_duplicate_line",
    );
    group.lineItems.nodes.pop();
    group.lineItems.pageInfo.hasNextPage = true;
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_line_pagination_required",
    );
    group.lineItems.pageInfo.hasNextPage = false;
    group.updatedAt = "2026-11-01T00:00:00Z";
    assert.equal(
      (await normalize(order))[0].error_code,
      "allocation_timestamp_conflict",
    );
    group.updatedAt = order.updatedAt;
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
    const [declined] = await normalize(order, strict);
    assert.equal(declined.observations.length, 1);
    assert.ok(!JSON.stringify(declined.raw).includes("Quantity"));
    assert.ok(
      (declined.observations[0].record as any).missing_fields.includes(
        "allocations.opening_state_declined",
      ),
    );
    const [retriedDecline] = await normalize(declined.raw, strict);
    assert.deepEqual(retriedDecline.observations, declined.observations);
    assert.ok(!JSON.stringify(retriedDecline.raw).includes("Quantity"));
    assert.throws(
      () => requireCapabilityScopes(["read_orders"], "allocations"),
      /provider_read_fulfillment_orders_required/,
    );
    requireCapabilityScopes(
      ["read_orders", "read_merchant_managed_fulfillment_orders"],
      "allocations",
    );
  } finally {
    if (previous) process.env.IDENTITY_KEY_FILE = previous;
    else delete process.env.IDENTITY_KEY_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

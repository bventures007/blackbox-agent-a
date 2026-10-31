import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { normalizeStock } from "../packages/connectors/shopify-stock.js";
import { resolveImportSelection } from "../packages/contracts/import-plan.js";
import { ProviderError } from "../packages/connectors/transport.js";

import { stockItem } from "./fixtures/stock.js";
test("inventory preserves supplied available state and rejects missing, negative, future and declined opening quantities", async () => {
  const dir = await mkdtemp(join(tmpdir(), "blackbox-a-stock-")),
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
    const normalize = (raw: unknown, p = plan) =>
      normalizeStock(raw, connection, p, through, true);
    const positive = (await normalize(stockItem(1)))[0];
    const stock = positive.observations.find(
      (o) => o.record.dataset === "stock",
    )!;
    assert.equal((stock.record as any).available, "7");
    assert.equal((stock.record as any).incoming, "500");
    assert.equal(positive.observations.length, 3);
    assert.equal(
      (positive.observations[1].record as any).stock_snapshot_id,
      (stock.record as any).snapshot_id,
    );
    const negative = stockItem(2, -3),
      missing = stockItem(3),
      future = stockItem(4, 9, "2026-11-01T00:00:00Z"),
      incomplete = stockItem(5);
    missing.inventoryLevels.nodes[0].quantities[0].updatedAt = null;
    incomplete.inventoryLevels.nodes[0].quantities.pop();
    for (const [raw, code] of [
      [negative, "inventory_negative_quantity"],
      [missing, "inventory_quantity_time_missing"],
      [future, "inventory_after_fixed_cutoff"],
      [incomplete, "inventory_quantities_incomplete"],
    ] as const) {
      const result = (await normalize(raw))[0];
      assert.equal(result.error_code, code);
      assert.ok(
        result.observations.every((o) => o.record.dataset === "coverage"),
      );
    }
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
    const excluded = (await normalize(stockItem(6), strict))[0];
    assert.equal(excluded.skipped, true);
    assert.ok(!JSON.stringify(excluded.raw).includes('"quantity"'));
    const replayExcluded = await normalizeStock(
      (excluded.raw as any).item,
      connection,
      strict,
      through,
      true,
    );
    assert.equal(replayExcluded[0].skipped, true);
    assert.ok(
      excluded.observations.every((o) => o.record.dataset === "coverage"),
    );
    const inactive = stockItem(7);
    inactive.inventoryLevels.nodes[0].isActive = false;
    assert.ok(
      (await normalize(inactive))[0].observations.every(
        (o) => o.record.dataset === "coverage",
      ),
    );
    inactive.inventoryLevels.nodes[0].updatedAt = "2026-11-01T00:00:00Z";
    assert.equal(
      (await normalize(inactive))[0].error_code,
      "inventory_after_fixed_cutoff",
    );
    const delay = new ProviderError("provider_rate_limited", Number.MAX_VALUE);
    assert.equal(delay.terminal, true);
    assert.equal(delay.retryAfterMs, 0);
  } finally {
    if (previous) process.env.IDENTITY_KEY_FILE = previous;
    else delete process.env.IDENTITY_KEY_FILE;
    await rm(dir, { recursive: true, force: true });
  }
});

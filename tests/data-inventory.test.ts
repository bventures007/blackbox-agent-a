import test from "node:test";
import assert from "node:assert/strict";
import {
  readInventory,
  validateInventory,
  selectionLeaves,
  validateDatabaseColumns,
} from "../scripts/data-inventory.js";
test("inventory drift denies missing canonical fields, unknown privacy policies and unmapped provider selections", async () => {
  const good = await readInventory();
  assert.ok((await validateInventory(good)).fields > 700);
  for (const mutate of [
    (x: any) => {
      x.fields = x.fields.filter(
        (r: any) => r.path !== "canonical.orders.customer_id",
      );
    },
    (x: any) => {
      x.fields[0].retention = "invented_policy";
    },
    (x: any) => {
      x.fields.find(
        (r: any) => r.path === "provider.shopify.orders.orders.nodes.id",
      ).normalization = "REVIEW_REQUIRED";
    },
    (x: any) => {
      x.reviewed_source_sha256["crates/../../secret.rs"] = "0".repeat(64);
    },
    (x: any) => {
      x.reviewed_source_sha256["crates/domain/src/reader.rs"] = "0".repeat(64);
    },
    (x: any) => {
      x.provider_query_sha256.orders = "0".repeat(64);
    },
  ]) {
    const value = structuredClone(good);
    mutate(value);
    await assert.rejects(() => validateInventory(value), /data_inventory:/);
  }
  assert.deepEqual(
    selectionLeaves(
      "query Probe($after:String){orders(first:5,after:$after){nodes{id}pageInfo{endCursor}}}",
    ),
    ["orders.nodes.id", "orders.pageInfo.endCursor"],
  );
  assert.throws(
    () => selectionLeaves("query Probe{alias:orders{id}}"),
    /requires review/,
  );
  const db = {
    fields: [
      { path: "database.example.id", sql_type: "uuid", nullable: false },
    ],
  };
  const row = {
    table_name: "example",
    column_name: "id",
    data_type: "uuid",
    is_nullable: "NO",
  };
  assert.equal(validateDatabaseColumns(db, [row]), 1);
  for (const rows of [
    [],
    [row, row],
    [{ ...row, data_type: "text" }],
    [{ ...row, is_nullable: "YES" }],
    [{ ...row, column_name: "unknown" }],
  ])
    assert.throws(() => validateDatabaseColumns(db, rows), /database column/);
});

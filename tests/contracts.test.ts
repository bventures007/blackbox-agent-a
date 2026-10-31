import { test } from "node:test";
import assert from "node:assert/strict";
import { minor } from "../packages/connectors/shopify.js";
import { observation } from "../packages/contracts/index.js";
import { fixture } from "./questions/fixtures.js";
test("money syntax preserves exact units, does not round or mix unknown currencies", () => {
  assert.equal(minor("119.00", "EUR"), 11900);
  assert.equal(minor("1.005", "KWD"), 1005);
  assert.equal(minor("42", "JPY"), 42);
  assert.throws(() => minor("1.001", "EUR"));
  assert.throws(() => minor("1.00", "ZZZ"));
  assert.throws(() => minor("999999999999999999", "EUR"));
});
test("canonical observations reject caller tenant and personal-content fields", () => {
  assert.equal(
    observation.safeParse({ tenant_id: "bad", email: "canary@example.test" })
      .success,
    false,
  );
});
test("coverage diagnostics reject free-text canaries while preserving every question fixture", () => {
  for (let index = 0; index < 24; index++) {
    for (const missing of [false, true])
      for (const row of fixture(index, missing).records)
        assert.equal(observation.safeParse(row).success, true);
  }
  const row = fixture(0).records.find((v) => v.record.dataset === "coverage")!;
  for (const field of ["missing_fields", "limitations"]) {
    for (const value of [
      "private_customer_name",
      "secret_token_canary",
      "alice.example",
      "canary@example.test",
    ])
      assert.equal(
        observation.safeParse({
          ...row,
          record: { ...row.record, [field]: [value] },
        }).success,
        false,
      );
  }
  assert.equal(
    observation.safeParse({
      ...row,
      record: {
        ...row.record,
        missing_fields: ["stock.available", "stock.invalid_snapshot"],
        limitations: ["stock.non_atomic_snapshot"],
      },
    }).success,
    true,
  );
});

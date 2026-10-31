import test from "node:test";
import assert from "node:assert/strict";
import { derivationFailure } from "../packages/application/derivation.js";

test("derivation failure details retain only closed codes and scoped UUID candidates", () => {
  const id = "a0000000-0000-4000-8000-000000000001";
  assert.deepEqual(
    derivationFailure({
      error: "unsupported_event_version",
      entry_id: id,
      raw: "secret",
    }),
    { code: "unsupported_event_version", entry: id },
  );
  for (const value of [
    null,
    {},
    { error: "SQL password=canary", entry_id: "customer@example.com" },
    { error: "unsupported_event", entry_id: "../../../keys" },
  ]) {
    const safe = JSON.stringify(derivationFailure(value));
    assert.doesNotMatch(safe, /canary|customer|keys|secret/);
  }
  assert.equal(
    derivationFailure({ error: "database_unavailable" }).code,
    "derivation_retry_exhausted",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalContract,
  runtimeContract,
  verifyDatabaseContract,
} from "../packages/runtime/compatibility.js";
import manifest from "../release/compatibility.json" with { type: "json" };

test("runtime preflight rejects changed, future, partial or fenced installations", async () => {
  const valid = [
    [{ contract: runtimeContract, state: "active" }],
    manifest.migrations,
    [{ major: 17 }],
  ];
  const check = (values: unknown[][]) => {
    let next = 0;
    return verifyDatabaseContract({
      query: async () => ({ rows: values[next++] }),
    } as never);
  };
  await check(valid);
  await check([valid[0], valid[1], [{ major: 18 }]]);
  for (const values of [
    [[{ contract: runtimeContract, state: "fenced" }], valid[1], valid[2]],
    [
      [{ contract: { ...runtimeContract, engine_rpc: 99 }, state: "active" }],
      valid[1],
      valid[2],
    ],
    [valid[0], valid[1].slice(0, 6), valid[2]],
    [
      valid[0],
      [...valid[1], { file: "008-future.sql", sha256: "a".repeat(64) }],
      valid[2],
    ],
    [
      valid[0],
      [
        { ...manifest.migrations[0], sha256: "a".repeat(64) },
        ...manifest.migrations.slice(1),
      ],
      valid[2],
    ],
    [valid[0], valid[1], [{ major: 99 }]],
  ])
    await assert.rejects(
      check(values),
      /database_contract_incompatible_or_fenced/,
    );
});

test("runtime comparison ignores key order but preserves values and protocol arrays", () => {
  assert.equal(
    canonicalContract({ b: 2, a: [1, 2] }),
    canonicalContract({ a: [1, 2], b: 2 }),
  );
  assert.notEqual(
    canonicalContract({ a: [1, 2] }),
    canonicalContract({ a: [2, 1] }),
  );
});

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

test("actual MCP rejects missing or unknown API contracts with an explicit safe error", async () => {
  const { createServer } = await import("node:http");
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } =
    await import("@modelcontextprotocol/sdk/client/stdio.js");
  const { runtimeFingerprint } =
    await import("../packages/runtime/compatibility.js");
  let header: string | undefined = "a".repeat(64);
  const server = createServer((req, res) => {
    assert.equal(req.headers["x-blackbox-contract"], runtimeFingerprint);
    req.resume();
    res.setHeader("content-type", "application/json");
    if (header) res.setHeader("x-blackbox-contract", header);
    res.end(JSON.stringify({ forbidden_unversioned_body: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const client = new Client({ name: "compatibility-adversary", version: "1" });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "packages/mcp/main.ts"],
        env: {
          ...process.env,
          BLACKBOX_API_URL: `http://127.0.0.1:${port}`,
          PUBLIC_PORT: String(port),
          BLACKBOX_AGENT_KEY: "bb_agent_" + "A".repeat(43),
        } as Record<string, string>,
        stderr: "pipe",
      }),
    );
    for (header of ["a".repeat(64), undefined]) {
      const result = await client.callTool({
        name: "get_business_state",
        arguments: { entity_id: "00000000-0000-4000-8000-000000000001" },
      });
      assert.equal(result.isError, true);
      const text = JSON.stringify(result.content);
      assert.match(text, /runtime_contract_incompatible/);
      assert.doesNotMatch(text, /forbidden_unversioned_body/);
    }
  } finally {
    await client.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

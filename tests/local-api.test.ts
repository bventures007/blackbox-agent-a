import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { localApiRequest } from "../packages/transport/local-api.js";

test("local HTTP transport retains explicit loopback authority and bounds errors/redirects", async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    seen.push(req.headers.host!);
    if (req.url === "/v1/large") {
      res.end(Buffer.alloc(4 * 1024 * 1024 + 1));
      return;
    }
    if (req.url === "/v1/redirect") {
      res.writeHead(302, { location: "http://example.test/" });
      res.end();
      return;
    }
    if (req.url === "/v1/wait") return;
    res.end(JSON.stringify({ host: req.headers.host }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const prior = process.env.PUBLIC_PORT;
  try {
    process.env.PUBLIC_PORT = "18741";
    const r = await localApiRequest(base, "/v1/status", {
      headers: { host: "evil.example" },
    });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { host: "127.0.0.1:18741" });
    delete process.env.PUBLIC_PORT;
    assert.deepEqual(await (await localApiRequest(base, "/v1/status")).json(), {
      host: `127.0.0.1:${address.port}`,
    });
    assert.equal((await localApiRequest(base, "/v1/redirect")).status, 302);
    await assert.rejects(
      localApiRequest(base, "/v1/large"),
      /response_too_large/,
    );
    await assert.rejects(
      localApiRequest(base, "/v1/wait", { signal: AbortSignal.timeout(20) }),
      /aborted/i,
    );
    for (const invalid of [
      "https://127.0.0.1",
      "http://example.test",
      "http://secret@127.0.0.1",
      `${base}/other`,
    ])
      assert.throws(
        () => localApiRequest(invalid, "/v1/status"),
        /loopback_api_required/,
      );
    assert.throws(
      () => localApiRequest(base, "//example.test"),
      /loopback_api_required/,
    );
    assert.throws(
      () =>
        localApiRequest(base, "/v1/status", {
          body: "x".repeat(2 * 1024 * 1024 + 1),
        }),
      /request_too_large/,
    );
    assert.equal(seen.length, 5);
  } finally {
    if (prior === undefined) delete process.env.PUBLIC_PORT;
    else process.env.PUBLIC_PORT = prior;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

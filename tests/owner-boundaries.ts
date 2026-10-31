import assert from "node:assert/strict";
import { readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
const base = process.env.BLACKBOX_API_URL!,
  { a, b } = JSON.parse(
    await readFile(process.env.TEST_RUNTIME_DIR + "/slice-case.json", "utf8"),
  );
async function login(key: string) {
  const r = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key }),
  });
  assert.equal(r.status, 200);
  return {
    cookie: r.headers.get("set-cookie")!.split(";")[0],
    csrf: ((await r.json()) as any).csrf,
  };
}
const owner = await login(b.owner);
async function call(path: string, body?: unknown, credentials = owner) {
  return fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      origin: base,
      cookie: credentials.cookie,
      "x-blackbox-csrf": credentials.csrf,
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
// A second synthetic tenant's context must not appear in owner diagnostics, including filters and cursors.
const own = randomUUID(),
  foreign = randomUUID(),
  connection = randomUUID(),
  now = new Date().toISOString();
for (const [id, tenant] of [
  [own, b.tenant],
  [foreign, a.tenant],
])
  await appendFile(
    process.env.LOG_DIR + "/api.jsonl",
    JSON.stringify({
      schema_version: 1,
      record_id: id,
      occurred_at: now,
      observed_at: now,
      level: "INFO",
      event_name: "query.served",
      message: "secret-canary@example.invalid",
      component: "api",
      instance_id: randomUUID(),
      scope: "workspace",
      tenant_id: tenant,
      connection_id: connection,
      unexpected_secret: "bb_owner_canary",
    }) + "\n",
  );
const query = {
  from: new Date(Date.now() - 3600000).toISOString(),
  connection_id: connection,
  limit: 1,
};
const logs = (await (await call("/v1/diagnostics/logs", query)).json()) as any;
assert.equal(logs.records.length, 1);
assert.equal(logs.records[0].record_id, own);
assert.equal(logs.records[0].message, "Business query served");
assert.ok(!JSON.stringify(logs).includes(foreign));
assert.ok(!JSON.stringify(logs).includes("secret-canary"));
assert.ok(!JSON.stringify(logs).includes("unexpected_secret"));
assert.equal(
  (await call("/v1/diagnostics/logs", { ...query, tenant_id: a.tenant }))
    .status,
  400,
);
for (const [path, body] of [
  ["/v1/diagnostics/health", undefined],
  ["/v1/diagnostics/logs", query],
  ["/v1/diagnostics/export", { confirmed: true }],
  ["/v1/overview", undefined],
  ["/v1/agents", undefined],
  ["/v1/reviews", undefined],
] as const) {
  assert.equal(
    (
      await fetch(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: "Bearer " + b.agent,
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    ).status,
    403,
  );
  assert.equal((await fetch(base + path)).status, 401);
}
assert.equal(
  (
    await fetch(base + "/v1/diagnostics/export", {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        origin: base,
        "content-type": "application/json",
      },
      body: JSON.stringify({ confirmed: true }),
    })
  ).status,
  403,
);
const created = (await (
  await call("/v1/agents", { name: "Cursor isolation verifier" })
).json()) as any;
async function journal(key: string, body: unknown) {
  return fetch(base + "/v1/tools/list_journal_entries", {
    method: "POST",
    headers: {
      authorization: "Bearer " + key,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}
const j = (await (await journal(b.agent, { limit: 1 })).json()) as any;
assert.ok(j.next_cursor);
assert.equal(
  (await journal(created.key, { limit: 1, cursor: j.next_cursor })).status,
  400,
);
assert.equal(
  (
    await journal(b.agent, {
      limit: 1,
      direction: "desc",
      cursor: j.next_cursor,
    })
  ).status,
  400,
);
assert.equal(
  (await journal(b.agent, { limit: 1, cursor: j.next_cursor + "x" })).status,
  400,
);
await call("/v1/agents/" + created.credential_id + "/revoke", {});
console.log(
  JSON.stringify({
    suite: "owner_UI_boundaries",
    result: "passed",
    checks: [
      "cross_workspace_log_rows_filters_and_counts",
      "read_time_defensive_secret_sanitization",
      "agent_and_anonymous_owner_endpoint_denial",
      "export_CSRF",
      "same_workspace_different_principal_journal_cursor_denial",
      "journal_cursor_filter_and_signature_binding",
    ],
  }),
);

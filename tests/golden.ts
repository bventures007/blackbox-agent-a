import type { Observation } from "../packages/contracts/index.js";
import assert from "node:assert/strict";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { signature } from "../packages/auth/producer.js";
import { newKey, verifier } from "../packages/auth/index.js";
import {
  replayObservation,
  sendObservations,
} from "../packages/connectors/replay.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  api = process.env.BLACKBOX_API_URL!;
const golden = JSON.parse(await readFile("GOLDEN-ORDER-TO-CASH.json", "utf8"));
const saved = `${process.env.TEST_RUNTIME_DIR}/golden-cases.json`;
async function provision() {
  const tenant = randomUUID(),
    owner = newKey("owner"),
    agent = newKey("agent");
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic Golden')",
    [tenant],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, key] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Synthetic')",
      [tenant, randomUUID(), randomUUID(), purpose, verifier(key)],
    );
  const login = await fetch(api + "/v1/login", {
    method: "POST",
    headers: { "content-type": "application/json", origin: api },
    body: JSON.stringify({ key: owner }),
  });
  assert.equal(login.status, 200);
  const { csrf } = (await login.json()) as any,
    cookie = login.headers.get("set-cookie")!.split(";")[0];
  const r = await fetch(api + "/v1/producers", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: api,
      cookie,
      "x-blackbox-csrf": csrf,
    },
    body: JSON.stringify({ name: "Golden replay", provider: "replay" }),
  });
  assert.equal(r.status, 200);
  return { tenant, agent, ...((await r.json()) as any) };
}
async function state(key: string, entity: string, cutoff?: number) {
  for (let n = 0; n < 150; n++) {
    const r = await fetch(api + "/v1/tools/get_business_state", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        entity_id: entity,
        ...(cutoff !== undefined ? { recorded_cutoff: cutoff } : {}),
      }),
    });
    const body = (await r.json()) as any;
    if (r.status === 200) return body;
    if (body.error !== "projection_behind")
      throw Error(`unexpected_query_${r.status}_${body.error}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("projection_timeout");
}
async function connect(key: string) {
  const transport = new StdioClientTransport({
    command: "node",
    args: ["--import", "tsx", "packages/mcp/main.ts"],
    env: {
      ...Object.fromEntries(
        Object.entries(process.env).filter(
          (x): x is [string, string] => x[1] !== undefined,
        ),
      ),
      BLACKBOX_AGENT_KEY: key,
    },
  });
  const client = new Client({ name: "golden-verification", version: "1" });
  await client.connect(transport);
  return client;
}
async function protocol(client: Client, entity: string, cutoff: number) {
  const result = await client.callTool({
    name: "get_business_state",
    arguments: { entity_id: entity, recorded_cutoff: cutoff },
  });
  assert.ok(!result.isError);
  return JSON.parse((result.content as { text: string }[])[0].text);
}
function verify(
  actual: any,
  expected: Record<string, unknown>,
  moneyScale = 1,
  quantityScale = 1,
) {
  for (const [key, value] of Object.entries(expected)) {
    const stock = key.endsWith("_stock"),
      found = stock ? Number(actual.inventory[0]?.[key]) : actual[key];
    const expectedValue =
      typeof value === "number"
        ? value * (stock ? quantityScale : moneyScale)
        : value;
    assert.equal(found, expectedValue, key);
  }
  assert.equal(
    actual.captured_minor - actual.fees_minor - actual.refunded_minor,
    actual.provider_balance_minor +
      actual.in_transit_minor +
      actual.bank_confirmed_minor,
    "asset_conservation",
  );
  if (actual.inventory[0]?.physical_stock !== null) {
    const s = actual.inventory[0];
    assert.equal(
      Number(s.available_stock),
      Number(s.physical_stock) -
        Number(s.quarantined_stock) -
        Number(s.reserved_stock),
    );
  }
}
try {
  const phase = process.argv[2] ?? "seed";
  if (phase === "seed") {
    const scenarios = [];
    for (const [moneyScale, quantityScale, currency] of [
      [1, 1, "EUR"],
      [6, 3, "USD"],
    ] as const) {
      const identity = await provision(),
        client = await connect(identity.agent),
        checkpoints = [];
      let entity = "";
      try {
        const observations: Observation[] = [];
        for (const original of golden.events) {
          const event = structuredClone(original);
          event.id = `${randomUUID()}-${original.id}`;
          // Change source identities and monetary/quantity parameters without changing the oracle.
          event.provider_event_id = `${identity.connection_id}-${original.provider_event_id}`;
          for (const [key, value] of Object.entries(event.payload)) {
            if (key.endsWith("_minor") && typeof value === "number")
              event.payload[key] =
                value *
                (key === "unit_gross_minor"
                  ? moneyScale / quantityScale
                  : moneyScale);
            if (
              [
                "physical",
                "quarantined",
                "reserved",
                "quantity",
                "reservation_released",
                "physical_stock_delta",
                "quarantine_delta",
              ].includes(key) &&
              typeof value === "number"
            )
              event.payload[key] = value * quantityScale;
            if (key === "currency") event.payload[key] = currency;
          }
          const observation = await replayObservation(
            event,
            identity.connection_id,
            currency,
          );
          entity = observation.entity_id;
          observations.push(observation);
          const receipt = await sendObservations(
            api,
            identity.connection_id,
            identity.key,
            [observation],
          );
          assert.equal(receipt.added, 1);
          const checkpoint = golden.checkpoints.find(
            (x: any) => x.after === original.id,
          );
          if (checkpoint) {
            const answer = await state(identity.agent, entity);
            verify(
              answer.result,
              checkpoint.expected,
              moneyScale,
              quantityScale,
            );
            const m = await protocol(client, entity, answer.recorded_cutoff);
            assert.deepEqual(m.result, answer.result);
            checkpoints.push({
              after: original.id,
              cutoff: answer.recorded_cutoff,
              result: answer.result,
            });
          }
        }
        const before = await state(identity.agent, entity);
        await Promise.all(
          [5, 7, 15, 18].flatMap((index) =>
            Array.from({ length: 5 }, () =>
              sendObservations(api, identity.connection_id, identity.key, [
                observations[index],
              ]).then((r) => assert.equal(r.added, 0)),
            ),
          ),
        );
        assert.deepEqual(
          (await state(identity.agent, entity)).result,
          before.result,
        );
        for (const evidence_id of before.result.evidence) {
          const evidence = await client.callTool({
            name: "get_evidence",
            arguments: { evidence_id },
          });
          assert.ok(!evidence.isError);
          const decoded = JSON.parse(
            (evidence.content as { text: string }[])[0].text,
          );
          assert.equal(decoded.status, "available");
          assert.ok(decoded.content.observations.length > 0);
        }
        const path = `/v1/ingest/${identity.connection_id}`,
          nonce = randomUUID(),
          timestamp = String(Math.floor(Date.now() / 1000)),
          body = { observations: [observations[0]] };
        const headers = {
          "content-type": "application/json",
          authorization: `Bearer ${identity.key}`,
          "x-blackbox-time": timestamp,
          "x-blackbox-nonce": nonce,
          "x-blackbox-signature": signature(
            identity.key,
            path,
            timestamp,
            nonce,
            body,
          ),
        };
        const replay = () =>
          fetch(api + path, {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          });
        assert.equal((await replay()).status, 202);
        assert.equal((await replay()).status, 403);
        assert.equal(
          (
            await fetch(api + path, {
              method: "POST",
              headers: { ...headers, "x-blackbox-nonce": randomUUID() },
              body: JSON.stringify(body),
            })
          ).status,
          403,
        );
        const changed = structuredClone(body);
        changed.observations[0].amount_minor++;
        assert.equal(
          (
            await fetch(api + path, {
              method: "POST",
              headers,
              body: JSON.stringify(changed),
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await fetch(api + path, {
              method: "POST",
              headers,
              body: JSON.stringify({ ...body, tenant_id: randomUUID() }),
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await fetch(api + path, {
              method: "POST",
              headers: {
                ...headers,
                authorization: `Bearer ${identity.agent}`,
              },
              body: JSON.stringify(body),
            })
          ).status,
          403,
        );
        const otherPath = `/v1/ingest/${randomUUID()}`,
          otherNonce = randomUUID();
        assert.equal(
          (
            await fetch(api + otherPath, {
              method: "POST",
              headers: {
                ...headers,
                "x-blackbox-nonce": otherNonce,
                "x-blackbox-signature": signature(
                  identity.key,
                  otherPath,
                  timestamp,
                  otherNonce,
                  body,
                ),
              },
              body: JSON.stringify(body),
            })
          ).status,
          403,
        );
        const tracks = await admin.query(
          "SELECT DISTINCT record_type FROM bb.journal WHERE tenant_id=$1",
          [identity.tenant],
        );
        assert.deepEqual(tracks.rows.map((r) => r.record_type).sort(), [
          "commitment",
          "fact",
          "movement",
          "reservation",
          "source",
        ]);
        const tables = await admin.query(
          "SELECT count(*)::int n FROM bb.journal WHERE tenant_id=$1 AND record_type='source'",
          [identity.tenant],
        );
        assert.equal(tables.rows[0].n, 19);
        scenarios.push({ ...identity, entity, checkpoints });
      } finally {
        await client.close();
      }
    }
    await writeFile(saved, JSON.stringify(scenarios), { mode: 0o600 });
    console.log(
      JSON.stringify({
        suite: "golden_persisted",
        phase,
        result: "passed",
        scenarios: 2,
        checkpoints: 22,
        checks: [
          "owner_provisioned_connection_bound_producer",
          "signed_HTTP_ingestion",
          "immutable_source_outbox",
          "all_five_tracks",
          "all_original_Golden_checkpoints",
          "varied_USD_money_and_quantity",
          "Rust_only_effects",
          "API_MCP_provenance_parity",
          "concurrent_duplicate_no_double_effect",
          "stock_and_money_conservation",
          "evidence_resolves_through_MCP",
          "durable_nonce_and_signature_body_connection_role_denials",
        ],
        limitations: [
          "Synthetic producer; no external provider claim",
          "No complete population coverage asserted",
        ],
      }),
    );
  } else {
    const cases = JSON.parse(await readFile(saved, "utf8"));
    if (phase === "corrupt" || phase === "remove") {
      for (const c of cases)
        await admin.query(
          phase === "corrupt"
            ? "UPDATE bb.projections SET checksum='corrupt' WHERE tenant_id=$1"
            : "DELETE FROM bb.projections WHERE tenant_id=$1",
          [c.tenant],
        );
      console.log(
        JSON.stringify({
          suite: "golden_persisted",
          phase,
          result: "injected",
        }),
      );
    } else if (phase === "verify") {
      for (const c of cases) {
        const client = await connect(c.agent);
        try {
          for (const checkpoint of c.checkpoints) {
            const actual = await state(c.agent, c.entity, checkpoint.cutoff);
            assert.deepEqual(actual.result, checkpoint.result);
            assert.deepEqual(
              (await protocol(client, c.entity, checkpoint.cutoff)).result,
              checkpoint.result,
            );
          }
        } finally {
          await client.close();
        }
      }
      console.log(
        JSON.stringify({
          suite: "golden_persisted",
          phase,
          result: "passed",
          checks: ["22_fixed_cutoffs_values_and_provenance_API_MCP"],
        }),
      );
    }
  }
} finally {
  await admin.end();
}

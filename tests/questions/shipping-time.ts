import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { newKey, verifier } from "../../packages/auth/index.js";
import { sendObservations } from "../../packages/connectors/replay.js";
import {
  recordKind,
  type RecordObservation,
} from "../../packages/contracts/records.js";
import { intents } from "../../packages/contracts/questions.js";
import { fixture } from "./fixtures.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  base = process.env.BLACKBOX_API_URL!,
  path = process.env.TEST_RUNTIME_DIR + "/question-shipping-time.json";
async function provision() {
  const tenant = randomUUID(),
    key = newKey("agent"),
    producer = newKey("producer"),
    principal = randomUUID(),
    connection = randomUUID();
  await db.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic shipment time adversaries')",
    [tenant],
  );
  await db.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, secret, p] of [
    ["agent", key, randomUUID()],
    ["producer", producer, principal],
  ])
    await db.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Synthetic')",
      [tenant, randomUUID(), p, purpose, verifier(secret)],
    );
  await db.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'generic',$3,$4)",
    [
      tenant,
      connection,
      randomUUID(),
      JSON.stringify({ producer_principal_id: principal }),
    ],
  );
  return { tenant, key, producer, connection };
}
async function call(key: string, request: any) {
  for (let n = 0; n < 100; n++) {
    const r = await fetch(base + "/v1/tools/query_business", {
      method: "POST",
      headers: {
        authorization: "Bearer " + key,
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });
    const answer = (await r.json()) as any;
    if (r.ok) return answer;
    assert.equal(answer.error, "projection_behind");
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("projection_timeout");
}
async function mcp(key: string, request: any) {
  const client = new Client({
    name: "shipping-time-adversaries",
    version: "1",
  });
  await client.connect(
    new StdioClientTransport({
      command: "node",
      args: ["--import", "tsx", "packages/mcp/main.ts"],
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            (p): p is [string, string] => p[1] !== undefined,
          ),
        ),
        BLACKBOX_AGENT_KEY: key,
      },
    }),
  );
  try {
    const result = await client.callTool({
      name: "query_business",
      arguments: request,
    });
    assert.ok(!result.isError);
    return JSON.parse((result.content as { text: string }[])[0].text);
  } finally {
    await client.close();
  }
}
const normalized = (x: any) => {
  const { applied_cursor, read_path, ...rest } = x;
  return rest;
};
const kinds = [
  "future_handover",
  "future_delivery",
  "unknown_earlier_handover",
  "future_tracking",
  "partial_plan",
  "missing_handover",
  "future_invoice",
  "future_cancellation",
  "future_promise",
  "conflicting_milestones",
  "missing_delivery",
] as const;
try {
  const phase = process.argv[2] ?? "seed";
  if (phase === "seed") {
    const results = [];
    for (const kind of kinds) {
      const index = {
        future_handover: 6,
        future_delivery: 6,
        unknown_earlier_handover: 6,
        future_tracking: 4,
        partial_plan: 1,
        missing_handover: 2,
        future_invoice: 9,
        future_cancellation: 22,
        future_promise: 5,
        conflicting_milestones: 6,
        missing_delivery: 6,
      }[kind];
      const sample = fixture(index),
        identity = await provision();
      const record = (dataset: string) =>
        sample.records.find((r) => r.record.dataset === dataset)!.record as any;
      const shipments = sample.records
        .filter((r) => r.record.dataset === "fulfillments")
        .map((r) => r.record as any);
      const delivered = shipments.find((s) => s.state === "delivered");
      const add = (data: any) =>
        sample.records.push({
          id: randomUUID(),
          entity_id: sample.id("order"),
          economic_id: randomUUID(),
          kind: recordKind(data),
          record: data,
          occurred_at: "2026-10-31T09:00:00Z",
          test: true,
        });
      const handover = (at: string) => ({
        dataset: "fulfillments",
        order_id: sample.id("order"),
        state: "handed_over",
        handover_at: at,
        lines: [
          { line_id: sample.id("order-line"), quantity: "3", unit: "piece" },
        ],
      });
      if (kind === "future_handover")
        shipments[0].handover_at = "2026-10-31T10:00:00.001Z";
      if (kind === "future_delivery" || kind === "unknown_earlier_handover") {
        delivered.delivered_at = "2026-10-31T11:00:00Z";
        if (kind === "future_delivery")
          delivered.handover_at = "2026-10-31T09:30:00Z";
      }
      if (kind === "future_tracking")
        add({
          ...record("tracking"),
          status: "delivered",
          scan_at: "2026-10-31T10:00:00.001Z",
        });
      if (kind === "partial_plan") add(handover("2026-10-31T09:00:00Z"));
      if (kind === "missing_handover") delete shipments[0].handover_at;
      if (kind === "future_invoice")
        shipments[0].handover_at = "2026-10-31T11:00:00Z";
      if (kind === "future_cancellation") add(handover("2026-10-31T11:00:00Z"));
      if (kind === "future_promise")
        Object.assign(shipments[0], {
          state: "delivered",
          handover_at: "2026-10-31T09:00:00Z",
          delivered_at: "2026-10-31T11:00:00Z",
        });
      if (kind === "conflicting_milestones")
        delivered.handover_at = "2026-10-31T11:00:00Z";
      if (kind === "missing_delivery") delete delivered.delivered_at;
      await sendObservations(
        base,
        identity.connection,
        identity.producer,
        sample.records,
      );
      const request = { intent: intents[index], ...sample.parameters },
        answer = await call(identity.key, request),
        rows = answer.result?.rows;
      if (kind === "future_handover") {
        assert.equal(rows[0].remaining_to_dispatch, "5");
        assert.equal(rows[0].remaining_to_deliver, "5");
      }
      if (kind === "future_delivery") {
        assert.equal(rows[0].remaining_to_dispatch, "3");
        assert.equal(rows[0].remaining_to_deliver, "8");
      }
      if (
        [
          "unknown_earlier_handover",
          "missing_handover",
          "missing_delivery",
        ].includes(kind)
      ) {
        assert.equal(answer.status, "insufficient_data");
        assert.equal(answer.result, null);
        assert.ok(
          answer.missing_inputs.includes(
            kind === "missing_delivery"
              ? "fulfillments.delivery_confirmation"
              : "fulfillments.handover_confirmation",
          ),
        );
      }
      if (kind === "future_tracking") {
        assert.equal(rows[0].status, "exception");
        assert.equal(rows[0].attention, true);
        assert.equal(rows[0].latest_scan_age_seconds, 3600);
      }
      if (kind === "partial_plan") {
        assert.equal(
          rows.find((r: any) => r.id === sample.id("order")).lines[0].required,
          "3",
        );
        assert.equal(
          rows.find((r: any) => r.id === sample.id("second-order")).lines[0]
            .required,
          "6",
        );
        assert.ok(rows.every((r: any) => r.state === "fully_fulfillable"));
      }
      if (kind === "future_invoice") assert.deepEqual(rows, []);
      if (kind === "future_cancellation") {
        assert.equal(rows[0].stock_receipt_required, false);
        assert.ok(!rows[0].remaining_steps.includes("verify_return_receipt"));
      }
      if (kind === "future_promise") {
        assert.equal(rows[0].delivered, false);
        assert.equal(rows[0].overdue, true);
      }
      if (kind === "conflicting_milestones") {
        assert.equal(answer.status, "conflict");
        assert.ok(
          answer.conflicts.includes("fulfillment_milestone_order_conflict"),
        );
      }
      const frozen = { ...request, recorded_cutoff: answer.recorded_cutoff };
      assert.deepEqual(
        normalized(await mcp(identity.key, frozen)),
        normalized(answer),
      );
      results.push({
        ...identity,
        request: frozen,
        expected: normalized(answer),
        kind,
      });
    }
    await writeFile(path, JSON.stringify(results), { mode: 0o600 });
  } else if (phase === "corrupt" || phase === "remove") {
    for (const test of JSON.parse(await readFile(path, "utf8")))
      await db.query(
        phase === "corrupt"
          ? "UPDATE bb.current_records SET checksum='injected_corruption' WHERE tenant_id=$1"
          : "DELETE FROM bb.current_records WHERE tenant_id=$1",
        [test.tenant],
      );
  } else {
    const saved = JSON.parse(await readFile(path, "utf8"));
    for (const test of saved) {
      assert.deepEqual(
        normalized(await call(test.key, test.request)),
        test.expected,
      );
      assert.deepEqual(
        normalized(await mcp(test.key, test.request)),
        test.expected,
      );
    }
  }
  console.log(
    JSON.stringify({
      suite: "shipment_time_and_planning_adversaries",
      phase,
      result: ["corrupt", "remove"].includes(phase) ? "injected" : "passed",
      cases: kinds.length,
      checks: kinds,
      limitations: ["Synthetic generic producer, no live provider coverage"],
    }),
  );
} finally {
  await db.end();
}

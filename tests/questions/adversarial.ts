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
  path = process.env.TEST_RUNTIME_DIR + "/question-adversarial.json";
async function provision() {
  const tenant = randomUUID(),
    key = newKey("agent"),
    producer = newKey("producer"),
    principal = randomUUID(),
    connection = randomUUID();
  await db.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic scope adversaries')",
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
  const client = new Client({ name: "scope-adversaries", version: "1" });
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
try {
  const phase = process.argv[2] ?? "seed";
  if (phase === "seed") {
    const results = [];
    for (const kind of [
      "shared_capture_credits",
      "cancelled_unrelated_receipt",
      "unknown_refund_population",
      "invalid_dispute_reversal",
      "invalid_hold_release",
    ]) {
      const index = {
          shared_capture_credits: 21,
          cancelled_unrelated_receipt: 22,
          unknown_refund_population: 20,
          invalid_dispute_reversal: 23,
          invalid_hold_release: 19,
        }[kind]!,
        sample = fixture(index),
        identity = await provision();
      const add = (record: any) =>
        sample.records.push({
          id: randomUUID(),
          entity_id: sample.id("order"),
          economic_id: randomUUID(),
          kind: recordKind(record),
          record,
          occurred_at: "2026-10-31T09:00:00Z",
          test: true,
        });
      const rec = (dataset: string) =>
        sample.records.find((r) => r.record.dataset === dataset)!.record as any;
      if (
        kind === "shared_capture_credits" ||
        kind === "cancelled_unrelated_receipt"
      ) {
        add({
          ...rec("entitlements"),
          credit_id: randomUUID(),
          amount_minor: 1190,
        });
        add({
          dataset: "refunds",
          order_id: sample.id("order"),
          original_transaction_id: sample.id("payment"),
          amount_minor: 2380,
          currency: "EUR",
          status: "completed",
          destination: "cash",
          economic_effect_id: randomUUID(),
        });
      }
      if (kind === "cancelled_unrelated_receipt") {
        rec("allocations").quantity = "0";
        add({
          dataset: "fulfillments",
          order_id: sample.id("order"),
          state: "handed_over",
          lines: [
            { line_id: sample.id("order-line"), quantity: "2", unit: "piece" },
          ],
          handover_at: "2026-10-31T09:00:00Z",
        });
        add({
          dataset: "receipts",
          return_id: randomUUID(),
          line_id: randomUUID(),
          location_id: sample.id("location"),
          quantity: "2",
          unit: "piece",
          disposition: "quarantined",
        });
      }
      if (kind === "unknown_refund_population") {
        const c = sample.records.find(
          (r) =>
            r.record.dataset === "coverage" &&
            (r.record as any).capability === "refunds",
        )!.record as any;
        c.backfill_complete = false;
        c.failure_state = "incomplete";
      }
      if (kind === "invalid_dispute_reversal")
        rec("disputes").reversal_minor = 10001;
      if (kind === "invalid_hold_release") rec("holds").released_minor = 10000;
      await sendObservations(
        base,
        identity.connection,
        identity.producer,
        sample.records,
      );
      const request = { intent: intents[index], ...sample.parameters },
        answer = await call(identity.key, request),
        row = answer.result.rows[0];
      if (kind === "shared_capture_credits") {
        assert.equal(answer.result.rows.length, 1);
        assert.equal(row.cash_refund_due_minor, 1190);
        assert.equal(row.entitlement_ids.length, 2);
      }
      if (kind === "cancelled_unrelated_receipt") {
        assert.ok(row.remaining_steps.includes("refund_payment"));
        assert.ok(row.remaining_steps.includes("verify_return_receipt"));
        assert.ok(!row.remaining_steps.includes("release_reservation"));
        assert.equal(row.stock_receipt_required, true);
      }
      if (kind === "unknown_refund_population") {
        assert.equal(row.cash_refund_confirmed, null);
        assert.ok(answer.missing_inputs.includes("refunds.coverage"));
      }
      if (kind === "invalid_dispute_reversal") {
        assert.equal(answer.status, "conflict");
        assert.equal(row.net_customer_repayments_minor, null);
        assert.equal(row.excess_minor, null);
      }
      if (kind === "invalid_hold_release") {
        assert.equal(answer.status, "conflict");
        assert.equal(row.held_minor, null);
      }
      const fixed = { ...request, recorded_cutoff: answer.recorded_cutoff };
      assert.deepEqual(
        normalized(await mcp(identity.key, fixed)),
        normalized(answer),
      );
      results.push({
        ...identity,
        request: fixed,
        expected: normalized(answer),
        kind,
      });
    }
    await writeFile(path, JSON.stringify(results), { mode: 0o600 });
  } else if (phase === "corrupt" || phase === "remove") {
    for (const test of JSON.parse(await readFile(path, "utf8"))) {
      await db.query(
        phase === "corrupt"
          ? "UPDATE bb.current_records SET checksum='injected_corruption' WHERE tenant_id=$1"
          : "DELETE FROM bb.current_records WHERE tenant_id=$1",
        [test.tenant],
      );
    }
  } else {
    for (const test of JSON.parse(await readFile(path, "utf8"))) {
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
      suite: "settlement_scope_adversaries",
      phase,
      result: ["corrupt", "remove"].includes(phase) ? "injected" : "passed",
      cases: 5,
      checks: [
        "shared_capture_refund_subtracted_once",
        "unrelated_receipt_cannot_close_cancellation",
        "zero_quantity_reservation_not_active_stock",
        "unknown_refund_coverage_not_false",
        "impossible_reversal_and_release_conflict",
        "persisted_API_MCP_parity",
      ],
    }),
  );
} finally {
  await db.end();
}

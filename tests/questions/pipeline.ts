import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import pg from "pg";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { newKey, verifier } from "../../packages/auth/index.js";
import { sendObservations } from "../../packages/connectors/replay.js";
import { intents } from "../../packages/contracts/questions.js";
import { fixture } from "./fixtures.js";
const admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL }),
  api = process.env.BLACKBOX_API_URL!;
const path = `${process.env.TEST_RUNTIME_DIR}/question-cases.json`;
async function provision() {
  const tenant = randomUUID(),
    key = newKey("agent"),
    producer = newKey("producer"),
    principal = randomUUID(),
    connection = randomUUID();
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic question contract')",
    [tenant],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, secret, p] of [
    ["agent", key, randomUUID()],
    ["producer", producer, principal],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Synthetic')",
      [tenant, randomUUID(), p, purpose, verifier(secret)],
    );
  await admin.query(
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
async function call(key: string, body: any) {
  for (let n = 0; n < 100; n++) {
    const r = await fetch(api + "/v1/tools/query_business", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
    });
    const result = (await r.json()) as any;
    if (r.status === 200) return result;
    if (result.error !== "projection_behind")
      throw Error(`query_${r.status}_${result.error}`);
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("projection_timeout");
}
async function protocol(key: string, body: any, expectError = false) {
  const client = new Client({ name: "question-contract-tests", version: "1" });
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
  await client.connect(transport);
  try {
    const r = await client.callTool({
      name: "query_business",
      arguments: body,
    });
    if (expectError) {
      assert.ok(r.isError);
      return r;
    }
    assert.ok(!r.isError, JSON.stringify(r));
    return JSON.parse((r.content as { text: string }[])[0].text);
  } finally {
    await client.close();
  }
}
function normalize(answer: any) {
  const { read_path, applied_cursor, ...business } = answer;
  return business;
}
try {
  const phase = process.argv[2] ?? "seed";
  if (phase === "seed") {
    const cases = [];
    for (let index = 0; index < intents.length; index++)
      for (const missing of [false, true]) {
        const sample = fixture(index, missing),
          identity = await provision();
        await sendObservations(
          api,
          identity.connection,
          identity.producer,
          sample.records,
        );
        const request = { intent: intents[index], ...sample.parameters };
        const answer = await call(identity.key, request);
        if (missing) {
          assert.ok(
            ["insufficient_data", "partial"].includes(answer.status),
            intents[index],
          );
          assert.ok(
            answer.missing_inputs.some(
              (gap: string) =>
                gap === sample.gap ||
                gap.startsWith(sample.gap.split(".")[0] + "."),
            ),
            JSON.stringify(answer),
          );
          if (answer.status === "insufficient_data")
            assert.equal(answer.result, null);
        } else {
          assert.equal(answer.missing_inputs.length, 0, JSON.stringify(answer));
          assert.equal(answer.conflicts.length, 0, JSON.stringify(answer));
          assert.notEqual(answer.result, null, JSON.stringify(answer));
          sample.verify(answer.result.rows);
          assert.equal(answer.coverage.independently_verified, false);
        }
        const frozen = { ...request, recorded_cutoff: answer.recorded_cutoff };
        const mcp = await protocol(identity.key, frozen);
        assert.deepEqual(normalize(mcp), normalize(answer));
        cases.push({
          ...identity,
          request: frozen,
          expected: normalize(answer),
          missing,
          index,
        });
        if (!missing) {
          const source = await admin.query(
            "SELECT entry_id,payload->>'id' AS id FROM bb.journal WHERE tenant_id=$1 AND record_type='source'",
            [identity.tenant],
          );
          const entries = new Map(source.rows.map((r) => [r.id, r.entry_id]));
          const quantityFields = new Set([
            "quantity",
            "cancelled_quantity",
            "physical",
            "available",
            "committed",
            "reserved",
            "damaged",
            "safety_stock",
            "quality_control",
            "incoming",
          ]);
          function vary(value: any, key = ""): any {
            if (Array.isArray(value)) return value.map((x) => vary(x));
            if (value && typeof value === "object")
              return Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, vary(v, k)]),
              );
            if (typeof value === "number" && key.endsWith("_minor"))
              return value * 3;
            if (typeof value === "string" && quantityFields.has(key))
              return String(Number(value) / 2);
            if (key === "currency") return "USD";
            if (key === "unit") return "kg";
            return value;
          }
          const amended = sample.records.map((e) => ({
            ...e,
            id: randomUUID(),
            occurred_at: "2026-10-31T09:30:00Z",
            supersedes_entry_id: entries.get(e.id),
            record: vary(e.record),
          }));
          await sendObservations(
            api,
            identity.connection,
            identity.producer,
            amended,
          );
          const variedRequest = {
            ...request,
            ...(request.requested_quantity
              ? {
                  requested_quantity: String(
                    Number(request.requested_quantity) / 2,
                  ),
                }
              : {}),
            ...(request.unit ? { unit: "kg" } : {}),
          };
          const varied = await call(identity.key, variedRequest);
          assert.equal(varied.missing_inputs.length, 0, JSON.stringify(varied));
          assert.equal(varied.conflicts.length, 0, JSON.stringify(varied));
          const outputQuantities = new Set([
            "available",
            "requested",
            "shortfall",
            "required",
            "allocated",
            "from_owned_reservation",
            "from_free_stock",
            "remaining_obligation",
            "active_reserved",
            "under_reserved",
            "over_reserved",
            "remaining_to_dispatch",
            "remaining_to_deliver",
            "requested_quantity",
            "received_quantity",
            "quarantined_quantity",
            "sellable_added",
          ]);
          function originalUnits(value: any, key = ""): any {
            if (Array.isArray(value)) return value.map((x) => originalUnits(x));
            if (value && typeof value === "object")
              return Object.fromEntries(
                Object.entries(value).map(([k, v]) => [k, originalUnits(v, k)]),
              );
            if (typeof value === "number" && key.endsWith("_minor"))
              return value / 3;
            if (typeof value === "string" && outputQuantities.has(key))
              return String(Number(value) * 2);
            return value;
          }
          sample.verify(originalUnits(varied.result.rows));
          assert.deepEqual(
            normalize(await call(identity.key, frozen)),
            normalize(answer),
            "original recorded cutoff after correction",
          );
          const variedFrozen = {
            ...variedRequest,
            recorded_cutoff: varied.recorded_cutoff,
          };
          assert.deepEqual(
            normalize(await protocol(identity.key, variedFrozen)),
            normalize(varied),
          );
          await Promise.all([
            sendObservations(
              api,
              identity.connection,
              identity.producer,
              amended,
            ),
            sendObservations(
              api,
              identity.connection,
              identity.producer,
              amended,
            ),
          ]).then((receipts) =>
            receipts.forEach((r) => assert.equal(r.added, 0)),
          );
          const old = sample.records.map((e) => ({
            ...e,
            id: randomUUID(),
            occurred_at: "2026-10-31T08:30:00Z",
          }));
          await sendObservations(
            api,
            identity.connection,
            identity.producer,
            old,
          );
          const afterOld = await call(identity.key, variedRequest);
          assert.deepEqual(
            afterOld.result,
            varied.result,
            "late older source snapshot cannot regress state",
          );
          assert.deepEqual(
            afterOld.evidence,
            varied.evidence,
            "late older source remains historical evidence",
          );
          cases.push({
            ...identity,
            request: variedFrozen,
            expected: normalize(varied),
            missing: false,
            index,
            variant: "USD_fractional_kg_late_correction",
          });
          // Every result is paginated at the same fixed cutoff and authenticated scope.
          const pagedRequest = { ...variedFrozen, limit: 1 };
          let page = await call(identity.key, pagedRequest),
            gathered = [...page.result.rows];
          while (page.next_cursor) {
            page = await call(identity.key, {
              ...pagedRequest,
              cursor: page.next_cursor,
            });
            gathered.push(...page.result.rows);
          }
          assert.deepEqual(gathered, varied.result.rows);
        }
        console.log(
          JSON.stringify({
            intent: intents[index],
            case: missing ? "missing" : "positive",
            result: "passed",
            rows: answer.result?.rows.length ?? 0,
          }),
        );
      }
    await writeFile(path, JSON.stringify(cases), { mode: 0o600 });
    console.log(
      JSON.stringify({
        suite: "all_24_structured_questions",
        phase,
        result: "passed",
        positive: 24,
        changed_money_fractional_quantity_late_correction: 24,
        missing: 24,
        checks: [
          "signed_HTTP_typed_records",
          "PostgreSQL_journal_outbox",
          "Rust_record_projection_and_intent_calculation",
          "API_SDK_MCP_parity",
          "declared_coverage_never_presented_as_independent_verification",
        ],
      }),
    );
  } else {
    const cases = JSON.parse(await readFile(path, "utf8"));
    if (["corrupt", "remove"].includes(phase)) {
      for (const c of cases)
        await admin.query(
          phase === "corrupt"
            ? "UPDATE bb.current_records SET checksum='corrupt' WHERE tenant_id=$1"
            : "DELETE FROM bb.current_records WHERE tenant_id=$1",
          [c.tenant],
        );
      console.log(JSON.stringify({ phase, result: "injected" }));
    } else if (phase === "security") {
      const selected = cases.filter((c: any) => !c.missing && !c.variant);
      for (let i = 0; i < selected.length; i++) {
        const c = selected[i],
          other = selected[(i + 1) % selected.length];
        const raw = async (key: string, tool: string, body: any) =>
          fetch(api + "/v1/tools/" + tool, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(body),
          });
        const denied = await raw(other.key, "get_evidence", {
          evidence_id: c.expected.evidence[0],
        });
        assert.equal(((await denied.json()) as any).status, "unavailable");
        assert.equal(
          (
            await raw(other.key, "query_business", {
              ...c.request,
              tenant_id: c.tenant,
            })
          ).status,
          400,
        );
        const key = newKey("agent"),
          credential = randomUUID();
        await admin.query(
          "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,'agent',$4,'Revocation check')",
          [c.tenant, credential, randomUUID(), verifier(key)],
        );
        assert.deepEqual(normalize(await call(key, c.request)), c.expected);
        await admin.query(
          "UPDATE bb.credentials SET revoked_at=now() WHERE tenant_id=$1 AND credential_id=$2",
          [c.tenant, credential],
        );
        assert.equal((await raw(key, "query_business", c.request)).status, 401);
        await protocol(key, c.request, true);
        const scoped = await call(c.key, { ...c.request, limit: 1 });
        if (scoped.next_cursor) {
          assert.equal(
            (
              await raw(other.key, "query_business", {
                ...c.request,
                limit: 1,
                cursor: scoped.next_cursor,
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await raw(c.key, "query_business", {
                ...c.request,
                limit: 1,
                cursor: scoped.next_cursor + "x",
              })
            ).status,
            400,
          );
        }
      }
      console.log(
        JSON.stringify({
          suite: "all_24_structured_questions",
          phase,
          result: "passed",
          checks: [
            "all_24_cross_tenant_evidence_denial",
            "caller_tenant_rejected",
            "warmed_then_revoked_API_MCP_denial",
            "principal_workspace_bound_cursor",
          ],
        }),
      );
    } else if (phase === "verify") {
      for (const c of cases) {
        assert.deepEqual(normalize(await call(c.key, c.request)), c.expected);
        assert.deepEqual(
          normalize(await protocol(c.key, c.request)),
          c.expected,
        );
      }
      console.log(
        JSON.stringify({
          suite: "all_24_structured_questions",
          phase,
          result: "passed",
          checks: ["72_fixed_cutoffs_values_coverage_evidence_API_MCP"],
        }),
      );
    }
  }
} finally {
  await admin.end();
}

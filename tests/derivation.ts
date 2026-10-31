// Persisted adversaries. All data is synthetic; no journal rows are edited/deleted.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import pg from "pg";
import { pool } from "../packages/database/index.js";
import { readEvidence } from "../packages/application/evidence.js";
import { chromium } from "@playwright/test";
import { ingest } from "../packages/application/ingest.js";
import { newKey, verifier } from "../packages/auth/index.js";
import { runtimeFingerprint } from "../packages/runtime/compatibility.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fixture } from "./questions/fixtures.js";
const db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const internal = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8");
const base = process.env.BLACKBOX_API_URL!;
const path = "work/derivation-fixture.json";
const phase = process.argv[2] ?? "seed";
const event = (entity: string, extra: any = {}) => ({
  id: randomUUID(),
  entity_id: entity,
  kind: "payment.captured",
  amount_minor: 1234,
  currency: "EUR",
  economic_id: randomUUID(),
  occurred_at: "2026-10-31T09:00:00Z",
  test: true,
  ...extra,
});
async function provision() {
  const tenant = randomUUID(),
    connection = randomUUID(),
    entity = randomUUID(),
    owner = newKey("owner"),
    agent = newKey("agent");
  await db.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Synthetic derivation review')",
    [tenant],
  );
  await db.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  await db.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor)VALUES($1,$2,'generic',$3)",
    [tenant, connection, randomUUID()],
  );
  for (const [purpose, key] of [
    ["owner", owner],
    ["agent", agent],
  ])
    await db.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Synthetic reader')",
      [tenant, randomUUID(), randomUUID(), purpose, verifier(key)],
    );
  return { tenant, connection, entity, owner, agent };
}
async function login(s: any) {
  const r = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key: s.owner }),
  });
  assert.equal(r.status, 200);
  const value = await r.json();
  return {
    ...s,
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie: r.headers.getSetCookie()[0].split(";")[0],
      "x-blackbox-csrf": value.csrf,
    },
  };
}
async function call(s: any, route: string, body?: any, status = 200) {
  const r = await fetch(base + route, {
    method: body === undefined ? "GET" : "POST",
    headers: s.headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const v: any = await r.json();
  assert.equal(r.status, status, JSON.stringify(v));
  return v;
}
async function engine(s: any, status = 200) {
  const r = await fetch(process.env.ENGINE_URL + "/v1/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-blackbox-contract": runtimeFingerprint,
      "x-blackbox-internal": internal,
    },
    body: JSON.stringify({ tenant_id: s.tenant }),
  });
  const value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  return value;
}
async function state(s: any, status = 200) {
  const r = await fetch(base + "/v1/tools/get_business_state", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer " + s.agent,
    },
    body: JSON.stringify({ entity_id: s.entity }),
  });
  const value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  return value;
}
async function digest(s: any, sourceOnly = false) {
  const rows = (
    await db.query(
      "SELECT to_jsonb(j) AS row FROM bb.journal j WHERE tenant_id=$1 AND ($2=false OR record_type='source') ORDER BY sequence",
      [s.tenant, sourceOnly],
    )
  ).rows;
  return createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}
async function until(fn: () => Promise<any>) {
  for (let i = 0; i < 100; i++) {
    const v = await fn();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error("derivation_test_deadline");
}
async function row(s: any) {
  return (
    await db.query(
      "SELECT * FROM bb.outbox WHERE tenant_id=$1 ORDER BY sequence LIMIT 1",
      [s.tenant],
    )
  ).rows[0];
}
async function review(s: any) {
  return (
    await db.query(
      "SELECT * FROM bb.review_cases WHERE tenant_id=$1 AND kind='derivation_failed'",
      [s.tenant],
    )
  ).rows[0];
}
async function decision(s: any, id: string) {
  const d = await call(s, "/v1/reviews/" + id);
  return {
    command_id: randomUUID(),
    revision: d.revision,
    action: "retry",
    reason_code: "retry_mapping",
    note: "Synthetic service recovery verified; retry the exact accepted input.",
    evidence_ids: [d.original_evidence_id],
    expected_entry_id: d.entry_id,
    acknowledged: true,
  };
}
async function raw(s: any, observation: any, alreadyApplied = false) {
  // Simulate a previously accepted unsupported kind with a real evidence envelope.
  const r = await ingest(s.tenant, s.connection, [], {
    synthetic: "unsupported durable input",
    observation,
  });
  const entry = randomUUID();
  await db.query(
    "INSERT INTO bb.journal(tenant_id,sequence,entry_id,record_type,record_id,event_type,schema_version,connection_id,entity_id,provider_identity,occurred_at,payload,payload_hash,evidence_id,rule_version,correlation_id)VALUES($1,1,$2,'source',$3,$4,1,$5,$6,$7,$8,$9,$10,$11,'source-v1',$12)",
    [
      s.tenant,
      entry,
      observation.economic_id,
      observation.kind,
      s.connection,
      s.entity,
      observation.id,
      observation.occurred_at,
      observation,
      createHash("sha256").update(JSON.stringify(observation)).digest("hex"),
      r.evidence_id,
      randomUUID(),
    ],
  );
  await db.query(
    "INSERT INTO bb.outbox(tenant_id,sequence,entity_id,state)VALUES($1,1,$2,$3)",
    [s.tenant, s.entity, alreadyApplied ? "applied" : "pending"],
  );
  await db.query(
    "UPDATE bb.heads SET committed=1,applied=$2 WHERE tenant_id=$1",
    [s.tenant, alreadyApplied ? 1 : 0],
  );
  return entry;
}
async function mcp(s: any, failed: boolean) {
  const client = new Client({
    name: "derivation-recovery-proof",
    version: "1",
  });
  try {
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--import", "tsx", "packages/mcp/main.ts"],
        env: { ...process.env, BLACKBOX_AGENT_KEY: s.agent } as Record<
          string,
          string
        >,
        stderr: "pipe",
      }),
    );
    const answer: any = await client.callTool({
      name: "get_business_state",
      arguments: { entity_id: s.entity },
    });
    assert.equal(answer.isError === true, failed);
    if (!failed)
      assert.equal(
        JSON.parse(answer.content[0].text).result.captured_minor,
        1234,
      );
  } finally {
    await client.close();
  }
}
async function workerFailure(tenant: string) {
  // Exercise the real failure handler as bb_worker. Synthetic repeated outage
  // attempts advance only the retry schedule, never journal data or the clock.
  await new Promise<void>((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [
        "--import",
        "tsx",
        "--input-type=module",
        "-e",
        `import {recordDerivationFailure} from './packages/application/derivation.ts';import {pool} from './packages/database/index.ts';try { await recordDerivationFailure(process.argv[1]); }finally{await pool.end();}`,
        tenant,
      ],
      {
        env: { ...process.env, DATABASE_URL: process.env.WORKER_DATABASE_URL },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let out = "";
    p.stderr.on("data", (c) => (out += c));
    p.on("exit", (n) => (n === 0 ? resolve() : reject(Error(out))));
    p.on("error", reject);
  });
}
try {
  if (phase === "seed") {
    const poison = await login(await provision()),
      good = await login(await provision()),
      legacy = await login(await provision()),
      unknownDataset = await login(await provision());
    const bad = event(poison.entity, { kind: "future.money_settled" });
    await raw(poison, bad);
    const before = await digest(poison);
    const failure = await engine(poison, 503);
    assert.equal(failure.error, "unsupported_event");
    assert.equal(await digest(poison), before);
    // Actual running worker quarantines once; the independent workspace still applies.
    await ingest(good.tenant, good.connection, [event(good.entity)], {
      synthetic: true,
    });
    await until(async () => (await row(poison))?.state === "quarantined");
    await until(async () => (await row(good))?.state === "applied");
    assert.equal((await row(poison)).attempts, 1);
    assert.equal((await state(good)).result.captured_minor, 1234);
    assert.equal(
      Number(
        (
          await db.query("SELECT applied FROM bb.heads WHERE tenant_id=$1", [
            poison.tenant,
          ])
        ).rows[0].applied,
      ),
      0,
    );
    await state(poison, 503);
    await mcp(poison, true);
    await mcp(good, false);
    const id = (await review(poison)).case_id;
    // Owner-only scope, CSRF and exact input identity; no repair can relabel money.
    await call(good, "/v1/reviews/" + id, undefined, 404);
    const denied = await fetch(base + "/v1/reviews/" + id, {
      headers: { authorization: "Bearer " + poison.agent },
    });
    assert.equal(denied.status, 403);
    const command = await decision(poison, id);
    await call(
      {
        ...poison,
        headers: { ...poison.headers, "x-blackbox-csrf": "invalid" },
      },
      "/v1/reviews/" + id + "/decisions",
      command,
      403,
    );
    await call(
      poison,
      "/v1/reviews/" + id + "/decisions",
      { ...command, expected_entry_id: randomUUID() },
      409,
    );
    for (let n = 0; n < 3; n++) {
      const body = await decision(poison, id);
      const receipt = await call(
        poison,
        "/v1/reviews/" + id + "/decisions",
        body,
      );
      assert.equal(receipt.state, "recalculating");
      const again = await call(
        poison,
        "/v1/reviews/" + id + "/decisions",
        body,
      );
      assert.equal(again.idempotent, true);
      await until(async () => (await row(poison)).state === "quarantined");
      assert.equal((await review(poison)).retry_count, n + 1);
    }
    await call(
      poison,
      "/v1/reviews/" + id + "/decisions",
      await decision(poison, id),
      409,
    );
    assert.equal(await digest(poison), before);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::integer n FROM bb.review_decisions WHERE tenant_id=$1",
          [poison.tenant],
        )
      ).rows[0].n,
      3,
    );
    // Pre-reader applied state cannot hide an unknown kind/dataset, even with a
    // valid projection checksum and a misleading prior ready cursor.
    await raw(
      legacy,
      event(legacy.entity, { kind: "future.money_settled" }),
      true,
    );
    const valid = (await state(good)).result;
    await db.query(
      "INSERT INTO bb.projections(tenant_id,entity_id,applied,rule_version,state,checksum)VALUES($1,$2,1,'lifecycle-v3',$3,$4)",
      [
        legacy.tenant,
        legacy.entity,
        valid,
        createHash("sha256").update(JSON.stringify(valid)).digest("hex"),
      ],
    );
    assert.equal((await state(legacy, 503)).error, "unsupported_event");
    await raw(
      unknownDataset,
      event(unknownDataset.entity, {
        record: { dataset: "future_money", status: "captured" },
      }),
      true,
    );
    assert.equal(
      (
        await call(
          unknownDataset,
          "/v1/tools/query_business",
          { intent: "orders.payment_state", entity_id: unknownDataset.entity },
          503,
        )
      ).error,
      "unsupported_event",
    );
    // Current database rejects a future schema before acceptance; both SQL admission
    // and Rust reader also explicitly reject it (Rust adversary is a separate unit).
    assert.equal(
      (
        await db.query(
          "SELECT bb.input_header_supported_v2(2,$1,$2,$3) supported",
          [bad.kind, poison.entity, bad],
        )
      ).rows[0].supported,
      false,
    );
    for (let n = 0; n < 24; n++)
      for (const ob of fixture(n).records)
        assert.equal(
          (
            await db.query(
              "SELECT bb.input_header_supported_v2(1,$1,$2,$3) supported",
              [ob.kind, ob.entity_id, ob],
            )
          ).rows[0].supported,
          true,
        );
    await writeFile(
      path,
      JSON.stringify({ poison, good, legacy, unknownDataset, before }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        checks: [
          "unknown_kind_actual_worker_quarantine_without_derived_facts",
          "unapplied_gap_blocks_API_SDK_MCP_and_other_workspace_progresses",
          "owner_scope_CSRF_exact_identity_idempotency_three_retry_budget",
          "prior_projection_unknown_kind_and_unknown_dataset_fail_closed",
          "all24_fixture_headers_admitted_future_version_rejected",
        ],
      }),
    );
  } else if (phase === "prepare-retry") {
    const f = JSON.parse(await readFile(path, "utf8"));
    const recover = await login(await provision());
    await ingest(recover.tenant, recover.connection, [event(recover.entity)], {
      synthetic: true,
    });
    const source = await digest(recover, true);
    for (let n = 0; n < 8; n++) {
      await db.query("UPDATE bb.outbox SET next_at=now() WHERE tenant_id=$1", [
        recover.tenant,
      ]);
      await workerFailure(recover.tenant);
      assert.equal((await row(recover)).attempts, n + 1);
    }
    assert.equal((await row(recover)).state, "quarantined");
    assert.equal((await row(recover)).error_code, "derivation_retry_exhausted");
    await workerFailure(recover.tenant);
    assert.equal((await row(recover)).attempts, 8);
    await state(recover, 503);
    const item = await review(recover),
      id = item.case_id;
    await db.query(
      "INSERT INTO bb.evidence_restrictions(tenant_id,evidence_id,restriction_id,principal_id,reason)SELECT tenant_id,$2,$3,principal_id,'expired' FROM bb.credentials WHERE tenant_id=$1 AND purpose='owner'",
      [recover.tenant, item.evidence_id, randomUUID()],
    );
    assert.equal(await readEvidence(recover.tenant, item.evidence_id), null);
    const receipt = await call(
      recover,
      "/v1/reviews/" + id + "/decisions",
      await decision(recover, id),
    );
    assert.equal(receipt.state, "recalculating");
    assert.equal((await row(recover)).state, "pending");
    assert.equal(
      (await call(recover, "/v1/reviews/" + id + "/check", {})).state,
      "recalculating",
    );
    await writeFile(
      path,
      JSON.stringify({ ...f, recover, source, recoverCase: id }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        checks: [
          "eight_transient_failure_budget_under_real_worker_role",
          "exhausted_job_stops_without_acknowledgment",
          "accepted_canonical_retry_never_reopens_restricted_raw_evidence",
          "audited_owner_retry_pending_before_process_restart",
        ],
      }),
    );
  } else if (phase === "verify") {
    const f = JSON.parse(await readFile(path, "utf8"));
    const recover = await login(f.recover);
    await until(async () => (await row(recover)).state === "applied");
    assert.equal(await digest(recover, true), f.source);
    assert.equal((await state(recover)).result.captured_minor, 1234);
    await mcp(recover, false);
    for (let n = 0; n < 4; n++) {
      const r = await call(
        recover,
        "/v1/reviews/" + f.recoverCase + "/check",
        {},
      );
      if (r.state === "resolved") break;
      assert.equal(r.state, "recalculating");
    }
    assert.equal((await review(recover)).state, "resolved");
    assert.equal((await row(f.poison)).state, "quarantined");
    assert.equal((await row(f.poison)).attempts, 1);
    assert.equal(await digest(f.poison), f.before);
    await state(f.legacy, 503);
    await mcp(f.poison, true);
    await db.query("DELETE FROM bb.projections WHERE tenant_id=$1", [
      recover.tenant,
    ]);
    console.log(
      JSON.stringify({
        checks: [
          "restart_applies_original_source_once_API_SDK_MCP",
          "case_resolves_only_after_Rust_lifecycle_readiness_check",
          "poison_stays_quarantined_across_restart",
          "journal_source_bytes_unchanged",
        ],
      }),
    );
  } else if (phase === "cold") {
    const f = JSON.parse(await readFile(path, "utf8"));
    assert.equal((await state(f.recover)).result.captured_minor, 1234);
    await mcp(f.recover, false);
    await state(f.legacy, 503);
    assert.equal(await digest(f.recover, true), f.source);
    console.log(
      JSON.stringify({
        checks: [
          "deleted_projection_restart_cold_reader_recovers_exact_money_and_rejects_unknown",
        ],
      }),
    );
  } else if (phase === "browser") {
    const f = JSON.parse(await readFile(path, "utf8")),
      errors: string[] = [],
      external: string[] = [];
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--disable-gpu"],
    });
    try {
      for (const lang of ["en", "de"]) {
        const context = await browser.newContext({
          viewport:
            lang === "en"
              ? { width: 1440, height: 1000 }
              : { width: 390, height: 844 },
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("request", (r) => {
          if (new URL(r.url()).origin !== base)
            external.push(new URL(r.url()).origin);
        });
        await page.goto(base);
        if (lang === "de")
          await page
            .getByRole("button", { name: "Deutsch", exact: true })
            .click();
        await page.locator("#key").fill(f.poison.owner);
        await page.locator("#signin").click();
        await page.locator("#workspace").waitFor();
        if (lang === "de") await page.locator(".mobile-menu").click();
        await page
          .getByRole("button", {
            name: lang === "en" ? "Sources" : "Quellen",
            exact: true,
          })
          .click();
        await page
          .getByRole("button", {
            name: lang === "en" ? "Inspect case" : "Prüffall öffnen",
            exact: true,
          })
          .click();
        await page
          .getByText(
            lang === "en"
              ? "Automatic processing has stopped for this input."
              : "Die automatische Verarbeitung dieser Eingabe wurde gestoppt.",
            { exact: false },
          )
          .waitFor();
        assert.equal(
          await page
            .getByRole("option", {
              name:
                lang === "en"
                  ? "Retry the original input"
                  : "Ursprüngliche Eingabe erneut verarbeiten",
              exact: true,
            })
            .count(),
          0,
        );
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        );
        await page.screenshot({ path: `work/derivation-${lang}.png` });
        await context.close();
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } finally {
      await browser.close();
    }
    console.log(
      JSON.stringify({
        checks: [
          "EN_DE_owner_quarantine_explanation_and_exhausted_retry_disabled",
          "DE_mobile_no_overflow_no_JS_errors_no_external_requests",
        ],
      }),
    );
  } else throw Error("unknown_test_phase");
} finally {
  await db.end();
  await pool.end();
}

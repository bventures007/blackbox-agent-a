import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import pg from "pg";
import { chromium } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { newKey, verifier } from "../packages/auth/index.js";
import { sendObservations } from "../packages/connectors/replay.js";
import { fixture } from "./questions/fixtures.js";
const base = process.env.BLACKBOX_API_URL!,
  runtime = process.env.TEST_RUNTIME_DIR!,
  internal = await readFile(process.env.INTERNAL_KEY_FILE!, "utf8"),
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
async function provision() {
  const tenant = randomUUID(),
    connection = randomUUID(),
    owner = newKey("owner"),
    agent = newKey("agent"),
    producer = newKey("producer"),
    producerPrincipal = randomUUID();
  await admin.query(
    "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Owner review synthetic')",
    [tenant],
  );
  await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
  for (const [purpose, key] of [
    ["owner", owner],
    ["agent", agent],
    ["producer", producer],
  ])
    await admin.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,$4,$5,'Review test')",
      [
        tenant,
        randomUUID(),
        purpose === "producer" ? producerPrincipal : randomUUID(),
        purpose,
        verifier(key),
      ],
    );
  await admin.query(
    "INSERT INTO bb.connections(tenant_id,connection_id,provider,account_anchor,config)VALUES($1,$2,'generic',$3,$4)",
    [
      tenant,
      connection,
      randomUUID(),
      {
        producer_principal_id: producerPrincipal,
        name: "Synthetic evidence source",
      },
    ],
  );
  const login = await fetch(base + "/v1/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify({ key: owner }),
  });
  assert.equal(login.status, 200);
  const csrf = (await login.json()).csrf,
    headers = {
      origin: base,
      "content-type": "application/json",
      cookie: login.headers.getSetCookie()[0].split(";")[0],
      "x-blackbox-csrf": csrf,
    };
  return { tenant, connection, owner, agent, producer, headers };
}
async function call(
  path: string,
  body: unknown | undefined,
  headers: Record<string, string>,
  status = 200,
) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await r.json();
  assert.equal(r.status, status, JSON.stringify(value));
  return value;
}
async function apply(tenant: string) {
  const r = await fetch(process.env.ENGINE_URL + "/v1/apply", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-blackbox-internal": internal,
    },
    body: JSON.stringify({ tenant_id: tenant }),
  });
  assert.equal(r.status, 200);
}
async function query(s: any, request: any) {
  return call("/v1/tools/query_business", request, {
    "content-type": "application/json",
    authorization: "Bearer " + s.agent,
  });
}
async function mcp(s: any, request: any) {
  const client = new Client({ name: "owner-review-verifier", version: "1" });
  await client.connect(
    new StdioClientTransport({
      command: process.execPath,
      args: ["--import", "tsx", "packages/mcp/main.ts"],
      env: {
        ...(process.env as Record<string, string>),
        BLACKBOX_AGENT_KEY: s.agent,
        BLACKBOX_API_URL: base,
      },
      stderr: "pipe",
    }),
  );
  try {
    const v = await client.callTool({
      name: "query_business",
      arguments: request,
    });
    assert.ok(!v.isError);
    return JSON.parse((v.content as any[])[0].text);
  } finally {
    await client.close();
  }
}
const normalize = (v: any) => {
  const { read_path, applied_cursor, ...value } = v;
  return value;
};
try {
  const phase = process.argv[2] ?? "seed";
  if (phase === "seed") {
    const s = await provision(),
      other = await provision(),
      sample = fixture(12),
      request = { intent: "orders.payment_state", ...sample.parameters };
    await sendObservations(base, s.connection, s.producer, sample.records);
    await apply(s.tenant);
    const old = await query(s, request),
      fixed = { ...request, recorded_cutoff: old.recorded_cutoff };
    assert.equal(old.result.rows[0].collected_minor, 5000);
    const payment = sample.records.find(
      (o: any) =>
        o.record.dataset === "payments" && o.record.status === "captured",
    )!;
    const claim = structuredClone(payment);
    (claim.record as any).amount_minor = 7000;
    await sendObservations(base, s.connection, s.producer, [claim]);
    await sendObservations(base, s.connection, s.producer, [claim]);
    let cases = (await call("/v1/reviews", undefined, s.headers)).cases;
    assert.equal(
      cases.length,
      1,
      "repeated conflicting claim has one stable case",
    );
    const id = cases[0].case_id,
      path = "/v1/reviews/" + id;
    await call(path, undefined, other.headers, 404);
    await call(path, undefined, { authorization: "Bearer " + s.agent }, 403);
    const detail = await call(path, undefined, s.headers);
    assert.equal(detail.proposed_observation.record.amount_minor, 7000);
    assert.equal(detail.current.payload.record.amount_minor, 5000);
    assert.ok(detail.claim_evidence_id !== detail.original_evidence_id);
    const body = {
      command_id: randomUUID(),
      revision: detail.revision,
      action: "correct",
      reason_code: "provider_claim_confirmed",
      note: "Synthetic statement confirms the captured amount is seventy euros.",
      evidence_ids: [detail.claim_evidence_id],
      expected_entry_id: detail.current.entry_id,
      record: detail.proposed_observation.record,
      acknowledged: true,
    };
    await call(
      path + "/decisions",
      body,
      { ...s.headers, "x-blackbox-csrf": "invalid" },
      403,
    );
    await call(
      path + "/decisions",
      body,
      {
        "content-type": "application/json",
        authorization: "Bearer " + s.agent,
      },
      403,
    );
    await call(
      path + "/decisions",
      { ...body, evidence_ids: [randomUUID()] },
      s.headers,
      409,
    );
    await call(
      path + "/decisions",
      { ...body, record: { ...body.record, order_id: randomUUID() } },
      s.headers,
      409,
    );
    const attempts = await Promise.all([
      call(path + "/decisions", body, s.headers),
      call(path + "/decisions", body, s.headers),
    ]);
    assert.equal(attempts[0].required_cursor, attempts[1].required_cursor);
    await call(
      path + "/decisions",
      {
        ...body,
        note: "A different decision must not reuse the same command identity.",
      },
      s.headers,
      409,
    );
    await call(
      path + "/decisions",
      { ...body, command_id: randomUUID() },
      s.headers,
      409,
    );
    const pending = await call(path + "/check", {}, s.headers);
    assert.equal(pending.state, "recalculating");
    assert.ok(pending.required_cursor > pending.applied_cursor);
    assert.equal((await call(path, undefined, s.headers)).state, "in_progress");
    const original = (
      await admin.query(
        "SELECT payload FROM bb.journal WHERE tenant_id=$1 AND entry_id=$2",
        [s.tenant, detail.current.entry_id],
      )
    ).rows[0].payload;
    assert.equal(original.record.amount_minor, 5000);
    assert.equal(
      (
        await admin.query(
          "SELECT count(*) FROM bb.review_decisions WHERE tenant_id=$1",
          [s.tenant],
        )
      ).rows[0].count,
      "1",
    );
    await apply(s.tenant);
    let resolved;
    for (let n = 0; n < 30; n++) {
      resolved = await call(path + "/check", {}, s.headers);
      if (resolved.state === "resolved") break;
    }
    assert.equal(resolved.state, "resolved");
    const corrected = await query(s, request);
    assert.equal(corrected.result.rows[0].collected_minor, 7000);
    assert.equal(corrected.result.rows[0].remaining_minor, 4900);
    assert.ok(
      corrected.human_confirmed_inputs.some(
        (x: any) => x.decision_id === body.command_id,
      ),
    );
    assert.deepEqual(normalize(await mcp(s, request)), normalize(corrected));
    assert.deepEqual(normalize(await query(s, fixed)), normalize(old));
    assert.equal((await query(s, fixed)).human_confirmed_inputs.length, 0);
    await sendObservations(base, s.connection, s.producer, [claim]);
    assert.equal(
      (await call("/v1/reviews", undefined, s.headers)).cases.length,
      1,
    );
    assert.equal((await call(path, undefined, s.headers)).state, "resolved");
    const second = structuredClone(claim);
    (second.record as any).amount_minor = 9000;
    await sendObservations(base, s.connection, s.producer, [second]);
    cases = (await call("/v1/reviews", undefined, s.headers)).cases;
    assert.equal(cases.filter((c: any) => c.state === "open").length, 1);
    // Separate browser workspace: the actual owner changes persisted money through the UI.
    const browserState = await provision(),
      browserFixture = fixture(12);
    await sendObservations(
      base,
      browserState.connection,
      browserState.producer,
      browserFixture.records,
    );
    await apply(browserState.tenant);
    const browserPayment = browserFixture.records.find(
        (o: any) =>
          o.record.dataset === "payments" && o.record.status === "captured",
      )!,
      browserClaim = structuredClone(browserPayment);
    (browserClaim.record as any).amount_minor = 8000;
    await sendObservations(
      base,
      browserState.connection,
      browserState.producer,
      [browserClaim],
    );
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
      args: ["--disable-gpu"],
    });
    const errors: string[] = [],
      external: string[] = [];
    try {
      const context = await browser.newContext({
          viewport: { width: 1440, height: 1000 },
          reducedMotion: "reduce",
        }),
        page = await context.newPage();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("request", (r) => {
        if (new URL(r.url()).origin !== base)
          external.push(new URL(r.url()).origin);
      });
      await page.goto(base);
      await page.locator("#key").fill(browserState.owner);
      await page.locator("#signin").click();
      await page.locator("#workspace").waitFor();
      await page.getByRole("button", { name: "Sources", exact: true }).click();
      await page
        .getByRole("button", { name: "Inspect case", exact: true })
        .click();
      await page
        .getByLabel("Decision", { exact: true })
        .selectOption("correct");
      await page
        .getByRole("button", { name: "Use proposed values", exact: true })
        .click();
      await page
        .getByLabel("What did you verify?", { exact: true })
        .fill(
          "Synthetic receipt confirms an eighty euro capture; no additional cash event.",
        );
      await page
        .getByLabel(
          "I checked the evidence. This records a human decision and does not certify complete provider history.",
          { exact: true },
        )
        .check();
      const saved = page.waitForResponse(
        (r) =>
          r.url().endsWith("/decisions") && r.request().method() === "POST",
      );
      await page
        .getByRole("button", { name: "Save decision", exact: true })
        .click();
      assert.equal((await saved).status(), 200);
      await page
        .getByText("Decision saved; recalculating", { exact: false })
        .waitFor();
      await page.screenshot({ path: runtime + "/review-en-recalculating.png" });
      await apply(browserState.tenant);
      await page
        .locator('dialog [role="status"]')
        .filter({ hasText: "Resolved" })
        .waitFor({ timeout: 30000 });
      const result = await query(browserState, {
        intent: "orders.payment_state",
        ...browserFixture.parameters,
      });
      assert.equal(result.result.rows[0].collected_minor, 8000);
      assert.ok(result.human_confirmed_inputs.length);
      assert.deepEqual(
        normalize(
          await mcp(browserState, {
            intent: "orders.payment_state",
            ...browserFixture.parameters,
          }),
        ),
        normalize(result),
      );
      await context.close();
      const de = await browser.newContext({
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
        }),
        mobile = await de.newPage();
      mobile.on("pageerror", (e) => errors.push(e.message));
      await mobile.goto(base);
      await mobile
        .getByRole("button", { name: "Deutsch", exact: true })
        .click();
      await mobile.locator("#key").fill(browserState.owner);
      await mobile.locator("#signin").click();
      await mobile.locator("#workspace").waitFor();
      await mobile.locator(".mobile-menu").click();
      await mobile
        .getByRole("button", { name: "Quellen", exact: true })
        .click();
      await mobile
        .getByRole("button", { name: "Prüffall öffnen", exact: true })
        .click();
      await mobile.getByText("Entscheidungsverlauf", { exact: true }).waitFor();
      assert.ok(
        await mobile.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      await mobile.screenshot({ path: runtime + "/review-de-mobile.png" });
      await de.close();
      assert.deepEqual(errors, []);
      assert.deepEqual(external, []);
    } catch (error) {
      const page = browser
        .contexts()
        .flatMap((c) => c.pages())
        .at(-1);
      if (page) {
        await page.screenshot({ path: runtime + "/review-failure.png" });
        await writeFile(
          runtime + "/review-failure.txt",
          JSON.stringify(
            { errors, body: await page.locator("body").innerText() },
            null,
            2,
          ),
        );
      }
      throw error;
    } finally {
      await browser.close();
    }
    const interruptedCase = cases.find((c: any) => c.state === "open").case_id;
    const interruptedDetail = await call(
      "/v1/reviews/" + interruptedCase,
      undefined,
      s.headers,
    );
    const interruptedBody = {
      ...body,
      command_id: randomUUID(),
      revision: interruptedDetail.revision,
      expected_entry_id: interruptedDetail.current.entry_id,
      record: interruptedDetail.proposed_observation.record,
      evidence_ids: [interruptedDetail.claim_evidence_id],
    };
    const interrupted = await call(
      "/v1/reviews/" + interruptedCase + "/decisions",
      interruptedBody,
      s.headers,
    );
    assert.equal(
      (await call("/v1/reviews/" + interruptedCase + "/check", {}, s.headers))
        .state,
      "recalculating",
    );
    await writeFile(
      runtime + "/reviews-state.json",
      JSON.stringify({
        s,
        fixed,
        old: normalize(old),
        request: { ...request, recorded_cutoff: corrected.recorded_cutoff },
        corrected: normalize(corrected),
        interrupted_case: interruptedCase,
        interrupted_cursor: interrupted.required_cursor,
        case_id: id,
        decision_id: body.command_id,
      }),
      { mode: 0o600 },
    );
    console.log(
      JSON.stringify({
        suite: "owner-review-v1",
        phase,
        result: "passed",
        checks: [
          "stable_conflicting_claim_identity_and_both_evidence_refs",
          "owner_csrf_agent_tenant_and_evidence_boundaries",
          "concurrent_idempotent_decision_and_stale_revision_denials",
          "journal_outbox_atomic_correction_original_payload_unchanged",
          "not_resolved_while_Rust_is_behind",
          "affected_query_checks_before_resolution",
          "current_API_actual_SDK_MCP_human_provenance_and_old_cutoff_parity",
          "resolved_exact_claim_replay_deduplicated_new_claim_reopens",
          "actual_EN_browser_decision_to_Rust_to_MCP",
          "DE_mobile_no_overflow_no_JS_errors_no_external_browser_requests",
        ],
      }),
    );
  } else {
    const state = JSON.parse(
      await readFile(runtime + "/reviews-state.json", "utf8"),
    );
    if (phase === "remove") {
      await admin.query("DELETE FROM bb.current_records WHERE tenant_id=$1", [
        state.s.tenant,
      ]);
      await admin.query("DELETE FROM bb.record_versions WHERE tenant_id=$1", [
        state.s.tenant,
      ]);
      console.log(
        JSON.stringify({ suite: "owner-review-v1", phase, result: "injected" }),
      );
    } else {
      assert.deepEqual(normalize(await query(state.s, state.fixed)), state.old);
      assert.deepEqual(
        normalize(await query(state.s, state.request)),
        state.corrected,
      );
      assert.deepEqual(
        normalize(await mcp(state.s, state.request)),
        state.corrected,
      );
      assert.equal(
        (await call("/v1/reviews/" + state.case_id, undefined, state.s.headers))
          .state,
        "resolved",
      );
      await apply(state.s.tenant);
      let resumed;
      for (let n = 0; n < 30; n++) {
        resumed = await call(
          "/v1/reviews/" + state.interrupted_case + "/check",
          {},
          state.s.headers,
        );
        if (resumed.state === "resolved") break;
      }
      assert.equal(resumed.state, "resolved");
      const resumedRequest = {
        ...state.request,
        recorded_cutoff: state.interrupted_cursor,
      };
      const resumedAnswer = await query(state.s, resumedRequest);
      assert.equal(resumedAnswer.result.rows[0].collected_minor, 9000);
      assert.ok(resumedAnswer.human_confirmed_inputs.length);
      assert.deepEqual(
        normalize(await mcp(state.s, resumedRequest)),
        normalize(resumedAnswer),
      );
      console.log(
        JSON.stringify({
          suite: "owner-review-v1",
          phase,
          result: "passed",
          checks: [
            "restart_and_indexed_cold_original_and_corrected_cutoffs_with_human_provenance",
            "actual_SDK_MCP_parity",
            "durable_resolved_decision",
            "acknowledged_unapplied_decision_survives_restart_and_resolves_through_actual_MCP",
          ],
        }),
      );
    }
  }
} finally {
  await admin.end();
}

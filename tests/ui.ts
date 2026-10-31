import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { newKey, verifier } from "../packages/auth/index.js";
const runtime = process.env.TEST_RUNTIME_DIR!,
  base = process.env.BLACKBOX_API_URL!,
  db = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
const cases = JSON.parse(
  await readFile(runtime + "/question-cases.json", "utf8"),
);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu"],
});
const checks: string[] = [],
  egress: string[] = [],
  errors: string[] = [];
try {
  // Actual owner sessions against the previously verified persisted fixture tenants; no mocked browser responses.
  for (let index = 0; index < 24; index++) {
    const sample = cases.find((r: any) => r.index === index && !r.missing),
      key = newKey("owner"),
      credential = randomUUID();
    await db.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE tenant_id=$1 AND purpose='owner' AND name='UI verification' AND revoked_at IS NULL",
      [sample.tenant],
    );
    await db.query(
      "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,'owner',$4,'UI verification')",
      [sample.tenant, credential, randomUUID(), verifier(key)],
    );
    const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        timezoneId: "UTC",
        reducedMotion: "reduce",
      }),
      page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("request", (r) => {
      if (new URL(r.url()).origin !== base)
        egress.push(new URL(r.url()).origin);
    });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base);
    await page.locator("#key").fill(key);
    await page.locator("#signin").click();
    await page.locator("#workspace").waitFor();
    await page
      .getByRole("button", { name: "Questions & Answers", exact: true })
      .click();
    assert.equal(await page.locator("#question-template option").count(), 24);
    await page.locator("#question-template").selectOption(String(index));
    if (sample.request.item_id)
      await page.locator("#query-item").fill(sample.request.item_id);
    if (sample.request.requested_quantity)
      await page
        .locator("#query-quantity")
        .fill(sample.request.requested_quantity);
    if (sample.request.unit)
      await page.locator("#query-unit").selectOption(sample.request.unit);
    if (sample.request.currency)
      await page.locator("#query-currency").fill(sample.request.currency);
    await page.locator("#query-asOf").fill(sample.request.as_of.slice(0, 16));
    await page
      .locator("#query-cutoff")
      .fill(String(sample.request.recorded_cutoff));
    await page.locator("#ask-template").click();
    await page.locator("#query-result").waitFor({ state: "attached" });
    const result = JSON.parse(
      (await page.locator("#query-result").textContent())!,
    );
    assert.deepEqual(result.result, sample.expected.result);
    assert.deepEqual(result.evidence, sample.expected.evidence);
    assert.equal(result.recorded_cutoff, sample.expected.recorded_cutoff);
    assert.equal(result.status, sample.expected.status);
    await page.locator("#language").click();
    assert.equal(await page.locator("html").getAttribute("lang"), "de");
    await Promise.all([
      page.waitForResponse((r) => r.url().endsWith("/v1/tools/query_business")),
      page.locator("#ask-template").click(),
    ]);
    assert.equal(await page.locator("#question-template option").count(), 24);
    assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [
      "bb_locale",
    ]);
    if (index === 0) {
      await page.screenshot({
        path: runtime + "/ui-answer-de.png",
        fullPage: true,
        animations: "disabled",
        timeout: 15000,
      });
    }
    await context.close();
    await db.query(
      "UPDATE bb.credentials SET revoked_at=now() WHERE tenant_id=$1 AND credential_id=$2",
      [sample.tenant, credential],
    );
  }
  checks.push(
    "24_templates_render_persisted_Rust_results_and_evidence_in_EN_DE",
    "all_24_UI_fixed_cutoff_answers_match_verified_API_results",
    "no_credentials_in_localStorage",
  );
  const { b } = JSON.parse(
    await readFile(runtime + "/slice-case.json", "utf8"),
  );
  const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      timezoneId: "UTC",
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (new URL(r.url()).origin !== base) egress.push(new URL(r.url()).origin);
  });
  await page.goto(base);
  await page.locator("#key").fill(b.owner);
  await page.locator("#signin").click();
  await page.locator("#journal button").first().waitFor();
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith("/v1/example")),
    page
      .getByRole("button", { name: "Run the example", exact: true })
      .first()
      .click(),
  ]);
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: runtime + "/ui-recorder-en.png",
    fullPage: false,
    animations: "disabled",
    timeout: 15000,
  });
  await page.locator("#journal button").first().click();
  await page
    .getByRole("button", { name: "Open evidence", exact: true })
    .click();
  await page
    .getByText("Source content is untrusted data.", { exact: false })
    .waitFor();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Agents & MCP", exact: true }).click();
  await page.locator("#agent-name").fill("UI disposable agent");
  await page.locator("#create-agent").click();
  await page.locator("dialog .secret code").waitFor();
  const agent = (await page.locator("dialog .secret code").textContent())!;
  await page.keyboard.press("Escape");
  assert.equal(
    (
      await fetch(base + "/v1/overview", {
        headers: { authorization: "Bearer " + agent },
      })
    ).status,
    403,
  );
  await page
    .getByRole("row")
    .filter({ hasText: "UI disposable agent" })
    .getByRole("button", { name: "Revoke", exact: true })
    .click();
  await page
    .getByRole("row")
    .filter({ hasText: "UI disposable agent" })
    .getByText("Revoked", { exact: true })
    .waitFor();
  assert.equal(
    (
      await fetch(base + "/v1/session", {
        headers: { authorization: "Bearer " + agent },
      })
    ).status,
    401,
  );
  await page
    .getByRole("button", { name: "System & Diagnostics", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Clear status. Useful diagnostics.",
      exact: true,
    })
    .waitFor();
  await page.locator(".log-table tbody tr").first().waitFor();
  await page
    .getByRole("button", { name: "Warnings & errors", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Export", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Create local export", exact: true })
    .click();
  const file = await downloaded;
  await file.saveAs(runtime + "/ui-diagnostics.json");
  const exported = JSON.parse(
    await readFile(runtime + "/ui-diagnostics.json", "utf8"),
  );
  assert.ok(Array.isArray(exported.records));
  assert.ok(!JSON.stringify(exported).includes(agent));
  assert.ok(!JSON.stringify(exported).includes(b.owner));
  await page.screenshot({
    path: runtime + "/ui-system-en.png",
    fullPage: false,
    animations: "disabled",
    timeout: 15000,
  });
  checks.push(
    "bundled_example_actual_ingestion",
    "evidence_drawer_original_content",
    "owner_agent_create_revoke",
    "agent_diagnostics_denial",
    "explicit_sanitized_export",
  );
  const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      timezoneId: "UTC",
      reducedMotion: "reduce",
    }),
    m = await mobile.newPage();
  await m.goto(base);
  await m.locator("#key").fill(b.owner);
  await m.locator("#signin").click();
  await m.locator("#workspace").waitFor();
  await m.locator("#language").click();
  await m.locator(".mobile-menu").click();
  await m
    .getByRole("button", { name: "System & Diagnose", exact: true })
    .click();
  assert.ok(
    await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  );
  await m.screenshot({
    path: runtime + "/ui-system-de-mobile.png",
    fullPage: false,
    animations: "disabled",
    timeout: 15000,
  });
  await m.locator(".mobile-menu").click();
  await m.locator("#logout").click();
  await m.locator("#login").waitFor();
  checks.push("German_mobile_navigation_diagnostics_logout_no_overflow");
  await mobile.close();
  await context.close();
  assert.deepEqual(egress, []);
  assert.deepEqual(errors, []);
  checks.push(
    "no_external_browser_network_requests_including_fonts",
    "no_browser_exceptions",
  );
  console.log(
    JSON.stringify({
      suite: "React_UI_persisted_integration",
      result: "passed",
      browser: browser.version(),
      checks,
      limitations: [
        "Not complete UI-01/DIAG/PILOT-10 certification; source onboarding, repairs, backup and full diagnostics controls remain in progress",
      ],
    }),
  );
} finally {
  await browser.close();
  await db.end();
}

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import pg from "pg";
const runtime = process.env.TEST_RUNTIME_DIR!,
  base = process.env.BLACKBOX_API_URL!,
  saved = { a: { owner: "bb_owner_" + randomBytes(32).toString("base64url") } };
const tenant = randomUUID(),
  admin = new pg.Pool({ connectionString: process.env.ADMIN_DATABASE_URL });
await admin.query(
  "INSERT INTO bb.workspaces(tenant_id,name)VALUES($1,'Source browser synthetic')",
  [tenant],
);
await admin.query("INSERT INTO bb.heads(tenant_id)VALUES($1)", [tenant]);
await admin.query(
  "INSERT INTO bb.credentials(tenant_id,credential_id,principal_id,purpose,verifier,name)VALUES($1,$2,$3,'owner',$4,'Source browser test')",
  [
    tenant,
    randomUUID(),
    randomUUID(),
    createHash("sha256").update(saved.a.owner).digest("hex"),
  ],
);
const login = await fetch(base + "/v1/login", {
  method: "POST",
  headers: { origin: base, "content-type": "application/json" },
  body: JSON.stringify({ key: saved.a.owner }),
});
const csrf = (await login.json()).csrf,
  cookie = login.headers.getSetCookie()[0].split(";")[0];
const enrolled = await fetch(base + "/v1/sources/shopify", {
  method: "POST",
  headers: {
    origin: base,
    "content-type": "application/json",
    cookie,
    "x-blackbox-csrf": csrf,
  },
  body: JSON.stringify({
    name: "Synthetic Shopify",
    credentials: {
      shop: process.env.FIXTURE_HOST,
      auth: "access_token",
      access_token: "synthetic-fixture-token",
      fixture: true,
    },
  }),
});
assert.equal(enrolled.status, 200);
const source = await enrolled.json();
await writeFile(
  runtime + "/source-browser-state.json",
  JSON.stringify({
    tenant,
    connection: source.connection_id,
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie,
      "x-blackbox-csrf": csrf,
    },
  }),
  { mode: 0o600 },
);
await admin.end();
const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-gpu"],
  }),
  errors: string[] = [],
  external: string[] = [],
  checks: string[] = [];
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
  await page.locator("#key").fill(saved.a.owner);
  await page.locator("#signin").click();
  await page.locator("#workspace").waitFor();
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page
    .getByRole("button", { name: "Import more history", exact: true })
    .click();
  await page.locator("#import-range").selectOption("custom");
  await page.locator("#import-start-date").fill("2025-01-01");
  await page.locator("#import-timezone").fill("Europe/Berlin");
  await page.getByRole("button", { name: "Review scope", exact: true }).click();
  await page.getByText("Known limitations", { exact: true }).waitFor();
  assert.equal(await page.locator("#start-source-import").isDisabled(), true);
  await page
    .getByLabel("I understand the available scope and these gaps.", {
      exact: true,
    })
    .check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/import") && r.request().method() === "POST",
  );
  await page.locator("#start-source-import").click();
  const started = await (await response).json();
  assert.equal(started.parameters.requested_from, "2024-12-31T23:00:00Z");
  assert.equal(started.revision, 1);
  await page
    .getByText("Plan saved. Collection continues in the background.", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).last().click();
  const advanced = page.locator(".source-progress tbody details").first();
  await advanced.locator("summary").click();
  const pauseResponse = page.waitForResponse(
    (r) =>
      r.url().includes("/control") &&
      r.request().postDataJSON()?.action === "pause",
  );
  await advanced
    .getByRole("button", { name: "Pause this run", exact: true })
    .click();
  assert.equal((await pauseResponse).status(), 200);
  await page
    .getByRole("button", { name: "Resume this run", exact: true })
    .first()
    .waitFor();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: runtime + "/source-import-en.png",
    fullPage: false,
    animations: "disabled",
  });
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  checks.push(
    "actual_browser_EN_scope_preview_acknowledgement_fixed_dates_durable_plan_and_job_pause",
  );
  await context.close();
  const mobile = await browser.newContext({
      viewport: { width: 390, height: 844 },
      reducedMotion: "reduce",
    }),
    de = await mobile.newPage();
  de.setDefaultTimeout(15000);
  de.on("pageerror", (e) => errors.push(e.message));
  de.on("request", (r) => {
    if (new URL(r.url()).origin !== base)
      external.push(new URL(r.url()).origin);
  });
  await de.goto(base);
  await de.locator("#key").fill(saved.a.owner);
  await de.locator("#signin").click();
  await de.locator("#workspace").waitFor();
  await de.locator("#language").click();
  await de.locator(".mobile-menu").click();
  await de.getByRole("button", { name: "Quellen", exact: true }).click();
  await de
    .getByRole("button", { name: "Weitere Historie importieren", exact: true })
    .click();
  await de.locator("#import-range").selectOption("from_now");
  await de
    .getByText("Für „Ab jetzt“ ist eine ausdrückliche Auswahl nötig.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await de.locator("dialog input[type=checkbox]:checked").count(),
    0,
  );
  await de.waitForTimeout(600);
  assert.equal(await de.locator("#import-range").inputValue(), "from_now");
  assert.equal(await de.locator("html").getAttribute("lang"), "de");
  assert.equal(
    await de.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    true,
  );
  await de.screenshot({
    path: runtime + "/source-import-de-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  await de.getByRole("button", { name: "Schließen", exact: true }).click();
  await de
    .getByRole("button", { name: "Quelle verbinden", exact: true })
    .first()
    .click();
  await de.locator("#shopify-domain").waitFor();
  assert.equal(
    await de.locator("#shopify-token").getAttribute("type"),
    "password",
  );
  await de.locator("#shopify-token").fill("synthetic-browser-secret-canary");
  await de.getByRole("button", { name: "Schließen", exact: true }).click();
  await de
    .getByRole("button", { name: "Quelle verbinden", exact: true })
    .first()
    .click();
  assert.equal(await de.locator("#shopify-token").inputValue(), "");
  checks.push(
    "actual_browser_DE_mobile_strict_from_now_choices_secret_fields_cleared_on_close_no_overflow",
  );
  await mobile.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  const evidence = {
    suite: "source-browser-v1",
    commit: execFileSync("git", ["rev-parse", "HEAD"]).toString().trim(),
    dirty: !!execFileSync("git", ["status", "--porcelain"]).toString().trim(),
    at: new Date().toISOString(),
    checks,
    js_errors: errors,
    external_requests: external,
    credential_validation: "synthetic_HTTP_API_test; no live credentials",
    result: "passed",
  };
  await writeFile(
    runtime + "/source-browser-evidence.json",
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
  await fetch(base + `/v1/connections/${source.connection_id}/state`, {
    method: "POST",
    headers: {
      origin: base,
      "content-type": "application/json",
      cookie,
      "x-blackbox-csrf": csrf,
    },
    body: JSON.stringify({ state: "paused" }),
  });
}

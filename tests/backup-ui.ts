import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
const base = process.env.BLACKBOX_API_URL!,
  output = process.env.TEST_RUNTIME_DIR!;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  timezoneId: "UTC",
  reducedMotion: "reduce",
});
const page = await context.newPage(),
  egress: string[] = [],
  errors: string[] = [];
page.on("request", (request) => {
  if (new URL(request.url()).origin !== base)
    egress.push(new URL(request.url()).origin);
});
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(base);
  await page.locator("#key").fill(process.env.TEST_OWNER_KEY!);
  await page.locator("#signin").click();
  await page.locator("#workspace").waitFor();
  await page
    .getByRole("button", { name: "Local settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create backup now", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(
      "This destination is on the same device. It does not protect against device loss.",
      { exact: true },
    ),
  ).toBeVisible();
  const before = await page.evaluate(async () =>
    (await fetch("/v1/backups")).json(),
  );
  assert.equal(before.configured, true);
  assert.equal(before.state, "completed");
  assert.equal(before.scheduler_alive, true);
  await page.screenshot({
    path: output + "/backup-en.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", { name: "Create backup now", exact: true })
    .click();
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(async () => {
            const r = await fetch("/v1/backups");
            return r.ok ? r.json() : null;
          });
        } catch {
          return null;
        }
      },
      { timeout: 150000, intervals: [1000] },
    )
    .toMatchObject({ state: "completed", configured: true });
  await expect
    .poll(
      async () => {
        try {
          return await page.evaluate(
            async () =>
              (await (await fetch("/v1/backups")).json()).last_completed,
          );
        } catch {
          return before.last_completed;
        }
      },
      { timeout: 150000, intervals: [1000] },
    )
    .not.toBe(before.last_completed);
  await page.locator("#language").click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Jetzt sichern", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  await expect(
    page.getByText(
      "Dieses Ziel liegt auf demselben Gerät. Es schützt nicht vor dem Verlust des Geräts.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Wiederherstellbarer Datenstand", { exact: true }),
  ).toBeVisible();
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), [
    "bb_locale",
  ]);
  await page.screenshot({
    path: output + "/backup-de.png",
    fullPage: true,
    animations: "disabled",
  });
  assert.deepEqual(egress, []);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      status: "passed",
      browser: browser.version(),
      checks: [
        "real_EN_DE_owner_backup_status_and_same_device_disclosure",
        "actual_browser_request_completes_new_encrypted_generation",
        "DE_mobile_settings_and_no_credentials_in_localStorage",
        "no_external_browser_requests_or_uncaught_errors",
      ],
    }),
  );
} finally {
  await browser.close();
}

import { chromium } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
const runtime = process.env.TEST_RUNTIME_DIR ?? resolve(".runtime");
const { b } = JSON.parse(
  await readFile(join(runtime, "slice-case.json"), "utf8"),
);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  await page.goto(process.env.BLACKBOX_API_URL!);
  await page.locator("#key").fill(b.owner);
  await page.locator("#signin").click();
  await page.locator("#workspace").waitFor({ state: "visible" });
  await page.locator("#journal button").first().waitFor();
  await page.locator("#entity").fill(b.entities[0]);
  await page.locator("#ask").click();
  await page.waitForFunction(() =>
    document.getElementById("answer")!.textContent!.includes("captured_minor"),
  );
  const result = JSON.parse(await page.locator("#answer").innerText());
  assert.equal(result.result.payment_status, "paid");
  const cookies = await context.cookies();
  assert.ok(
    cookies.some(
      (c) => c.name === "bb_session" && c.httpOnly && c.sameSite === "Strict",
    ),
  );
  assert.deepEqual(await page.evaluate(() => Object.keys(localStorage)), []);
  await page.screenshot({
    path: join(runtime, "slice-ui-en.png"),
    fullPage: true,
  });
  await page.locator("#language").click();
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  await page.reload();
  await page.locator("#workspace").waitFor({ state: "visible" });
  assert.equal(await page.locator("html").getAttribute("lang"), "de");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(runtime, "slice-ui-de-mobile.png"),
    fullPage: false,
  });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator("#logout").click();
  await page.locator("#login").waitFor({ state: "visible" });
  assert.equal(
    (
      await page.request.get(`${process.env.BLACKBOX_API_URL}/v1/status`)
    ).status(),
    401,
  );
  await context.close();
  console.log(
    JSON.stringify({
      suite: "minimal_persisted_slice_browser",
      browser: browser.version(),
      result: "passed",
      checks: [
        "owner_login",
        "actual_payment_answer",
        "HttpOnly_SameSite_cookie",
        "no_secret_localStorage",
        "German_locale_persistence",
        "mobile_no_overflow",
        "durable_logout",
      ],
      limitations: ["Minimal P1 UI; not full UI-01/LOCAL-06 acceptance"],
    }),
  );
} finally {
  await browser.close();
}

import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.env.BLACKBOX_API_URL!,
  runtime = process.env.TEST_RUNTIME_DIR!,
  saved = JSON.parse(
    await readFile(runtime + "/allocation-state.json", "utf8"),
  );
const cookie = saved.a.headers.cookie.split("="),
  browser = await chromium.launch({
    channel: "chrome",
    headless: true,
    args: ["--disable-gpu"],
  }),
  errors: string[] = [],
  external: string[] = [];
try {
  for (const locale of ["en", "de"]) {
    const context = await browser.newContext({
      viewport:
        locale === "en"
          ? { width: 1440, height: 1000 }
          : { width: 390, height: 844 },
      reducedMotion: "reduce",
    });
    await context.addCookies([
      {
        name: cookie[0],
        value: cookie.slice(1).join("="),
        url: base,
        httpOnly: true,
        sameSite: "Strict",
      },
    ]);
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("request", (r) => {
      if (new URL(r.url()).origin !== base)
        external.push(new URL(r.url()).origin);
    });
    await page.goto(base);
    await page.locator("#workspace").waitFor();
    if (locale === "de") {
      await page.locator("#language").click();
      await page.locator(".mobile-menu").click();
    }
    await page
      .getByRole("button", {
        name: locale === "en" ? "Sources" : "Quellen",
        exact: true,
      })
      .click();
    await page
      .getByRole("button", {
        name:
          locale === "en"
            ? "Import more history"
            : "Weitere Historie importieren",
        exact: true,
      })
      .click();
    await page
      .getByLabel(
        locale === "en"
          ? "Fulfillment assignments (separate fulfillment-order access required)"
          : "Zuordnungen zur Auslieferung (separate Leseberechtigung erforderlich)",
        { exact: true },
      )
      .check();
    await page
      .getByRole("button", {
        name: locale === "en" ? "Review scope" : "Umfang prüfen",
        exact: true,
      })
      .click();
    await page
      .getByText(
        locale === "en"
          ? "Assignments show which location should fulfill an order. They do not prove reserved stock or a priority policy."
          : "Zuordnungen zeigen, welcher Standort einen Auftrag ausliefern soll. Sie belegen keinen reservierten Bestand und keine Prioritätsregel.",
        { exact: true },
      )
      .waitFor();
    assert.equal(await page.locator("#start-source-import").isDisabled(), true);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.locator("#start-source-import").scrollIntoViewIfNeeded();
    assert.equal(await page.locator("#start-source-import").isVisible(), true);
    await page.screenshot({
      path: runtime + "/allocation-scope-" + locale + ".png",
      animations: "disabled",
    });
    assert.deepEqual(
      await page.evaluate(() => Object.keys(localStorage)),
      locale === "de" ? ["bb_locale"] : [],
    );
    if (locale === "de")
      assert.equal(
        await page.evaluate(() => localStorage.getItem("bb_locale")),
        "de",
      );
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    JSON.stringify({
      suite: "shopify-allocation-browser-v1",
      result: "passed",
      checks: [
        "actual_EN_DE_allocation_selection_and_scope_preview",
        "restrictions_acknowledgement_required",
        "DE_mobile_no_overflow",
        "no_browser_exceptions_external_requests_or_localStorage_secrets",
      ],
    }),
  );
} finally {
  await browser.close();
}

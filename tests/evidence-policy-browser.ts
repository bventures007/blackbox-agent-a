import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "@playwright/test";
const base = process.env.BLACKBOX_API_URL!,
  runtime = process.env.TEST_RUNTIME_DIR!,
  owner =
    process.env.TEST_OWNER_KEY ??
    JSON.parse(await readFile(runtime + "/evidence-policy-proof.json", "utf8"))
      .s.owner;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--disable-gpu"],
});
const errors: string[] = [],
  external: string[] = [];
try {
  for (const language of ["en", "de"]) {
    const context = await browser.newContext({
        viewport:
          language === "de"
            ? { width: 390, height: 844 }
            : { width: 1440, height: 1000 },
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
    if (language === "de")
      await page.getByRole("button", { name: "Deutsch", exact: true }).click();
    await page.locator("#key").fill(owner);
    await page.locator("#signin").click();
    await page.locator("#workspace").waitFor();
    if (language === "de") await page.locator(".mobile-menu").click();
    await page
      .getByRole("button", {
        name: language === "de" ? "Lokale Einstellungen" : "Local settings",
        exact: true,
      })
      .click();
    const title =
      language === "de"
        ? "Originalinhalte & Aufbewahrung"
        : "Original content & retention";
    await page.getByText(title, { exact: true }).waitFor();
    const panel = page
      .locator("section.panel")
      .filter({ has: page.getByText(title, { exact: true }) });
    await panel
      .getByLabel(language === "de" ? "Tage ab Empfang" : "Days from receipt", {
        exact: true,
      })
      .fill("30");
    await panel
      .getByLabel(language === "de" ? "Grund" : "Reason", { exact: true })
      .selectOption("minimize_content");
    await panel.getByRole("checkbox").check();
    await panel
      .getByRole("button", {
        name:
          language === "de"
            ? "Aufbewahrungsrichtlinie speichern"
            : "Save retention policy",
        exact: true,
      })
      .click();
    await panel
      .getByText(
        language === "de"
          ? "Richtlinie gespeichert. Vorhandene Inhalte erhalten keine zusätzliche Zeit."
          : "Selected policy saved. Existing content cannot gain extra time.",
        { exact: true },
      )
      .waitFor();
    await panel.scrollIntoViewIfNeeded();
    if (process.env.TEST_HOST_SCHEDULER === "1") {
      await panel
        .getByText(language === "de" ? "Geplant" : "Scheduled", { exact: true })
        .waitFor();
      assert.equal(
        await panel
          .getByText(
            language === "de"
              ? "Der Status der automatischen Bereinigung ist in dieser Laufzeit nicht verfügbar."
              : "Automatic cleanup status is unavailable in this runtime.",
            { exact: false },
          )
          .count(),
        0,
      );
    }
    if (process.env.TEST_EXPECT_BACKUP_WARNING === "1") {
      await panel
        .getByText(
          language === "de"
            ? "Bekannte verwaltete Sicherungsstände"
            : "Known managed backup generations",
          { exact: true },
        )
        .click();
      const warning = panel.getByText(
        language === "de"
          ? "Kann Inhalte enthalten, die seit diesem Stand entfernt oder gesperrt wurden"
          : "May contain content removed or restricted since this cutoff",
        { exact: false },
      );
      await warning.waitFor();
      await warning.scrollIntoViewIfNeeded();
    }
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: runtime + "/evidence-policy-" + language + ".png",
    });
    await context.close();
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "actual_EN_DE_owner_policy_save_mobile_no_overflow_no_JS_errors_or_external_requests",
  );
} finally {
  await browser.close();
}

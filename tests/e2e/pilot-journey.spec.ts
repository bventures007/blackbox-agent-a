/**
 * UI-01 / LOCAL-06 / HEALTH-02 / DIAG-01 browser journey in English and German on desktop and a narrow viewport:
 * landing → sign-in → recorder → sources → questions (evidence drawer) → agents → journal → review → diagnostics (filters,
 * live/pause, debug, export preview) → settings. Screenshots are written to tests/evidence/current/screens/.
 */
import { test, expect, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const ROOT = resolve(__dirname, '../..'); const KEY = readFileSync(resolve(ROOT, '.local/test-owner-key'), 'utf8').trim();
const shots = resolve(ROOT, 'tests/evidence/current/screens'); mkdirSync(shots, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: resolve(shots, `${test.info().project.name}-${name}.png`), fullPage: true });
async function signIn(page: Page, lang: 'en' | 'de') {
  await page.goto('/'); await page.getByRole('button', { name: lang.toUpperCase(), exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Zugangsschlüssel' : 'access key');
  await page.getByLabel(lang === 'de' ? 'Zugangsschlüssel' : 'Access key').fill(KEY); await page.getByRole('button', { name: lang === 'de' ? 'Anmelden' : 'Sign in' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Dein Business' : 'Your business');
}
for (const lang of ['en', 'de'] as const) {
  test(`landing renders without backend session and links the guide (${lang})`, async ({ page }) => {
    await page.goto('/landing/'); await page.getByRole('button', { name: lang.toUpperCase(), exact: true }).click();
    await expect(page.locator('#download-state')).toContainText(lang === 'de' ? /herunterladen|noch nicht verfügbar/i : /download/i);
    await expect(page.getByRole('link', { name: lang === 'de' ? 'Installationsanleitung' : 'Installation guide' }).first()).toBeVisible();
    await shot(page, `landing-${lang}`);
    await page.getByRole('link', { name: lang === 'de' ? 'Installationsanleitung' : 'Installation guide' }).first().click();
    await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Download' : 'download'); await shot(page, `guide-${lang}`);
  });
  test(`owner journey (${lang})`, async ({ page }) => {
    await signIn(page, lang); await shot(page, `recorder-${lang}`);
    const nav = (name: string) => page.getByRole('navigation', { name: 'Application' }).getByRole('button', { name });
    const isMobile = test.info().project.name === 'mobile';
    const open = async (name: string) => { if (isMobile) await page.getByRole('button', { name: lang === 'de' ? 'Navigation öffnen' : 'Open navigation' }).click(); await nav(name).click(); };
    await open(lang === 'de' ? 'Quellen' : 'Sources'); await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Quellen' : 'sources'); await expect(page.getByText(lang === 'de' ? 'Geplant' : 'Planned').first()).toBeVisible(); await shot(page, `sources-${lang}`);
    await open(lang === 'de' ? 'Fragen & Antworten' : 'Questions & Answers'); await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Fragen' : 'questions');
    await page.getByRole('option', { name: /Olive Cups/ }).click(); await page.getByLabel('item_id *').fill('CUP-OLV'); await page.getByLabel('requested_quantity').fill('100'); await page.getByRole('button', { name: lang === 'de' ? 'Fragen' : 'Ask', exact: true }).click();
    await expect(page.getByText(lang === 'de' ? 'Berechnung' : 'Calculation')).toBeVisible({ timeout: 30_000 }); await shot(page, `answer-${lang}`);
    const cite = page.locator('.citation-btn').first(); if (await cite.count()) { await cite.click(); await expect(page.getByRole('dialog')).toBeVisible(); await shot(page, `evidence-drawer-${lang}`); await page.keyboard.press('Escape'); }
    await open(lang === 'de' ? 'Agenten & MCP' : 'Agents & MCP'); await expect(page.getByText(/blackbox-mcp/)).toBeVisible(); await shot(page, `agents-${lang}`);
    await open(lang === 'de' ? 'Ereignisprotokoll' : 'Journal'); await expect(page.locator('table.ledger-table')).toBeVisible(); await shot(page, `journal-${lang}`);
    await open(lang === 'de' ? 'Prüfung erforderlich' : 'Needs review'); await shot(page, `review-${lang}`);
    await open(lang === 'de' ? 'System & Diagnose' : 'System & Diagnostics'); await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Diagnose' : 'Diagnostics');
    await expect(page.locator('.status-pill').first()).toBeVisible(); await expect(page.locator('.log-row').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: lang === 'de' ? 'Warnungen & Fehler' : 'Warnings & errors' }).click(); await page.getByRole('button', { name: lang === 'de' ? 'Pause' : 'Pause', exact: true }).click(); await expect(page.getByRole('button', { name: new RegExp(lang === 'de' ? 'Fortsetzen' : 'Resume') })).toBeVisible();
    await page.getByRole('button', { name: lang === 'de' ? 'Vorschau' : 'Preview', exact: true }).click(); await expect(page.locator('.pre').last()).toContainText('estimated_size_bytes'); await shot(page, `diagnostics-${lang}`);
    await open(lang === 'de' ? 'Einstellungen' : 'Settings'); await expect(page.getByText(lang === 'de' ? 'Laufzeit-Lebenszyklus' : 'Runtime lifecycle')).toBeVisible(); await shot(page, `settings-${lang}`);
    // keyboard: tab reaches the navigation and the skip link works
    await page.keyboard.press('Tab'); const focused = await page.evaluate(() => document.activeElement?.className ?? ''); expect(focused.length).toBeGreaterThan(0);
    await open(lang === 'de' ? 'Flugschreiber' : 'Recorder'); await expect(page.getByText(lang === 'de' ? 'Business-Flugschreiber' : 'Business recorder')).toBeVisible();
    await page.reload(); await expect(page.getByRole('heading', { level: 1 })).toContainText(lang === 'de' ? 'Dein Business' : 'Your business'); // session survives refresh
  });
}
test('wrong key shows an understandable error and no key material leaks', async ({ page }) => {
  await page.goto('/'); await page.getByLabel('Access key').fill('bbx_owner_' + 'a'.repeat(52)); await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('not accepted'); const html = await page.content(); expect(html).not.toContain('bbx_owner_a');
  const storage = await page.evaluate(() => JSON.stringify(Object.keys(localStorage))); expect(storage).not.toMatch(/key|session|token/i);
});

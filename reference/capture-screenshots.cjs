#!/usr/bin/env node
// Capture the unchanged static prototype. This is reference generation, not a product test.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const moduleRoot = process.env.BLACKBOX_CAPTURE_MODULE_ROOT;
const { chromium } = require(moduleRoot ? path.join(moduleRoot, 'playwright') : 'playwright');
const out = path.join(__dirname, 'screenshots');
const prototype = path.join(__dirname, 'prototype', 'index.html');
const provenance = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const cases = [];
const click = (action, id) => ({ click: `[data-action="${action}"]${id ? `[data-id="${id}"]` : ''}` });
const add = (id, title, group, route, steps = [], options = {}) => cases.push({ id, title, group, route, steps, device: 'desktop', framing: 'full-page', ...options });
const dialog = { framing: 'viewport' };
const drawerBottom = { scroll: '.detail-drawer', position: 'bottom' };
const onboarding = n => [click('signup'), { submit: '#signup-form' }, ...Array.from({ length: n - 1 }, () => click('onboard-next'))];
const billing = n => [click('connect', 'easybill'), click('billing-activate', 'easybill'), ...Array.from({ length: n }, () => click('billing-next', 'easybill'))];
const payment = (id, n) => [click('connect', id), click('payment-activate', id), ...Array.from({ length: n }, () => click('payment-next', id))];

add('01-landing', 'Complete landing page', 'Landing and onboarding', '');
add('02-landing-hero', 'Landing page first viewport', 'Landing and onboarding', '', [], dialog);
add('03-signup', 'Create a demo workspace', 'Landing and onboarding', '', [click('signup')], dialog);
add('04-demo-information', 'Prototype capabilities and limitations', 'Landing and onboarding', '', [click('about')], dialog);
for (const [n, title] of [[1, 'Choose demo sources'], [2, 'Understand the five-track context'], [3, 'Choose an agent and finish onboarding']]) {
  add(`0${4 + n}-onboarding-${n}`, title, 'Landing and onboarding', '', onboarding(n), dialog);
}
add('08-recorder', 'Recorder, five tracks, questions and recent activity', 'Recorder', '#app/recorder');
add('09-recorder-paused', 'Recorder with simulation paused', 'Recorder', '#app/recorder', [click('pause')]);
add('10-recorder-new-event', 'Recorder after adding a simulated event', 'Recorder', '#app/recorder', [click('simulate')]);
add('11-sources', 'Complete source catalogue', 'Sources', '#app/sources');
for (const [i, id, title] of [[12, 'shops', 'Shops and business sources'], [13, 'payment', 'Payment and payout sources'], [14, 'billing', 'Invoice and accounting sources'], [15, 'tracking', 'Shipping sources within the shared catalogue']]) {
  add(`${i}-sources-${id}`, title, 'Sources', '#app/sources', [], { framing: 'element', selector: `#source-${id}` });
}
for (const [i, id, title] of [[16, 'shopify', 'Manage an active Shopify demo source'], [17, 'api', 'Connect a custom API demo source'], [18, 'dhl', 'Connect a DHL demo source'], [19, 'easybill', 'Connect an easybill demo source'], [20, 'shopify_payments', 'Connect a Shopify Payments demo source']]) {
  add(`${i}-connect-${id}`, title, 'Source dialogs', '#app/sources', [click('connect', id)], dialog);
}
add('21-answers-empty', 'Questions page before asking', 'Questions and evidence', '#app/answers');
for (const [i, id, title] of [[22, 'inventory', 'Available stock and reservations'], [23, 'delivery', 'Changed supplier delivery commitment'], [24, 'cash', 'Cash and committed expenses'], [25, 'tracking', 'Shipment status and exceptions'], [26, 'billing', 'Outstanding invoice amounts'], [27, 'payments', 'Money held by payment providers']]) {
  add(`${i}-answer-${id}`, title, 'Questions and evidence', '#app/answers', [click('ask', id)]);
}
add('28-answer-unknown', 'Insufficient data response', 'Questions and evidence', '#app/answers', [{ fill: '#question-input', value: 'How many unicorns visited yesterday?' }, { submit: '#question-form' }]);
for (const [i, id, title] of [[29, 'SRC-001', 'Source event and original evidence'], [30, 'FAC-001', 'Extracted fact and linked evidence'], [31, 'COM-002', 'Current commitment and prior history'], [32, 'MOV-001', 'Movement and evidence'], [33, 'RES-001', 'Reservation and linked order'], [34, 'COM-001', 'Superseded commitment retained in the journal']]) {
  add(`${i}-event-${id.toLowerCase()}`, title, 'Event details: all five tracks', '#app/history', [click('event', id)], dialog);
}
add('35-invoice-issued', 'Original invoice and receivable', 'Invoice lifecycle', '#app/sources', billing(0), dialog);
add('36-invoice-corrected', 'Invoice after a partial correction', 'Invoice lifecycle', '#app/sources', billing(1), dialog);
add('37-invoice-cancelled', 'Remaining receivable cancelled without a cash refund', 'Invoice lifecycle', '#app/sources', billing(2), dialog);
add('38-invoice-history', 'Invoice drawer scrolled to historical evidence', 'Invoice lifecycle', '#app/sources', [...billing(2), drawerBottom], dialog);
add('39-payment-authorized', 'Authorization before capture', 'Payment lifecycle', '#app/sources', payment('shopify_payments', 0), dialog);
add('40-payment-in-transit', 'Payout sent, bank receipt still unconfirmed', 'Payment lifecycle', '#app/sources', payment('shopify_payments', 4), dialog);
add('41-payment-bank-matched', 'Payout matched to a separate synthetic bank record', 'Payment lifecycle', '#app/sources', payment('shopify_payments', 5), dialog);
add('42-payment-history', 'Payment drawer scrolled to earlier evidence', 'Payment lifecycle', '#app/sources', [...payment('shopify_payments', 5), drawerBottom], dialog);
add('43-payment-disputed', 'PayPal dispute and held balance', 'Payment lifecycle', '#app/sources', payment('paypal', 1), dialog);
add('44-refund-pending', 'Mollie refund reserved but not completed', 'Payment lifecycle', '#app/sources', payment('mollie', 3), dialog);
add('45-refund-completed', 'Mollie refund completed and reservation released', 'Payment lifecycle', '#app/sources', payment('mollie', 4), dialog);
add('46-agents', 'MCP concept, tools and all 24 Order-to-Cash questions', 'Agents and MCP', '#app/agents');
add('47-agent-chatgpt', 'ChatGPT connection concept', 'Agents and MCP', '#app/agents', [click('agent', 'ChatGPT')], dialog);
add('48-agent-custom', 'Custom agent connection concept', 'Agents and MCP', '#app/agents', [click('agent', 'Eigener Agent')], dialog);
add('49-agent-simulation', 'Simulated agent answer with evidence', 'Agents and MCP', '#app/agents', [click('test-agent')], dialog);
for (const [i, id, title] of [[50, 'order', 'Order and availability'], [51, 'delivery', 'Delivery and customer communication'], [52, 'invoice', 'Invoices and receivables'], [53, 'collection', 'Customer payments and clarification'], [54, 'settlement', 'Payouts and bank reconciliation'], [55, 'reversal', 'Cancellations, returns and refunds']]) {
  add(`${i}-otc-${id}`, `All four expanded questions: ${title}`, 'Order-to-Cash question groups', '#app/agents', [click('otc-filter', id), { expand: `[data-otc-group="${id}"] details` }], { framing: 'element', selector: '#otc-examples' });
}
add('56-journal', 'Complete seeded event journal', 'Journal', '#app/history');
add('57-journal-filtered', 'Commitment history: current and superseded promise', 'Journal', '#app/history', [{ select: '#history-type', value: 'commitment' }, { fill: '#history-search', value: 'PO-208' }]);
add('58-journal-empty', 'Journal with no matching events', 'Journal', '#app/history', [{ fill: '#history-search', value: 'NO-SUCH-ORDER' }]);
for (const [i, route, title, steps, framing] of [
  [1, '', 'Mobile landing page', [], 'full-page'],
  [2, '#app/recorder', 'Mobile recorder', [], 'full-page'],
  [3, '#app/sources', 'Mobile source catalogue', [], 'full-page'],
  [4, '#app/answers', 'Mobile answer with evidence', [click('ask', 'inventory')], 'full-page'],
  [5, '#app/agents', 'Mobile agents and Order-to-Cash examples', [], 'full-page'],
  [6, '#app/history', 'Mobile journal and horizontal table layout', [], 'viewport'],
  [7, '#app/recorder', 'Mobile navigation open', [click('menu')], 'viewport'],
  [8, '', 'Mobile demo workspace dialog', [click('signup')], 'viewport'],
  [9, '#app/history', 'Mobile source evidence drawer', [click('event', 'SRC-001')], 'viewport'],
]) add(`${String(i).padStart(2, '0')}-${title.toLowerCase().replace(/^mobile /, '').replace(/[^a-z0-9]+/g, '-')}`, title, 'Mobile', route, steps, { device: 'mobile', framing });

async function applyStep(page, step) {
  if (step.click) await page.locator(`${step.click}:visible`).first().click();
  else if (step.fill) await page.locator(step.fill).fill(step.value);
  else if (step.select) await page.locator(step.select).selectOption(step.value);
  else if (step.submit) await page.locator(`${step.submit} [type="submit"]`).click();
  else if (step.expand) {
    const items = page.locator(step.expand);
    if (await items.count() !== 4) throw new Error('Expected four questions in this group');
    for (const item of await items.all()) await item.locator('summary').click();
  } else if (step.scroll) await page.locator(step.scroll).evaluate(el => { el.scrollTop = el.scrollHeight; });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function writeIndex(manifest) {
  const desktop = manifest.screenshots.filter(s => s.device === 'desktop').length;
  const mobile = manifest.screenshots.filter(s => s.device === 'mobile').length;
  const lines = [
    '# Visual reference catalogue', '',
    `The unchanged prototype is documented in **${manifest.completedCaptureCount} new screenshots: ${desktop} desktop and ${mobile} mobile captures**. All six top-level views are included: landing page, recorder, sources, questions/answers, agents/MCP and journal. Dialogs, meaningful lifecycle states and the 24 expanded Order-to-Cash questions supplement these pages.`, '',
    'These are synthetic design references, not evidence that authentication, connectors, persistence, MCP or the production product work. All engineering instructions are English. The original UI in these images is German; implement the production UI and landing page in **English by default and German**, as required by the build brief.', '',
    '## Start with the complete user journey', '',
    '1. [Landing page](desktop/01-landing.png) → [demo workspace](desktop/03-signup.png) → [source selection](desktop/05-onboarding-1.png) → [context explanation](desktop/06-onboarding-2.png) → [agent introduction](desktop/07-onboarding-3.png).',
    '2. [Recorder](desktop/08-recorder.png) → [source catalogue](desktop/11-sources.png) → [business answer with evidence](desktop/22-answer-inventory.png) → [source detail](desktop/29-event-src-001.png).',
    '3. [Agent/MCP page and question catalogue](desktop/46-agents.png) → the six expanded question groups below → [journal](desktop/56-journal.png).',
    '4. Review the mobile captures before implementing responsive components. Open the [interactive prototype](../prototype/index.html) through the local preview server described in the repository README to inspect transitions and scrolling.', '',
    'Read the screenshots together with the build brief, journal/MCP and performance specifications. Screenshots define visual intent; synthetic numbers, keyword-based answers and schematic MCP configuration do not define production behavior. The binding specifications take precedence over prototype shortcuts.', '',
    '## Quick visual orientation', '',
    '[![Landing page first viewport](desktop/02-landing-hero.png)](desktop/01-landing.png)', '',
    '[![Recorder and five linked tracks](desktop/08-recorder.png)](desktop/08-recorder.png)', '',
    '## Capture coverage', '',
    '**Full page** includes content below the fold. **Viewport** preserves the actual visible window; scrollable dialogs/drawers may continue below it. **Element** captures one complete source category or question section. Explicit history captures show the bottom of long invoice/payment drawers. Other provider dialogs reuse the same layouts and are represented by selected examples, not every possible provider/state combination.', '',
  ];
  const groups = [...new Set(manifest.screenshots.map(s => s.group))];
  for (const group of groups) {
    lines.push(`### ${group}`, '', '| Screenshot | Framing | Pixels |', '| --- | --- | --- |');
    for (const c of manifest.screenshots.filter(s => s.group === group)) {
      lines.push(`| [${c.id}: ${c.title}](${c.file}) | ${c.framing} | ${c.pixels.width} × ${c.pixels.height} |`);
    }
    lines.push('');
  }
  lines.push(
    '## Coverage boundaries and missing product views', '',
    '- **Represented:** all implemented top-level routes, the three onboarding steps, all five event types, an explicitly superseded commitment, each source category, six prepared answer types and an unknown-data answer, invoice corrections/cancellation, payment authorization/payout/bank evidence/dispute/refund states, all three agent choices, simulated MCP answer, all 24 expanded question explanations, journal filtering and empty results, and representative mobile layouts.',
    '- **Still to design and implement:** real sign-in/recovery/account verification, workspace switching and invitations, roles/permission administration, real provider authorization and credential rotation, sync health/import progress/retries/reconciliation, production MCP authorization/token management and client error states, operational settings/backup/restore/upgrade screens, and complete English product copy. Follow the build brief for mandatory scope; a missing reference screen does not remove a requirement or automatically add a new UI requirement.',
    '- **Prototype limitations to improve:** the recorder and journal use horizontally scrollable content on small screens; long evidence drawers scroll independently. Fixed navigation appears only within the initial viewport of full-page browser captures. Preserve the visual language while making the production layout usable and accessible.',
    '- **Not exhaustive:** this catalogue does not enumerate every combination of source selection, event, payment step, filter, open question, validation message, browser or screen size. The local prototype and capture recipes provide the remaining interaction context.',
    '- **Live integrations:** provider cards and demo activation controls are concepts. A visible provider card is not an implemented connector. Shipping remains an ordinary source category; Xentral is not part of this reference.', '',
    '## Provenance and reproduction', '',
    'The [capture manifest](capture-manifest.json) lists each file, SHA-256 checksum, dimensions, viewport, route and ordered interaction recipe. The [reference manifest](../manifest.json) identifies the unchanged source snapshot. Captures use fresh browser contexts, the original synthetic data, device scale factor 1, desktop 1440 × 1000 and mobile 390 × 844. The automatic demo clock is held at its initial state; explicitly clicked simulation controls still advance their demo lifecycles. Animations/caret/transient toast are suppressed and scrolling is instant for stable images. No business text, data or layouts were rewritten for the images.', '',
    'With Node.js and Playwright available as local tooling:', '',
    '```sh',
    'node reference/capture-screenshots.cjs',
    '```', '',
    'The script uses the local static files and a headless Chromium browser. Install the matching Chromium runtime if Playwright does not have one. Google Fonts needs network access when not cached. For tooling installed in a separate directory, set `BLACKBOX_CAPTURE_MODULE_ROOT` to its `node_modules` directory. Optional `BLACKBOX_CAPTURE_FILTER=desktop/57-` recaptures just matching cases and retains existing manifest entries. A full run is the authoritative way to refresh the entire catalogue. This is a capture utility, not the production UI test runner or a pixel-perfect regression oracle.', '',
    'After an intentional refresh, review the images and regenerate the repository reference baseline checksums. Do not edit screenshots to imply missing functionality works.', '',
    '## Earlier highlights', '',
    'The initial preparation included two highlights of the most recently edited areas. They are retained for provenance and are superseded for coverage by the catalogue above:', '',
    '- [Earlier sources highlight](blackbox-sources-without-xentral.jpg)',
    '- [Earlier Order-to-Cash agents highlight](blackbox-order-to-cash-agents.jpg)', '',
  );
  fs.writeFileSync(path.join(out, 'README.md'), lines.join('\n'));
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const manifestPath = path.join(out, 'capture-manifest.json');
  const filter = process.env.BLACKBOX_CAPTURE_FILTER;
  const selected = cases.filter(c => !filter || `${c.device}/${c.id}`.includes(filter));
  if (!selected.length) throw new Error('No capture cases match BLACKBOX_CAPTURE_FILTER');
  const records = filter && fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')).screenshots : [];
  try {
    for (const c of selected) {
      const viewport = c.device === 'mobile' ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
      const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: c.device === 'mobile', hasTouch: c.device === 'mobile', locale: 'de-DE', timezoneId: 'Europe/Rome', reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.addInitScript(() => {
        // Keep seeded events/time stable; all explicit simulation controls remain usable.
        const interval = window.setInterval.bind(window);
        window.setInterval = (fn, ms, ...args) => ms === 1000 ? 0 : interval(fn, ms, ...args);
      });
      await page.goto(pathToFileURL(prototype).href + c.route);
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
      for (const step of c.steps) await applyStep(page, step);
      if (c.framing === 'full-page') await page.evaluate(() => window.scrollTo(0, 0));
      const layout = await page.evaluate(() => ({ documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth, fonts: [...new Set([...document.fonts].filter(f => f.status === 'loaded').map(f => f.family))] }));
      if (errors.length) throw new Error(`${c.id}: ${errors.join('; ')}`);
      const relative = `${c.device}/${c.id}.png`;
      const target = path.join(out, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      const options = { path: target, animations: 'disabled', caret: 'hide', style: '#toast { visibility: hidden !important; }' };
      if (c.framing === 'element') await page.locator(c.selector).screenshot(options);
      else await page.screenshot({ ...options, fullPage: c.framing === 'full-page' });
      const bytes = fs.readFileSync(target);
      const record = { ...c, file: relative, viewport, pixels: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, ...layout, pageErrors: errors };
      const previous = records.findIndex(r => r.file === relative);
      if (previous >= 0) records.splice(previous, 1, record); else records.push(record);
      await context.close();
      console.log(`Captured ${relative} (${record.pixels.width} x ${record.pixels.height})`);
      // Preserve completed captures if a later scenario fails.
      const ordered = records.sort((a, b) => a.device.localeCompare(b.device) || a.id.localeCompare(b.id));
      fs.writeFileSync(manifestPath, JSON.stringify({ capturedDate: '2026-10-31', referenceSourceCommit: provenance.source_commit, browser: `Chromium ${browser.version()}`, playwrightVersion: require(moduleRoot ? path.join(moduleRoot, 'playwright/package.json') : 'playwright/package.json').version, language: 'Original German prototype; production must offer English default and German.', expectedCaptureCount: cases.length, completedCaptureCount: records.length, normalization: ['Fresh browser context for every scenario; original seeded demo data.', 'Automatic one-second demo interval disabled; explicit simulation buttons remain functional.', 'Reduced motion, disabled screenshot animations, hidden caret and transient toast, instant scrolling.', 'No changes to prototype assets, page text, amounts, event records or application layout.'], limitations: ['Static prototype reference captures, not product acceptance, live-provider, security, MCP or performance tests.', 'Desktop and mobile sizes are representative; no claim of exhaustive device/browser coverage.', 'Full-page captures include the complete page; viewport captures of scrollable drawers show the named position.', 'Google Fonts requires network access when not cached.'], screenshots: ordered }, null, 2) + '\n');
    }
    writeIndex(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });

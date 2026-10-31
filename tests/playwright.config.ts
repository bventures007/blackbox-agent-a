import { defineConfig, devices } from '@playwright/test';
export default defineConfig({ testDir: './e2e', timeout: 90_000, retries: 0, reporter: [['list'], ['json', { outputFile: 'evidence/tmp/playwright.json' }]], use: { baseURL: process.env.BBX_API ?? 'http://127.0.0.1:19080', screenshot: 'only-on-failure', locale: 'en-GB' }, outputDir: 'evidence/tmp/playwright-artifacts',
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }, { name: 'mobile', use: { ...devices['Pixel 7'] } }] });

// playwright.gh1231.config.ts
//
// GH-1231 — Analytics V1 owner-screen browser certification only.
// Drives the already-running local stack (Vite :5173 proxying the API), so it
// starts no web server. The default playwright.config.ts is the API e2e
// project (*.e2e.spec.ts, its own :3000 server) and is not used here.
//
// Owner terminal, with the local stack running:
//   LASYNCRO_E2E_EMAIL=… LASYNCRO_E2E_PASSWORD=… \
//     npx --no-install playwright test --config=playwright.gh1231.config.ts
//
// Credentials come only from the environment; missing credentials fail.
// Screenshots + measurement JSON: test-results/gh1231/ · report: playwright-report/gh1231/

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'wms-analytics-gh1231.browser.spec.ts',
  outputDir: 'test-results/gh1231',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report/gh1231', open: 'never' }]],
  use: { baseURL: 'http://localhost:5173', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});

// playwright.gh1241.config.ts
//
// GH-1241 S3-C — full Receive v2 operator journey, browser certification only.
// Drives the already-running local stack (Vite :5173 proxying the API :3000,
// local synchroflow_db). Starts no web server. Separate from the default
// playwright.config.ts (API e2e) and from playwright.gh1231.config.ts.
//
// Owner terminal, with the local stack running (credentials and the read-only
// evidence connection come only from the environment; nothing is printed):
//   set -a; . ~/.config/lasyncro/gh1241-local-e2e.env; . ./.env; set +a
//   npx --no-install playwright test --config=playwright.gh1241.config.ts
//
// Artifacts are retained per run and never overwritten:
//   test-results/gh1241/runs/<run id>/{screens,evidence,traces,playwright}/ ·
//   report: playwright-report/gh1241/<run id>/
// Traces are recorded by the spec after login and stored only once secrets
// (password, bearer/JWT, session cookies) are scrubbed and proven absent.

import { defineConfig, devices } from '@playwright/test';
import fs from 'fs';
import path from 'path';

// Evaluated once in the runner, then inherited by the worker processes.
if (!process.env.GH1241_RUN_ID) {
  const runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
  if (fs.existsSync(path.join('test-results', 'gh1241', 'runs', runId))) throw new Error(`GH-1241 run ${runId} already exists`);
  process.env.GH1241_RUN_ID = runId;
}
const RUN_ID = process.env.GH1241_RUN_ID;

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'receive-v2-gh1241.browser.spec.ts',
  outputDir: path.join('test-results', 'gh1241', 'runs', RUN_ID, 'playwright'),
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list'], ['html', { outputFolder: path.join('playwright-report', 'gh1241', RUN_ID), open: 'never' }]],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:5173',
    viewport: { width: 1440, height: 900 },
    trace: 'off', // the spec records and scrubs its own per-scenario trace
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});

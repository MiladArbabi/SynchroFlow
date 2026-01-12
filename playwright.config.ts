import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
  },

  projects: [
    {
      name: 'api',
      testMatch: /lifecycle\.e2e\.spec\.ts/,
    },
  ],

  webServer: {
    command: 'npm run dev:api:test',
    url: 'http://localhost:3000',
    timeout: 120_000,
    reuseExistingServer: false,
  },
});
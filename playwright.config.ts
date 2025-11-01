// packages/ui/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

// ... (dotenv comments)

const AUTH_FILE_PATH = 'playwright/.auth/user.json';

export default defineConfig({
  testDir: 'tests',
  // ... (fullyParallel, forbidOnly, etc.)
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },

  /* Configure projects */
  projects: [
    /* 1. SETUP PROJECT */
    // This project runs first, authenticates, and creates the auth file.
    {
      name: 'setup',
      testMatch: /auth\.setup\.spec\.ts/, // Correctly points to our setup test
    },

    /* 2. AUTHENTICATED PROJECTS */
    // These projects run all tests *except* the auth flow test.
    // They *depend on* setup and *use* the saved auth state.
    {
      name: 'chromium-auth',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_FILE_PATH,
      },
      dependencies: ['setup'],
      testIgnore: 'auth.spec.ts',
    },
    {
      name: 'firefox-auth',
      use: {
        ...devices['Desktop Firefox'],
        storageState: AUTH_FILE_PATH,
      },
      dependencies: ['setup'],
      testIgnore: 'auth.spec.ts', 
    },
    {
      name: 'webkit-auth',
      use: {
        ...devices['Desktop Safari'],
        storageState: AUTH_FILE_PATH,
      },
      dependencies: ['setup'],
      testIgnore: 'auth.spec.ts', //
    },

    /* 3. UNAUTHENTICATED PROJECTS */
    // These projects run *only* the auth flow test.
    // They do *not* depend on setup and do *not* use any auth state.
    {
      name: 'chromium-noauth',
      use: { ...devices['Desktop Chrome'] },
      testMatch: 'auth.spec.ts', // <-- ONLY run the auth test
    },
    {
      name: 'firefox-noauth',
      use: { ...devices['Desktop Firefox'] },
      testMatch: 'auth.spec.ts', // <-- ONLY run the auth test
    },
    {
      name: 'webkit-noauth',
      use: { ...devices['Desktop Safari'] },
      testMatch: 'auth.spec.ts ', // <-- ONLY run the auth test
    },

    /* Note: The old 'chromium', 'firefox', and 'webkit' projects are now replaced by the '...-auth' and '...-noauth' variants. */
  ],

  /* Web Server config remains the same */
  webServer: {
    command: 'npm run dev:full -- --mode e2e',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120 * 1000,
  },
});
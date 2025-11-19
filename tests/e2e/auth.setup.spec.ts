// tests/e2e/auth.setup.spec.ts
import { test as setup, expect } from '@playwright/test';
import { FullConfig } from '@playwright/test';

// (Prerequisite) - Use the same test user from your seed file
const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
};
const AUTH_FILE_PATH = 'playwright/.auth/user.json';

setup('E2E Setup: Authenticate Test User', async ({ page, baseURL }) => {  // 1. Go to the login page (baseURL is automatically picked from config)
  // 1. Go to the login page (baseURL is automatically picked from config)
  await page.goto(`${baseURL}/login`);

  // 2. Perform the login
  await page.getByLabel('Email Address / Username').fill(TEST_USER.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER.password);
  await page.getByRole('button', { name: /Sign In/i }).click();

  // Add a reliable assertion to ensure login was successful before saving state
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });

  // 3. Save the authenticated state
  await page.context().storageState({ path: AUTH_FILE_PATH });

  console.log(`E2E Setup: Successfully logged in and saved auth state to ${AUTH_FILE_PATH}`);
});
// tests/e2e/auth.setup.spec.ts
import { test as setup, expect } from '@playwright/test';

const TEST_USER = {
  email: 'test@example.com',
  password: 'password123',
};

const AUTH_FILE_PATH = 'playwright/.auth/user.json';

setup('E2E Setup: Authenticate Test User', async ({ page, baseURL }) => {
  await page.goto(`${baseURL}/login`);

  await page.getByLabel('Email Address / Username').fill(TEST_USER.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER.password);
  await page.getByRole('button', { name: /Sign In/i }).click();

  await page.waitForLoadState('networkidle');

  // Backend-authenticated invariant
  const lifecycle = await page.context().request.get('/api/v1/lifecycle');
  expect(lifecycle.ok()).toBeTruthy();

  await page.context().storageState({ path: AUTH_FILE_PATH });

  console.log(`E2E auth state saved → ${AUTH_FILE_PATH}`);
});
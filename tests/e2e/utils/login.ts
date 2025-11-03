// tests/e2e/utils/login.ts
import { Page, expect } from '@playwright/test';
import { TEST_USERS, TestUserKey } from './test-users';

/**
 * A reusable utility to log in as a specific test user.
 * Assumes the page is not already logged in.
 */
export async function loginAs(page: Page, userKey: TestUserKey) {
  const user = TEST_USERS[userKey];
  if (!user) {
    throw new Error(`Test user '${userKey}' not found in test-users.ts`);
  }

  // Start at the login page
  await page.goto('/login');
  
  // Fill in credentials
  await page.getByLabel('Email Address / Username').fill(user.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(user.password);
  
  // Click Sign In
  await page.getByRole('button', { name: /Sign In/i }).click();

  // Wait for the redirect to the dashboard and ensure it's loaded
  await page.waitForURL('**/dashboard');
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
}
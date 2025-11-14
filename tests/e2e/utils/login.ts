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

  // Wait for the redirect to the dashboard
  await page.waitForURL('**/dashboard');
  
  // Wait for the page to be fully loaded by checking multiple elements
  // This is more robust than waiting for a single specific element
  
  // Wait for either the ConnectStoreBanner OR dashboard content to be visible
  const connectStoreBanner = page.locator('[data-testid="connect-store-banner"]');
  const dashboardContent = page.locator('h3:has-text("Your Dashboard")');
  
  // Use a loop to check for either element with a timeout
  const startTime = Date.now();
  const timeout = 10000;
  
  while (Date.now() - startTime < timeout) {
    if (await connectStoreBanner.isVisible() || await dashboardContent.isVisible()) {
      console.log('✅ Dashboard loaded successfully');
      return;
    }
    await page.waitForTimeout(100); // Small delay between checks
  }
  
  // If we get here, neither element was found within timeout
  throw new Error('Dashboard did not load within expected time');
}
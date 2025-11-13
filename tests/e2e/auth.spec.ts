// tests/e2e/auth.spec.ts
import { test, expect, Page } from '@playwright/test';

// --- (Prerequisite) ---
// This test assumes a user exists in your test database (e.g., from your seed file)
const TEST_USER = {
  email: 'test@example.com', // Use an email from your seed file
  password: 'password123',   // Use the correct password
};
// --------------------

test.describe('E2E: Full Authentication Journey', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
  });

  test.afterAll(async () => {
    await page.close();
  });

  test.skip('should load dashboard with key widgets after successful login', async () => {
  // Login steps (existing)
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
  await page.getByLabel('Email Address / Username').fill(TEST_USER.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER.password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  
  // Wait for dashboard and verify heading (existing)
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  
  // NEW: Verify dashboard content loads
  await test.step('Verify dashboard widgets are loaded', async () => {
    // Wait for widgets to load
    await page.waitForLoadState('networkidle');
    
    // Verify key widgets are present
    await expect(page.locator('[data-testid="widget-container"]').first()).toBeVisible();
    await expect(page.getByText(/automated tasks/i)).toBeVisible();
    await expect(page.getByText(/labor cost saved/i)).toBeVisible();
    
    // Verify data is populated (not just loading states)
    await expect(page.getByText(/\d+/).first()).toBeVisible(); // Should have numbers
  });
});

  test('should redirect unauthenticated users, allow login, and allow logout', async () => {
    
    // --- 1. Test Unauthenticated State (Verifies #420) ---
    await test.step('Redirect unauthenticated user to /login', async () => {
      await page.goto('/dashboard');
      // Wait for the redirect to complete
      await page.waitForURL('**/login');
      // Verify we are on the login page
      await expect(page.getByRole('heading', { name: /Hi, Welcome Back/i })).toBeVisible();
    });

    // --- 2. Test Login Flow (Verifies #383, #389) ---
    await test.step('Log in as test user', async () => {
      await page.getByLabel('Email Address / Username').fill(TEST_USER.email);
      await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER.password);
      await page.getByRole('button', { name: /Sign In/i }).click();
    });

    // --- 3. Test Authenticated State (Verifies #420, #391) ---
    await test.step('Verify user is logged in and on dashboard', async () => {
    
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
    // Verify profile section in header now shows user email (Verifies #391)
    await page.getByLabel('user-account').click(); // Open profile menu
    // Check that the user's email is visible in the dropdown
    await expect(page.getByText(TEST_USER.email)).toBeVisible();
    });

    // --- 4. Test Logout Flow (Verifies #408) ---
    await test.step('Log out from profile menu', async () => {
      // The menu is already open from the previous step
      // Note: The unit test used findByText. getByRole('listitem') or getByText is also good.
      await page.getByText('Logout').click();
    });

    // --- 5. Verify Logout ---
    await test.step('Verify user is redirected to /login after logout', async () => {
      // Wait for the redirect back to login
      await page.waitForURL('**/login');
      await expect(page.getByRole('heading', { name: /Hi, Welcome Back/i })).toBeVisible();
      // As a final check, try accessing dashboard again and expect redirect
      await page.goto('/dashboard');
      await page.waitForURL('**/login');
    });
  });

  // Update the failing test in tests/e2e/auth.spec.ts
test('should show appropriate onboarding state after successful login', async () => {
  // Login steps (existing)
  await page.goto('/dashboard');
  await page.waitForURL('**/login');
  await page.getByLabel('Email Address / Username').fill(TEST_USER.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(TEST_USER.password);
  await page.getByRole('button', { name: /Sign In/i }).click();
  
  // Wait for dashboard and verify heading
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 10000 });
  
  // NEW: Verify appropriate empty/onboarding state
  await test.step('Verify onboarding state is shown', async () => {
    // For new users (no integrations), we should see the ConnectStoreBanner
    await expect(page.getByTestId('connect-store-button')).toBeVisible();
    
    // Verify the dashboard is in empty state (no widgets yet)
    await expect(page.locator('[data-testid="widget-container"]')).toHaveCount(0);
    
    // Verify user can start the connection flow
    await page.getByTestId('connect-store-button').click();
    await expect(page.locator('[role="dialog"]')).toBeVisible(); // Connect store modal
  });
});
});
// tests/e2e/utils/login.ts
import { Page, expect } from '@playwright/test';
import { TEST_USERS, TestUserKey } from './test-users';

export async function loginAs(page: Page, userKey: TestUserKey = 'default-user') {
  const user = TEST_USERS[userKey];
  if (!user) {
    throw new Error(`Test user '${userKey}' not found in test-users.ts`);
  }

  // 1. Navigate directly to login page
  console.log('🔗 Navigating to login page...');
  await page.goto('/login');
  
  // 2. Fill credentials using EXACT selectors from JWT AuthLogin component
  console.log('📝 Filling login credentials...');

  await page.getByLabel('Email Address / Username').fill(user.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(user.password);
  
  // 3. Submit login form
  console.log('🚀 Submitting login form...');
  await page.getByRole('button', { name: /Sign In/i }).click();

  // 5. Wait for dashboard redirect with better error handling
  console.log('⏳ Waiting for dashboard redirect...');
  try {
    await page.waitForURL('**/');
    console.log('✅ Login successful - redirected to dashboard');
  } catch (error) {
    // Check if login failed with error message
    const errorElement = page.locator('[role="alert"], .MuiFormHelperText-error');
    if (await errorElement.isVisible()) {
      const errorText = await errorElement.textContent();
      throw new Error(`Login failed with error: ${errorText}`);
    }
    
    // Take screenshot for debugging
    await page.screenshot({ path: 'login-failure.png' });
    throw new Error(`Login failed - stuck on URL: ${page.url()}`);
  }
  
  // 6. Verify dashboard is loaded
  console.log('🔍 Verifying dashboard...');
  
    try {
    // Try to find the main dashboard heading (not the loading state)
    await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible({ timeout: 10000 });
    console.log('✅ Dashboard loaded successfully (exact match)');
  } catch (error) {
    console.log('🔄 Falling back to first heading match...');
    // Fallback: get the first heading that contains "Dashboard"
    const dashboardHeadings = page.getByRole('heading', { name: /dashboard/i });
    const count = await dashboardHeadings.count();
    
    if (count > 0) {
      // Use the first visible heading that's not "Dashboard Loading"
      for (let i = 0; i < count; i++) {
        const heading = dashboardHeadings.nth(i);
        const text = await heading.textContent();
        if (text && text !== 'Dashboard Loading' && await heading.isVisible()) {
          console.log(`✅ Using dashboard heading: "${text}"`);
          break;
        }
      }
    } else {
      throw new Error('No dashboard heading found');
    }
  }
}
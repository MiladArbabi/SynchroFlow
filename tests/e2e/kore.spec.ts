import { test, expect } from '@playwright/test';
import { loginAs } from './utils/login';

test.describe('Kore OpsCommandCenter Integration', () => {

  test('should replace the old placeholder and be collapsed by default', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Assert the OLD placeholder is gone (this should pass)
    await expect(
      page.getByText('Ops Console Placeholder'),
    ).not.toBeVisible();

    // 2. Assert the NEW panel container is NOT in the DOM
    await expect(
      page.getByTestId('ops-command-center-panel'),
    ).not.toBeVisible(); // .not.toBeVisible() also checks for non-existence
  });

  test('should open, search, execute, and navigate *without* reloading', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 2. Type and execute
    await page.getByTestId('kore-command-input').fill('Orders');
    await expect(page.getByText('View Orders')).toBeVisible();
    await page.keyboard.press('Enter');

    // 3. Verify navigation
    await page.waitForURL('**/orders');
    await expect(page).toHaveURL(/.*orders/);
    
    // 4. --- THIS IS THE "RED" STEP ---
    // Assert that the console is *still open* after navigation.
    // This will fail because the page reload unmounted it.
    await expect(page.getByTestId('kore-command-input')).toBeVisible();
  });
});
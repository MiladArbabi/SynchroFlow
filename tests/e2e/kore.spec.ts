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

  test('should open, search, execute, and navigate', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Verify it's closed
    await expect(page.getByTestId('ops-command-center-panel')).not.toBeVisible();

    // 2. Get modifier and press hotkey
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);

    // 3. Verify it's open by looking for the INPUT
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 4. Type into the input
    await page.getByTestId('kore-command-input').fill('Orders');

    // 5. See the result
    await expect(page.getByText('View Orders')).toBeVisible();

    // 6. Execute the result (press Enter)
    await page.keyboard.press('Enter');

    // 7. Check for the *result* (navigation), not the toast.
    // We'll wait for the URL to change to '/orders'.
    await page.waitForURL('**/orders');
    await expect(page).toHaveURL(/.*orders/);
  });
});
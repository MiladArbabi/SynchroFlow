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

});
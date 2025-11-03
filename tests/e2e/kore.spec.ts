import { test, expect } from '@playwright/test';
import { loginAs } from './utils/login';

test.describe('Kore OpsCommandCenter Integration', () => {

  test('should replace the old placeholder and be collapsed by default', async ({ page }) => {
    // 1. Log in
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 2. This is the "Red" test that will fail.
    // We assert the OLD placeholder is NOT visible.
    // It will fail because the placeholder IS currently visible.
    await expect(
      page.getByText('Ops Console Placeholder'),
    ).not.toBeVisible();
  });

});
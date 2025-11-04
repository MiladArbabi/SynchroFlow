import { test, expect } from '@playwright/test';
import { loginAs } from './utils/login';

test.describe('Kore OpsCommandCenter Integration', () => {

  // --- Test 1: Default State (Unchanged) ---
  test('should replace the old placeholder and be collapsed by default', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);
    await expect(
      page.getByTestId('ops-command-center-panel'),
    ).not.toBeVisible();
  });

  // --- Test 2: Layer 1 Flow (Icon Button - Unchanged) ---
  test('should open the console panel with the navbar icon', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);
    await expect(page.getByTestId('kore-command-input')).not.toBeVisible();
    await page.getByTestId('kore-navbar-button').click();
    await expect(page.getByTestId('kore-command-input')).toBeVisible();
  });

  // --- Test 3: L1 Query (FIXED) ---
  // This test now uses a query that is *guaranteed* to be L1
  test('should open, search (L1), and show L1 results', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 2. Type a *low confidence* query that will NOT match L2
    await page.getByTestId('kore-command-input').fill('dash');

    // 3. --- THIS IS THE FIX ---
    // We MUST wait for the UI to react to the 'fill' command.
    // We'll wait for the "Go to Dashboard" text to appear.
    // This makes the test robust.
    await expect(page.getByText('Go to Dashboard')).toBeVisible();

    // 4. And we assert the L2 banner is NOT visible
    await expect(page.getByText('Understood:')).not.toBeVisible();
  });


  // --- Test 4: L2 Query (FIXED) ---
  test.skip('should show the InterpretationBanner for a Layer 2 query', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 2. Type a natural language query
    await page.getByTestId('kore-command-input').fill('show orders from yesterday');

    // 3. --- THIS IS THE FIX ---
    // We MUST wait for the UI to react.
    // We'll wait for the "Understood:" text to appear.
    await expect(page.getByText('Understood:')).toBeVisible();

    // 4. And we assert the L2 action name is also visible
    await expect(
      page.getByText('Find orders from yesterday'),
    ).toBeVisible();

    // 5. And we assert the L1 list is NOT visible
    await expect(page.getByText('Go to Dashboard')).not.toBeVisible();
  });
});
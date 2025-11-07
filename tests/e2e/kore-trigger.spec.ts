// e2e/tests/kore-trigger.spec.ts
import { test, expect } from '@playwright/test';

test.describe('KoreTrigger E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to dashboard where KoreTrigger is present
    await page.goto('/dashboard');
  });

  test('should render KoreTrigger and be visible', async ({ page }) => {
    const koreTrigger = page.locator('[data-testid="kore-navbar-button"]');
    
    await expect(koreTrigger).toBeVisible();
    await expect(koreTrigger).toHaveAttribute('data-testid', 'kore-navbar-button');
  });

  test('should not be a button element', async ({ page }) => {
    const koreTrigger = page.locator('[data-testid="kore-navbar-button"]');
    
    // Avatar should render as div, not button
    await expect(koreTrigger).not.toHaveRole('button');
    await expect(koreTrigger).toHaveCount(1);
  });

  test('should open OpsCommandCenter when clicked', async ({ page }) => {
    const koreTrigger = page.locator('[data-testid="kore-navbar-button"]');
    const commandCenterInput = page.locator('input[placeholder*="Ask Kore anything... (Try: refund last order or show stale orders)"]');
    
    // Initially hidden
    await expect(commandCenterInput).not.toBeVisible();
    
    // Click trigger
    await koreTrigger.click();
    
    // Should become visible
    await expect(commandCenterInput).toBeVisible();
  });

  test('should have proper tooltip on hover', async ({ page }) => {
    const koreTrigger = page.locator('[data-testid="kore-navbar-button"]');
    
    // Hover over the trigger
    await koreTrigger.hover();
    
    // Wait for tooltip to appear and check content
    const tooltip = page.getByRole('tooltip');
    await expect(tooltip).toBeVisible();
    await expect(tooltip).toHaveText('Open Kore Command (Cmd+J)');
  });
});
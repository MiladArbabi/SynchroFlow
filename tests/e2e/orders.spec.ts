// Create tests/e2e/orders.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Orders API E2E Tests', () => {
  test('should display orders list on orders page', async ({ page }) => {
    // Navigate to orders page
    await page.goto('/orders');
    
    // Check if orders page loads
    await expect(page.locator('.MuiTypography-h5:has-text("Orders")')).toBeVisible();
    
    // Check if DataGrid is present
    await expect(page.locator('[role="grid"]')).toBeVisible();
    
    // Check if there are order rows
    const rows = page.locator('[role="row"]:not([aria-rowindex="1"])');
    await expect(rows).toHaveCount(7); // Should have 7 orders
  });

  test('should show order details when clicking on order', async ({ page }) => {
    // Navigate to orders page
    await page.goto('/orders');
    
    // Wait for rows to load
    await page.waitForSelector('[role="row"]:not([aria-rowindex="1"])');
    
    // Click on first order row (skip header)
    await page.locator('[role="row"]:not([aria-rowindex="1"])').first().click();
    
    // Check if we navigated to order details page
    await expect(page).toHaveURL(/\/orders\//);
    
    // Check if order detail content loads
    await expect(page.locator('h4:has-text("Order #")')).toBeVisible();
  });
});
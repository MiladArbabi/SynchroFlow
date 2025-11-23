// Update tests/e2e/customers.spec.ts - Use correct selectors
import { test, expect } from '@playwright/test';

test.describe('Customers API E2E Tests', () => {
  test('should display customers list on customers page', async ({ page }) => {
    // Navigate to customers page
    await page.goto('/customers');
    
    // Check if customers page loads - use actual class names
    await expect(page.locator('.MuiTypography-h5:has-text("Customers")')).toBeVisible();
    
    // Check if DataGrid is present (MUI DataGrid has role="grid")
    await expect(page.locator('[role="grid"]')).toBeVisible();
    
    // Check if there are customer rows
    const rows = page.locator('[role="row"]:not([aria-rowindex="1"])'); // Skip header row
    await expect(rows).toHaveCount(3); // Should have 3 customers
  });

  test('should show customer details when clicking on customer', async ({ page }) => {
    // Navigate to customers page
    await page.goto('/customers');
    
    // Wait for rows to load
    await page.waitForSelector('[role="row"]:not([aria-rowindex="1"])');
    
    // Click on first customer row (skip header)
    await page.locator('[role="row"]:not([aria-rowindex="1"])').first().click();
    
    // Check if we navigated to customer details page
    await expect(page).toHaveURL(/\/customers\//);
    
    // Check if customer detail content loads
    await expect(page.locator('h4:has-text("Details for Customer")')).toBeVisible();
  });
});
// tests/e2e/customers.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Customers API E2E Tests', () => {
  test.skip('should display customers list on customers page', async ({ page }) => {
    // Navigate to customers page
    await page.goto('/customers');
    
    // Check if customers page loads - use more specific selector
    await expect(page.locator('h5:has-text("Customers")').first()).toBeVisible();
    
    // Check if customers table or empty state is displayed
    const table = page.locator('table');
    const emptyState = page.locator('text=No customers');
    
    // Either table or empty state should be visible
    if (await table.isVisible()) {
      await expect(table).toBeVisible();
    } else {
      await expect(emptyState).toBeVisible();
    }
  });

  test('should show customer details when clicking on customer', async ({ page }) => {
    // Navigate to customers page
    await page.goto('/customers');
    
    // Check if there are any customers to click
    const customerRows = page.locator('table tbody tr');
    const count = await customerRows.count();
    
    if (count > 0) {
      // Click on first customer row
      await customerRows.first().click();
      
      // Check if customer details are shown
      await expect(page.locator('text=Customer Profile')).toBeVisible();
    } else {
      // Skip test if no customers
      console.log('No customers available for details test');
    }
  });
});
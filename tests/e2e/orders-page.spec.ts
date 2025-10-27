// tests/e2e/orders-page.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Orders Page', () => {
  // Mock the API response for the orders list
  test.beforeEach(async ({ page }) => {
    await page.route(/.*\/api\/v1\/orders/, async (route) => {
      console.log(`[TEST MOCK] Intercepted: ${route.request().url()}`);
      const mockOrders = [
        { id: '1001', customer_name: 'Alice Smith (Mock)', total: 50.00, status: 'Pending', created_at: new Date() },
        { id: '1002', customer_name: 'Bob Johnson (Mock)', total: 75.50, status: 'Shipped', created_at: new Date() },
      ];
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: mockOrders,
      });
    });
  });

  test('should display a list of orders and allow navigation', async ({ page }) => {
    // 1. Navigate to the orders page
    await page.goto('/orders');

    // 2. Wait for loading to finish
    await expect(page.getByRole('progressbar')).not.toBeVisible();

    // 3. Check that the page title "Orders" is visible
    await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

    // 4. Check that our mock data is visible in the grid
    await expect(page.getByText('Alice Smith (Mock)')).toBeVisible();
    await expect(page.getByText('Bob Johnson (Mock)')).toBeVisible();

    // 5. Test the row click navigation
    await page.getByRole('gridcell', { name: 'Alice Smith (Mock)' }).click();

    // 6. Assert the URL changed to the correct Order 360 page
    await expect(page).toHaveURL(/.*\/orders\/1001/);
  });
});
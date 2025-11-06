// tests/e2e/order-360-page.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Order 360 Page', () => {
  // Mock the new consolidated API response
  test.beforeEach(async ({ page }) => {
    await page.route(/.*\/api\/v1\/orders\/1001/, async (route) => {
      //console.log(`[TEST MOCK] Intercepted: ${route.request().url()}`);
      
      const mockOrderDetails = {
        id: '1001',
        status: 'Picking',
        profitability: {
          orderId: '1001',
          revenue: 149.99,
          cogs: 62.50,
          shippingCost: 12.00,
          fees: 4.50,
          margin: 70.99,
          marginPercent: 47.3 // Key metric
        },
        customer: {
          profile: {
            name: 'John Doe (Mock)',
            email: 'john.doe.mock@example.com',
          },
          metrics: {
            ltv: 1204.50,
            aov: 110.40,
            totalOrders: 11,
          }
        }
      };
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: mockOrderDetails,
      });
    });
  });

  test('should display consolidated order data from a single API call', async ({ page }) => {
    // 1. Navigate to the order 360 page
    await page.goto('/orders/1001');

    // 2. Wait for loading to finish
    await expect(page.getByRole('progressbar')).not.toBeVisible();

    // 3. Check that the page title is correct
    await expect(page.getByRole('heading', { name: 'Order #1001' })).toBeVisible();

    // 4. Check for data from all parts of the response
    
    // Check for status
    await expect(page.getByText('Picking')).toBeVisible();

    // Check for customer profile data
    await expect(page.getByText('John Doe (Mock)')).toBeVisible();

    // Check for customer metric data (ltv is a good one)
    await expect(page.getByTestId('metric-ltv')).toContainText('$1,205'); // Rounded

    // Check for profitability data using the test ID
    const marginElement = page.getByTestId('profitability-margin');
    await expect(marginElement).toBeVisible();
    await expect(marginElement).toContainText('47%');
  });
});
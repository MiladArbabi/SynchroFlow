// tests/e2e/customer-360.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Customer 360 Page', () => {

// --- THIS IS THE NEW, ROBUST SETUP ---
  test.beforeEach(async ({ page }) => {
    // 1. MOCK THE SUCCESSFUL API CALL (for John Doe / cust_abc)
    await page.route(/.*\/api\/v1\/customers\/cust_abc/, async (route) => {
      console.log(`[TEST MOCK] Intercepted: ${route.request().url()}`);
      const mockSuccessData = {
        id: 'cust_abc',
        profile: {
          name: 'John Doe',
          email: 'john.doe@example.com',
          joinedDate: '2024-01-15T10:00:00Z',
        },
        metrics: {
          ltv: 5200,
          aov: 150.50,
          totalOrders: 34,
          totalMargin: 1200,
          lastOrderDate: '2025-10-20T14:00:00Z',
        },
      };
      
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: mockSuccessData,
      });
    });

    // 2. MOCK THE FAILED API CALL (for Jane Smith / cust_def)
   await page.route(/.*\/api\/v1\/customers\/cust_def/, async (route) => {
      console.log(`[TEST MOCK] Intercepted and FAKING 404: ${route.request().url()}`);
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        json: { message: 'Customer with ID cust_def not found' },
      });
    });
  });
  // --- END OF NEW SETUP ---

  test('should load customer details for a valid customer (John Doe)', async ({ page }) => {
    await page.goto('/customers/cust_abc');
    /* await page.goto('/customers');
    await expect(page.getByRole('heading', { name: 'Customers' })).toBeVisible();
    await page.getByRole('gridcell', { name: 'John Doe' }).click(); */

    await expect(page).toHaveURL(/.*\/customers\/cust_abc/);

    // Check that loading is finished and no error is shown
    await expect(page.getByRole('progressbar')).not.toBeVisible();
    await expect(page.getByRole('alert')).not.toBeVisible();

    // Check for profile data from our mock
    await expect(page.getByText('john.doe@example.com')).toBeVisible();
    
    // 1. Locate the key metrics using their test IDs
    const ltv = page.getByTestId('metric-ltv');
    const aov = page.getByTestId('metric-aov');
    const totalOrders = page.getByTestId('metric-total-orders');

    // 2. Assert they are visible and contain expected formatting
    await expect(ltv).toBeVisible();
    await expect(ltv).toContainText('$');
    await expect(ltv).toContainText('5,200'); // We can now check the *rounded* mock value

    await expect(aov).toBeVisible();
    await expect(aov).toContainText('$');
    await expect(aov).toContainText('151'); // 150.50 rounded up

    await expect(totalOrders).toBeVisible();
    await expect(totalOrders).toHaveText('34');

    // Check that the order/ticket data from the *mock* is visible
    await expect(page.getByText('Shipped')).toBeVisible();
    await expect(page.getByText('Question about Shipping')).toBeVisible();
  });

  test('should show an error message for an invalid customer (Jane Smith)', async ({ page }) => {
    await page.goto('/customers/cust_def');
    await expect(page).toHaveURL(/.*\/customers\/cust_def/);
    
    // 1. Find the error alert by its accessible role.
    const errorAlert = page.getByRole('alert');

    // 2. Assert that the alert container is visible.
    await expect(errorAlert).toBeVisible();
    
    // 3. Assert that it contains the static text from your component.
    await expect(errorAlert).toContainText('Failed to load customer data:');

    // 4. NOW that we know the error is visible, we can
    await expect(page.getByRole('progressbar')).not.toBeVisible();
    await expect(page.getByTestId('metric-ltv')).not.toBeVisible();
  });
});
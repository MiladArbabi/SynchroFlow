// tests/e2e/dashboard-page.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Dashboard Page', () => {

  // Mock the necessary API responses
  test.beforeEach(async ({ page }) => {
    // 1. Mock the ops-intel summary
    await page.route(/.*\/api\/v1\/ops-intel\/summary/, async (route) => {
      //console.log(`[TEST MOCK] Intercepted: ${route.request().url()}`);
      const mockData = {
        automated_tasks: 5500, // Use distinct values for testing
        labor_cost_saved: 9250.50
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        json: mockData,
      });
    });

    // 2. Mock the layout API (return empty for default layout)
    //    Or provide a specific layout if needed for widget placement tests
    await page.route(/.*\/api\/v1\/layouts\/dashboard/, async (route) => {
        //console.log(`[TEST MOCK] Intercepted: ${route.request().url()}`);
        await route.fulfill({
            status: 404, // Simulate no saved layout initially
        });
        // Alternatively, return a 200 with specific layout/widgets:
        /*
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            json: { layout: initialLayout, activeWidgets: initialActiveWidgets }, // Assuming these are exported or defined
        });
        */
    });

    // 3. Mock any other APIs the *default* dashboard widgets might call
    //    (e.g., inventory health, cashflow data - returning empty/mock for now)
    await page.route(/.*\/api\/v1\/analytics\/inventory-health/, async (route) => {
         //console.log(`[TEST MOCK] Intercepted: ${route.request().url()}`);
         await route.fulfill({ status: 200, contentType: 'application/json', json: [] }); // Empty data for inventory health
    });
     // Add mocks for cashflow chart data if it makes API calls
  });

  test('should display Ops-Intel data in the A-Opex Gauge', async ({ page }) => {
    // 1. Navigate to the dashboard page
    await page.goto('/'); // Assuming dashboard is the root path

    // 2. Wait for loading indicators potentially related to useQuery
    //    A better approach is to wait for specific content to appear.
    // await expect(page.getByRole('progressbar')).not.toBeVisible({ timeout: 10000 }); // Increase timeout if needed

    // 3. Check for a key piece of static content to ensure page loaded
     await expect(page.getByText('Gross Revenue')).toBeVisible(); // Check for a KPI card title

    // 4. Check for the Ops-Intel data within the A-Opex Gauge
    //    NOTE: This depends heavily on how A-Opex Gauge renders the value.
    //    We need a robust selector (like a data-testid) in that widget.
    //    For now, let's assume it renders the formatted currency.

    //    >>> Add a data-testid="aopex-value" to the element displaying the value in AopexGaugeWidget.tsx <<<
    const aopexValue = page.getByTestId('aopex-value');
    await expect(aopexValue).toBeVisible();
    await expect(aopexValue).toContainText('$9,251'); // Check for the rounded, formatted value from our mock
  });
});
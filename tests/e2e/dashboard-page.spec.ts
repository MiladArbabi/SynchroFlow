// tests/e2e/dashboard-page.spec.ts
import { test, expect } from '@playwright/test';

// This is the ONLY describe block in this file.
test.describe('Dashboard Page (Authenticated)', () => {

  // --- MOCK ALL 5 WIDGET APIs ---
  test.beforeEach(async ({ page }) => {
    
    // 1. Mock user state for an *existing, connected user*
    await page.route(/.*\/api\/v1\/user-state\/state/, async (route) => {
      await route.fulfill({ 
        json: {
          user: {
            id: 1,
            email: 'test@example.com',
            shopify_connected: true,
            detected_mode: 'survival',
            stripe_connected: false,
          },
          milestones: [{ id: 1, milestone: 'shopify_connected', achieved_at: "2023-01-01T00:00:00.000Z" }],
          current_mode: 'survival'
        }
      });
    });

    // 2. Mock layout API (404 = use default layout)
    await page.route(/.*\/api\/v1\/layouts\/dashboard/, async (route) => {
        await route.fulfill({ status: 404 });
    });

    // 3. Mock Pulse API (Feeds 'cash-flow' and 'order-metrics' widgets)
    await page.route(/.*\/api\/v1\/dashboard\/pulse/, async (route) => {
      await route.fulfill({ status: 200, json: {
        totalRevenue: 125000,
        orderCount: 1460, // AOV will be 125000 / 1460 = $85.61... -> $86
        unfulfilledCount: 15 
      }});
    });

    // 4. Mock Inventory Health API (Feeds 'inventory-alerts' widget)
    await page.route(/.*\/api\/v1\/dashboard\/inventory-health/, async (route) => {
      await route.fulfill({ status: 200, json: [
        { id: 'p1', title: 'Low Stock T-Shirt', total_inventory: 5 },
        { id: 'p2', title: 'Out of Stock Jeans', total_inventory: 0 }
      ]});
    });

    // 5. Mock Top Products API (Feeds 'top-products' widget)
    await page.route(/.*\/api\/v1\/dashboard\/top-products/, async (route) => {
      await route.fulfill({ status: 200, json: [
        { id: 'p3', title: 'Best-Seller Jacket', totalSold: 500 },
        { id: 'p4', title: 'Popular Hat', totalSold: 350 },
      ]});
    });

    // 6. Mock Traffic Source API (Feeds 'sales-by-traffic-source' widget)
    await page.route(/.*\/api\/v1\/dashboard\/sales-by-traffic-source/, async (route) => {
      await route.fulfill({ status: 200, json: [
        { source: 'google.com', totalRevenue: 50000, orderCount: 500 },
        { source: 'facebook.com', totalRevenue: 25000, orderCount: 300 }
      ]});
    });
  });


  // --- OUR TEST FOR #731 ---
  // We expect this test to FAIL (RED) until we get the correct selectors
  test('should load dashboard with all 5 Starter Plan widgets and no "Connect" banner', async ({ page }) => {
    // 1. Navigate to the dashboard (we are already logged in via setup)
    await page.goto('/dashboard');

    // 2. Verify the "Connect Store" banner is GONE
    await expect(page.locator('[data-testid="connect-store-banner"]')).toBeHidden();

    // 3. Verify all 5 widgets are visible and have finished loading
    
    // --- Widget 1: Cash Flow ---
    const cashFlowWidget = page.locator('[data-testid="widget-cash-flow"]');
    await expect(cashFlowWidget).toBeVisible(); // <-- This is the line that fails
    await expect(cashFlowWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
    await expect(cashFlowWidget.getByText('$125,000')).toBeVisible(); 

    // --- Widget 2: Order Metrics ---
    const orderMetricsWidget = page.locator('[data-testid="widget-order-metrics"]');
    await expect(orderMetricsWidget).toBeVisible();
    await expect(orderMetricsWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
    await expect(orderMetricsWidget.getByText('1460')).toBeVisible();
    await expect(orderMetricsWidget.getByText('$86')).toBeVisible(); 

    // --- Widget 3: Inventory Alerts ---
    const inventoryWidget = page.locator('[data-testid="widget-inventory-alerts"]');
    await expect(inventoryWidget).toBeVisible();
    await expect(inventoryWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
    await expect(inventoryWidget.getByText('Low Stock T-Shirt')).toBeVisible();
    await expect(inventoryWidget.getByText('Out of Stock Jeans')).toBeVisible();

    // --- Widget 4: Top Selling Products ---
    const topProductsWidget = page.locator('[data-testid="widget-top-products"]');
    await expect(topProductsWidget).toBeVisible();
    await expect(topProductsWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
    await expect(topProductsWidget.getByText('Best-Seller Jacket')).toBeVisible();

    // --- Widget 5: Sales by Traffic Source ---
    const trafficWidget = page.locator('[data-testid="widget-sales-by-traffic-source"]');
    await expect(trafficWidget).toBeVisible();
    await expect(trafficWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
    await expect(trafficWidget.getByText('google.com')).toBeVisible();
  });

});
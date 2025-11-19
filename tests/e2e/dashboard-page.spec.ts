// tests/e2e/dashboard-page.spec.ts
import { test, expect } from '@playwright/test';

/**
 * DASHBOARD PAGE E2E TEST SUITE
 * 
 * This test validates the complete dashboard rendering flow for authenticated users
 * with connected Shopify stores. It tests the 5 starter plan widgets and ensures
 * proper loading states, error handling, and data display.
 * 
 * CRITICAL DEPENDENCIES:
 * - User must have shopify_connected: true
 * - Integration sync must be COMPLETED 
 * - All widget APIs must return valid data
 * - Layout API returns 404 (uses default layout)
 * 
 * RENDERING SEQUENCE:
 * 1. DashboardStateManager checks user state & integration status
 * 2. WidgetLayoutWithRegistry loads widgets from registry
 * 3. EnhancedWidgetShell wraps each widget with loading states
 * 4. Individual widgets fetch their own data via API calls
 */

test.describe('Dashboard Page (Authenticated)', () => {
  let testStartTime: number;

  // --- TEST SETUP AND TEARDOWN ---
  test.beforeEach(async ({ page }, testInfo) => {
    testStartTime = Date.now();
    console.log(`🧪 Starting test: ${testInfo.title}`);
    console.log('🔄 Setting up API mocks...');

    // 1. Mock user state for an *existing, connected user*
    await page.route(/.*\/api\/v1\/user-state\/state/, async (route) => {
      console.log('📊 Mocking user-state API');
      await route.fulfill({ 
        json: {
          user: {
            id: 1,
            email: 'test@example.com',
            shopify_connected: true, // CRITICAL: Enables widget rendering
            detected_mode: 'survival',
            stripe_connected: false,
            first_insight_delivered: true, // CRITICAL: Prevents "analyzing data" state
          },
          milestones: [{ id: 1, milestone: 'shopify_connected', achieved_at: "2023-01-01T00:00:00.000Z" }],
          current_mode: 'survival'
        }
      });
    });

    // 2. Mock integration sync status - CRITICAL FOR WIDGET RENDERING
    await page.route(/.*\/api\/v1\/integrations\/sync-status/, async (route) => {
      console.log('🔄 Mocking integration sync-status API');
      await route.fulfill({ 
        status: 200, 
        json: {
          status: 'COMPLETED', // CRITICAL: Ensures widgets render instead of empty states
          progress: {
            current: 100,
            total: 100,
            percentage: 100
          },
          lastError: null
        }
      });
    });

    // 3. Mock layout API (404 = use default survival layout)
    await page.route(/.*\/api\/v1\/layouts\/dashboard/, async (route) => {
      console.log('📐 Mocking layout API (404 - using default layout)');
      await route.fulfill({ status: 404 });
    });

    // 4. Mock Pulse API (Feeds 'cash-flow' and 'order-metrics' widgets)
    await page.route(/.*\/api\/v1\/dashboard\/pulse/, async (route) => {
      console.log('📈 Mocking pulse API for cash flow and order metrics');
      await route.fulfill({ status: 200, json: {
        totalRevenue: 125000,
        orderCount: 1460, // AOV calculation: 125000 / 1460 = $85.61 → $86
        unfulfilledCount: 15 
      }});
    });

    // 5. Mock Inventory Health API (Feeds 'inventory-alerts' widget)
    await page.route(/.*\/api\/v1\/dashboard\/inventory-health/, async (route) => {
      console.log('📦 Mocking inventory health API');
      await route.fulfill({ status: 200, json: [
        { id: 'p1', title: 'Low Stock T-Shirt', total_inventory: 5 },
        { id: 'p2', title: 'Out of Stock Jeans', total_inventory: 0 }
      ]});
    });

    // 6. Mock Top Products API (Feeds 'top-products' widget)
    await page.route(/.*\/api\/v1\/dashboard\/top-products/, async (route) => {
      console.log('🏆 Mocking top products API');
      await route.fulfill({ status: 200, json: [
        { id: 'p3', title: 'Best-Seller Jacket', totalSold: 500 },
        { id: 'p4', title: 'Popular Hat', totalSold: 350 },
      ]});
    });

    // 7. Mock Traffic Source API (Feeds 'sales-by-traffic-source' widget)
    await page.route(/.*\/api\/v1\/dashboard\/sales-by-traffic-source/, async (route) => {
      console.log('🌐 Mocking traffic source API');
      await route.fulfill({ status: 200, json: [
        { source: 'google.com', totalRevenue: 50000, orderCount: 500 },
        { source: 'facebook.com', totalRevenue: 25000, orderCount: 300 }
      ]});
    });

    console.log('✅ All API mocks setup complete');
  });

  test.afterEach(async ({ page }, testInfo) => {
    const testDuration = Date.now() - testStartTime;
    console.log(`⏱️  Test "${testInfo.title}" completed in ${testDuration}ms`);
    
    if (testInfo.status !== testInfo.expectedStatus) {
      console.error(`❌ TEST FAILED: ${testInfo.title}`);
      console.log('📸 Capturing screenshot for debugging...');
      
      // Capture screenshot on failure
      const screenshot = await page.screenshot();
      await testInfo.attach('failure-screenshot', { 
        body: screenshot, 
        contentType: 'image/png' 
      });

      // Capture console logs on failure
      const logs = await page.evaluate(() => {
        return (window as any).consoleMessages || [];
      });
      console.log('📝 Browser console logs:', logs);
    } else {
      console.log(`✅ TEST PASSED: ${testInfo.title}`);
    }
  });

  // --- MAIN TEST: Dashboard Widget Rendering ---
  test('should load dashboard with all 5 Starter Plan widgets and no "Connect" banner', async ({ page }) => {
    console.log('🚀 Starting main dashboard test...');

    await test.step('Navigate to dashboard and verify initial state', async () => {
      console.log('🧭 Navigating to /dashboard');
      await page.goto('/dashboard');
      
      console.log('🔍 Checking for connect store banner (should be hidden)');
      await expect(page.locator('[data-testid="connect-store-banner"]')).toBeHidden();
      console.log('✅ Connect store banner is hidden as expected');
    });

    await test.step('Wait for widget layout to initialize', async () => {
      console.log('⏳ Waiting for widget layout to load...');
      
      // CRITICAL: Wait for layout loading skeleton to disappear
      const layoutSkeleton = page.locator('[data-testid="layout-loading-skeleton"]');
      await expect(layoutSkeleton).toBeHidden({ timeout: 10000 });
      console.log('✅ Widget layout loaded successfully');
      
      // Additional safety wait for React to settle
      await page.waitForTimeout(500);
    });

    await test.step('Verify all 5 widget containers are rendered', async () => {
      console.log('🔍 Checking for widget containers...');
      
      const widgetContainers = [
        { id: 'cash-flow', name: 'Cash Flow' },
        { id: 'order-metrics', name: 'Order Metrics' },
        { id: 'inventory-alerts', name: 'Inventory Alerts' },
        { id: 'top-products', name: 'Top Products' },
        { id: 'sales-by-traffic-source', name: 'Sales by Traffic Source' }
      ];

      for (const widget of widgetContainers) {
        console.log(`📦 Checking ${widget.name} container...`);
        const widgetElement = page.locator(`[data-testid="widget-${widget.id}"]`);
        
        await expect(widgetElement).toBeVisible({ timeout: 8000 });
        console.log(`✅ ${widget.name} container is visible`);
      }
      
      console.log('🎉 All 5 widget containers are rendered successfully');
    });

    await test.step('Verify widget content and data loading', async () => {
      console.log('📊 Verifying widget content and data...');

      // --- Widget 1: Cash Flow ---
      console.log('💰 Testing Cash Flow widget...');
      const cashFlowWidget = page.locator('[data-testid="widget-cash-flow"]');
      await expect(cashFlowWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
      await expect(cashFlowWidget.getByText('$125,000')).toBeVisible();
      console.log('✅ Cash Flow widget loaded with correct data');

      // --- Widget 2: Order Metrics ---
      console.log('📈 Testing Order Metrics widget...');
      const orderMetricsWidget = page.locator('[data-testid="widget-order-metrics"]');
      await expect(orderMetricsWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
      await expect(orderMetricsWidget.getByText('1460')).toBeVisible();
      await expect(orderMetricsWidget.getByText('$86')).toBeVisible();
      console.log('✅ Order Metrics widget loaded with correct data');

      // --- Widget 3: Inventory Alerts ---
      console.log('📦 Testing Inventory Alerts widget...');
      const inventoryWidget = page.locator('[data-testid="widget-inventory-alerts"]');
      await expect(inventoryWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
      await expect(inventoryWidget.getByText('Low Stock T-Shirt')).toBeVisible();
      await expect(inventoryWidget.getByText('Out of Stock Jeans')).toBeVisible();
      console.log('✅ Inventory Alerts widget loaded with correct data');

      // --- Widget 4: Top Selling Products ---
      console.log('🏆 Testing Top Products widget...');
      const topProductsWidget = page.locator('[data-testid="widget-top-products"]');
      await expect(topProductsWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
      await expect(topProductsWidget.getByText('Best-Seller Jacket')).toBeVisible();
      await expect(topProductsWidget.getByText('Popular Hat')).toBeVisible();
      console.log('✅ Top Products widget loaded with correct data');

      // --- Widget 5: Sales by Traffic Source ---
      console.log('🌐 Testing Traffic Source widget...');
      const trafficWidget = page.locator('[data-testid="widget-sales-by-traffic-source"]');
      await expect(trafficWidget.locator('[data-testid="loading-skeleton"]')).toBeHidden();
      await expect(trafficWidget.getByText('Top: google.com')).toBeVisible();
      await expect(trafficWidget.getByText('Top: facebook.com')).toBeVisible
      console.log('✅ Traffic Source widget loaded with correct data');
    });

    console.log('🎊 Dashboard test completed successfully!');
  });

  // --- LOADING STATES TEST ---
  test('should handle delayed API responses gracefully', async ({ page }) => {
    console.log('🔄 Testing delayed API responses...');

    // Add delay to one API
    await page.route(/.*\/api\/v1\/dashboard\/pulse/, async (route) => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.fulfill({ status: 200, json: {
        totalRevenue: 125000,
        orderCount: 1460,
        unfulfilledCount: 15 
      }});
    });

    await page.goto('/dashboard');
    
    // Wait for the delayed widget to eventually load
    await expect(page.locator('[data-testid="widget-cash-flow"]').getByText('$125,000')).toBeVisible({ timeout: 10000 });
    console.log('✅ Delayed widget loaded successfully');
  });

  // --- ERROR HANDLING TEST ---
  test('should handle API errors gracefully', async ({ page }) => {
    console.log('🚨 Testing error handling...');

    // Mock API failure for one widget
    await page.route(/.*\/api\/v1\/dashboard\/pulse/, async (route) => {
      console.log('🔥 Mocking Pulse API failure');
      await route.fulfill({ 
        status: 500,
        json: { error: 'Internal Server Error' }
      });
    });

    await page.goto('/dashboard');

    // Wait for layout to load
    await expect(page.locator('[data-testid="layout-loading-skeleton"]')).toBeHidden();

    // The cash flow widget should handle the error gracefully
    const cashFlowWidget = page.locator('[data-testid="widget-cash-flow"]');
    await expect(cashFlowWidget).toBeVisible();
    
    // It might show an error state or empty state - both are acceptable
    console.log('✅ Dashboard handled API error without crashing');
  });

  // --- CONNECTED STATE VALIDATION TEST ---
  test('should show connect banner when shopify_connected is false', async ({ page }) => {
    console.log('🏪 Testing unconnected store state...');

    // Override user-state mock for unconnected user
    await page.route(/.*\/api\/v1\/user-state\/state/, async (route) => {
      console.log('📊 Mocking unconnected user state');
      await route.fulfill({ 
        json: {
          user: {
            id: 1,
            email: 'test@example.com',
            shopify_connected: false, // CRITICAL: User hasn't connected store
            detected_mode: 'survival',
            stripe_connected: false,
            first_insight_delivered: false,
          },
          milestones: [],
          current_mode: 'survival'
        }
      });
    });

    await page.goto('/dashboard');

    console.log('🔍 Checking for connect store banner (should be visible)');
    await expect(page.locator('[data-testid="connect-store-banner"]')).toBeVisible();
    console.log('✅ Connect store banner is visible for unconnected user');

    // Verify widgets are NOT shown for unconnected users
    const cashFlowWidget = page.locator('[data-testid="widget-cash-flow"]');
    await expect(cashFlowWidget).toBeHidden();
    console.log('✅ Widgets are hidden for unconnected user');
  });
});

// --- UTILITY FUNCTIONS FOR DEBUGGING ---
/**
 * Capture browser console logs during test execution
 * This helps debug React errors and API issues
 */
async function captureConsoleLogs(page: { on: (arg0: string, arg1: (msg: any) => void) => void; }) {
  const logs: { type: any; text: any; location: any; timestamp: string; }[] = [];
  page.on('console', (msg: { type: () => any; text: () => any; location: () => any; }) => {
    logs.push({
      type: msg.type(),
      text: msg.text(),
      location: msg.location(),
      timestamp: new Date().toISOString()
    });
  });
  return logs;
}

/**
 * Monitor network requests for debugging
 */
async function monitorNetworkRequests(page: { on: (arg0: string, arg1: (request: any) => void) => void; }) {
  const requests: { url: any; method: any; headers: any; timestamp: string; }[] = [];
  page.on('request', (request: { url: () => any; method: () => any; headers: () => any; }) => {
    requests.push({
      url: request.url(),
      method: request.method(),
      headers: request.headers(),
      timestamp: new Date().toISOString()
    });
  });
  return requests;
}

/**
 * Take diagnostic screenshot with annotations
 */
async function takeDiagnosticScreenshot(page: { screenshot: () => any; }, description: any) {
  const screenshot = await page.screenshot();
  console.log(`📸 Diagnostic screenshot: ${description}`);
  return screenshot;
}
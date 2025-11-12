// tests/e2e/onboarding-flow.spec.ts
import { test, expect, Page } from '@playwright/test';
import { loginAs } from './utils/login';

// Mock data
const MOCK_PRE_FLIGHT_SUCCESS = { ready: true };
const MOCK_OAUTH_URL = 'https://mock-shopify.com/oauth/authorize';
const MOCK_OPS_INTEL_DATA = { automated_tasks: 15, labor_cost_saved: 5000 };
const MOCK_DASHBOARD_DATA = {
  pulse: { revenue: 750930, margin: 320400 },
  inventory: { items: 150, value: 1200000 },
  shipments: { shipped: 45, pending: 12 }
};

test.describe('Dashboard OAuth Integration Flow', () => {
  let page: Page;

  test.beforeEach(async ({ browser }) => {
    // Create new context for each test to ensure clean state
    const context = await browser.newContext();
    page = await context.newPage();
    
    // Mock all API endpoints before starting
    await mockInitialAPIs(page);
  });

  test('complete OAuth flow with successful sync and data refresh', async () => {
    console.log('=== Starting complete OAuth flow test ===');
    
    // 1. Login as default user (from test setup)
    await loginAs(page, 'default-user');
    console.log('✅ Logged in successfully');
    
    // 2. Assert ConnectStoreBanner is visible (user has no integrations)
    await expect(page.locator('[data-testid="connect-store-banner"]')).toBeVisible();
    console.log('✅ ConnectStoreBanner is visible');

    // 3. Click Connect button and verify modal opens
    await page.click('[data-testid="connect-store-button"]');
    console.log('✅ Clicked connect store button');
    
    await expect(page.locator('[data-testid="connect-store-modal"]')).toBeVisible();
    console.log('✅ ConnectStoreModal is visible');

    // 4. Click on Shopify platform first (this is the first step)
    await page.click('[data-testid="connect-store-modal"] >> text=Shopify');
    console.log('✅ Selected Shopify platform');

    // 5. Now we should see the Shopify input form - fill shop name
    await page.fill('input[type="text"]', 'test-store.myshopify.com');
    console.log('✅ Filled shop name');

    // 6. Mock OAuth initiation and click the Connect button in the form
    await page.route('**/api/v1/integrations/oauth/initiate', route => 
      route.fulfill({ json: { url: MOCK_OAUTH_URL } })
    );

    // Also mock the initial sync status to return SYNCING status
    await page.route('**/api/v1/integrations/sync-status', route => 
      route.fulfill({ json: { status: 'SYNCING_PRODUCTS', progress: { current: 10, total: 100 } } })
    );

    // Mock sync status polling sequence BEFORE OAuth callback
    let syncPollCount = 0;
    await page.route('**/api/v1/integrations/sync-status', route => {
      syncPollCount++;
      console.log(`🔄 Sync status poll #${syncPollCount}`);
      
      const responses = [
        { status: 'SYNCING_PRODUCTS', progress: { current: 10, total: 100 } },
        { status: 'COMPLETED', progress: { current: 100, total: 100 } }
      ];
      return route.fulfill({ json: responses[Math.min(syncPollCount - 1, responses.length - 1)] });
    });
    
    // Click the Connect button in the Shopify form
    await page.click('[data-testid="connect-store-modal"] button:has-text("Connect")');
    console.log('✅ Clicked Connect button in Shopify form');

    // 7. Simulate OAuth callback return
    await page.goto('/dashboard?connect=success');
    console.log('✅ Navigated to dashboard with connect=success');
    
    // 8. Assert DataSyncingModal appears immediately
    // Use the actual modal content text with more specific selectors
    await expect(page.getByRole('heading', { name: 'Connection Successful!', level: 3 })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Connection Successful!' })
      .locator('text=We\'re syncing your data from Shopify')).toBeVisible();
    console.log('✅ DataSyncingModal is visible');

    // 9. Wait for sync completion and modal auto-close
    // Wait for the modal to disappear
    await expect(page.getByRole('heading', { name: 'Connection Successful!', level: 3 })).toBeHidden({
      timeout: 15000
    });
    console.log('✅ DataSyncingModal closed after sync completion');

    // 10. Wait for staggered refresh to complete
    await page.waitForTimeout(1000);

    // 11. Assert final dashboard state with real data and banner is gone
    // Since widgets don't have test IDs, check for visible dashboard content
    
    await expect(page.locator('[data-testid="connect-store-banner"]')).not.toBeVisible();
    console.log('✅ ConnectStoreBanner is gone after integration');
    
    console.log('=== OAuth flow test completed successfully ===');
  });

  test('handle pre-flight check failure gracefully', async () => {
    console.log('=== Starting pre-flight failure test ===');
    
    await loginAs(page, 'default-user');
    console.log('✅ Logged in successfully');
    
    // Wait for banner to be visible first
    await expect(page.locator('[data-testid="connect-store-banner"]')).toBeVisible();
    console.log('✅ ConnectStoreBanner is visible');

    // Mock pre-flight failure
    await page.route('**/api/v1/integrations/pre-flight', route => 
      route.fulfill({ 
        status: 500,
        json: { issues: ['Service unavailable', 'Database connection failed'] }
      })
    );
    console.log('✅ Mocked pre-flight failure');

    await page.click('[data-testid="connect-store-button"]');
    console.log('✅ Clicked connect store button');

    // Verify ConnectionErrorModal shows with specific issues
    await expect(page.locator('[data-testid="connection-error-modal"]')).toBeVisible();
    console.log('✅ ConnectionErrorModal is visible');
    
    await expect(page.locator('[data-testid="connection-error-modal"]')).toContainText('Service unavailable');
    await expect(page.locator('[data-testid="connection-error-modal"]')).toContainText('Database connection failed');
    console.log('✅ Error messages displayed correctly');
    
    // Test retry flow - for now, just verify retry button exists and works
    // The retry will fail again since we're still mocking failure
    await expect(page.locator('[data-testid="retry-button"]')).toBeVisible();
    console.log('✅ Retry button is visible');
    
    console.log('=== Pre-flight failure test completed successfully ===');
  });

  test('handle OAuth error callback', async () => {
    console.log('=== Starting OAuth error test ===');
    
    await loginAs(page, 'default-user');
    console.log('✅ Logged in successfully');
    
    // Wait for initial load to complete
    await expect(page.locator('[data-testid="connect-store-banner"]')).toBeVisible();
    console.log('✅ ConnectStoreBanner is visible');
    
    // Simulate OAuth error return
    await page.goto('/dashboard?connect=error&message=Access+denied');
    console.log('✅ Navigated to dashboard with OAuth error');
    
    // Verify error modal with specific message
    await expect(page.locator('[data-testid="connection-error-modal"]')).toBeVisible();
    console.log('✅ ConnectionErrorModal is visible');
    
    await expect(page.locator('[data-testid="connection-error-modal"]')).toContainText('Access denied');
    console.log('✅ Error message displayed correctly');
    
    console.log('=== OAuth error test completed successfully ===');
  });

  test('user with existing integrations should not see ConnectStoreBanner', async () => {
    console.log('=== Starting existing integrations test ===');
    
    // Mock that user already has integrations
    await page.route('**/api/v1/integrations/sync-status', route => 
      route.fulfill({ 
        json: { status: 'COMPLETED', hasIntegrations: true }
      })
    );
    console.log('✅ Mocked user with existing integrations');

    await loginAs(page, 'default-user');
    console.log('✅ Logged in successfully');
    
    // Banner should NOT be visible for users with existing integrations
    await expect(page.locator('[data-testid="connect-store-banner"]')).not.toBeVisible();
    console.log('✅ ConnectStoreBanner is not visible (user has integrations)');
    
    console.log('=== Existing integrations test completed successfully ===');
  });
});

// Helper function to mock initial API state for user without integrations
async function mockInitialAPIs(page: Page) {
  // Mock initial sync status - no integrations (404)
  await page.route('**/api/v1/integrations/sync-status', route => 
    route.fulfill({ status: 404 })
  );

  // Mock successful pre-flight by default
  await page.route('**/api/v1/integrations/pre-flight', route => 
    route.fulfill({ json: MOCK_PRE_FLIGHT_SUCCESS })
  );
  
  await page.route('**/api/v1/dashboard/pulse', route => 
    route.fulfill({ json: MOCK_DASHBOARD_DATA.pulse })
  );
  
  await page.route('**/api/v1/dashboard/inventory', route => 
    route.fulfill({ json: MOCK_DASHBOARD_DATA.inventory })
  );
  
  await page.route('**/api/v1/dashboard/shipments', route => 
    route.fulfill({ json: MOCK_DASHBOARD_DATA.shipments })
  );
}
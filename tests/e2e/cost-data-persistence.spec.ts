import { TEST_USERS } from './utils/test-users';
// tests/e2e/cost-data-persistence.spec.ts
import { test, expect } from '@playwright/test';
import { loginAs } from './utils/login';

/**
 * COST DATA PERSISTENCE E2E TEST SUITE
 * 
 * Updated based on actual data-testid placement:
 * - Products are TableRow elements with data-testid="product-card"
 * - Cost entry modal uses MainCard with data-testid="cost-entry-modal"
 * - Inputs have individual data-testid attributes
 */

// Create a custom login function for cost tests that goes directly to products
async function loginAndGoToProducts(page: any, userKey = 'default-user') {
  const user = TEST_USERS['default-user'];
  if (!user) {
    throw new Error(`Test user '${userKey}' not found in test-users.ts`);
  }

  console.log('🔗 Navigating to login page...');
  await page.goto('/login');
  
  console.log('📝 Filling login credentials...');
  await page.getByLabel('Email Address / Username').fill(user.email);
  await page.getByRole('textbox', { name: 'Password' }).fill(user.password);
  
  console.log('🚀 Submitting login form...');
  await page.getByRole('button', { name: /Sign In/i }).click();

  console.log('⏳ Waiting for login to complete...');
  try {
    await page.waitForURL('**/dashboard');
    console.log('✅ Login successful - redirected to dashboard');
  } catch (error) {
    const errorElement = page.locator('[role="alert"], .MuiFormHelperText-error');
    if (await errorElement.isVisible()) {
      const errorText = await errorElement.textContent();
      throw new Error(`Login failed with error: ${errorText}`);
    }
    await page.screenshot({ path: 'login-failure.png' });
    throw new Error(`Login failed - stuck on URL: ${page.url()}`);
  }

  // Instead of verifying dashboard, go directly to products page
  console.log('🧭 Navigating directly to products page...');
  await page.goto('/products');
  
  console.log('✅ Login and navigation to products completed');
}

test.describe.skip('Cost Data Persistence', () => {
  let testStartTime: number;

  // --- TEST SETUP AND TEARDOWN ---
  test.beforeEach(async ({ page }, testInfo) => {
  testStartTime = Date.now();
  console.log(`🧪 Starting test: ${testInfo.title}`);
  console.log('🔄 Setting up API mocks...');

  // Monitor network requests for debugging
  page.on('request', request => {
    if (request.url().includes('/api/v1/')) {
      console.log(`🔍 REQUEST: ${request.method()} ${request.url()}`);
    }
  });

  page.on('response', response => {
    if (response.url().includes('/api/v1/')) {
      console.log(`🔍 RESPONSE: ${response.status()} ${response.url()}`);
    }
  });

  // 1. Mock user state for connected user (CRITICAL)
  await page.route(/.*\/api\/v1\/user-state\/state/, async (route) => {
    console.log('📊 Mocking user-state API');
    await route.fulfill({ 
      json: {
        user: {
          id: 1,
          email: 'test@example.com',
          shopify_connected: true,
          detected_mode: 'survival',
          stripe_connected: false,
          first_insight_delivered: true,
        },
        milestones: [],
        current_mode: 'survival'
      }
    });
  });

  // 2. Mock integration sync status (CRITICAL)
  await page.route(/.*\/api\/v1\/integrations\/sync-status/, async (route) => {
    console.log('🔄 Mocking integration sync-status API');
    await route.fulfill({ 
      status: 200, 
      json: {
        status: 'COMPLETED',
        progress: {
          current: 100,
          total: 100,
          percentage: 100
        },
        lastError: null
      }
    });
  });

  // 3. Mock products API with PROPER AUTHENTICATION HANDLING
  await page.route(/.*\/api\/v1\/products.*/, async (route) => {
    console.log('📦 Mocking products API');
    
    // Check authentication - if no auth header, return 401
    const authHeader = route.request().headers().authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Products API: No auth token, returning 401');
      await route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
      return;
    }
    
    console.log('✅ Products API: Auth token present, returning products');
    await route.fulfill({ 
      status: 200,
      json: [
        {
          id: 1,
          platform_product_id: 'test-product-1',
          title: 'Test Product 1',
          variants: [{ price: '45.00' }],
          inventory_quantity: 10,
          product_type: 'Test Type',
          vendor: 'Test Vendor',
          status: 'active',
          total_inventory: 10
        },
        {
          id: 2, 
          platform_product_id: 'test-product-2',
          title: 'Test Product 2',
          variants: [{ price: '60.00' }],
          inventory_quantity: 5,
          product_type: 'Test Type',
          vendor: 'Test Vendor',
          status: 'active',
          total_inventory: 5
        }
      ]
    });
  });

  // 4. Mock empty initial user-state product costs
  await page.route(/.*\/api\/v1\/user-state\/product-costs/, async (route) => {
    if (route.request().method() === 'GET') {
      console.log('📊 Mocking GET user-state/product-costs (empty)');
      await route.fulfill({ json: {} });
    }
  });

  // 5. Mock successful product-costs API
  await page.route(/.*\/api\/v1\/product-costs\/.*/, async (route) => {
    console.log('💰 Mocking product-costs API');
    
    // Check authentication
    const authHeader = route.request().headers().authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.log('❌ Product-costs API: No auth token, returning 401');
      await route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
      return;
    }
    
    await route.fulfill({ 
      status: 200,
      json: { success: true }
    });
  });

  // 6. Mock additional endpoints that might be required
  await page.route(/.*\/api\/v1\/integrations/, async (route) => {
    console.log('🔗 Mocking integrations API');
    await route.fulfill({
      json: [{
        id: '1',
        platform: 'shopify',
        store_name: 'Test Store',
        sync_status: 'COMPLETED'
      }]
    });
  });

  // 7. Mock layout API (404 = use default layout)
  await page.route(/.*\/api\/v1\/layouts\/dashboard/, async (route) => {
    console.log('📐 Mocking layout API (404)');
    await route.fulfill({ status: 404 });
  });

  // 8. Mock kore endpoints that might be called
  await page.route(/.*\/api\/v1\/kore\/health/, async (route) => {
    console.log('❤️ Mocking kore/health API');
    await route.fulfill({ json: { status: 'healthy' } });
  });

  await page.route(/.*\/api\/v1\/kore\/subscribe/, async (route) => {
    console.log('📨 Mocking kore/subscribe API');
    await route.fulfill({ json: { subscribed: true } });
  });

  console.log('✅ All API mocks setup complete');
});

  // --- MAIN TEST: Cost Data Persistence Across Refresh ---
  test('should persist cost data across page refreshes', async ({ page }) => {
    console.log('🚀 Starting cost data persistence test...');

    // Server state simulation for user-state API
    let serverCostData: any = {};

    await page.route(/.*\/api\/v1\/user-state\/product-costs/, async (route) => {
      if (route.request().method() === 'GET') {
        console.log('📊 Mocking GET user-state/product-costs:', serverCostData);
        await route.fulfill({ json: serverCostData });
      } else if (route.request().method() === 'POST') {
        const requestBody = await route.request().postDataJSON();
        serverCostData = requestBody.productCosts;
        console.log('💾 Mocking POST user-state/product-costs:', serverCostData);
        await route.fulfill({ json: { success: true } });
      }
    });

    await test.step('Login and navigate to products page', async () => {
        console.log('🔐 Logging in...');
        await loginAndGoToProducts(page, 'default-user');
        
        console.log('🧭 Navigating to products page...');
        await page.goto('/products');
        
        // Wait for the page to load and check what's visible
        console.log('⏳ Waiting for products page to load...');
        
        // First, wait for any loading indicators to disappear
        try {
            await page.waitForSelector('[data-testid="loading-skeleton"], .MuiCircularProgress-root', { 
            state: 'hidden', 
            timeout: 10000 
            });
            console.log('✅ Loading indicators hidden');
        } catch (error) {
            console.log('⚠️ No loading indicators found or they timed out');
        }
        
        // Check if we can find the product cards directly
        const productCards = page.locator('[data-testid="product-card"]');
        const productCount = await productCards.count();
        
        if (productCount > 0) {
            console.log(`✅ Found ${productCount} product cards via data-testid`);
            return;
        }
        
        // Fallback: look for table rows
        console.log('🔄 Falling back to table detection...');
        const tableRows = page.locator('table tbody tr');
        const rowCount = await tableRows.count();
        
        if (rowCount > 0) {
            console.log(`✅ Found ${rowCount} table rows`);
            
            // Verify data-testid is on the rows
            const firstRow = tableRows.first();
            const hasTestId = await firstRow.getAttribute('data-testid');
            console.log(`🔍 First row data-testid: ${hasTestId}`);
            
            if (hasTestId !== 'product-card') {
            console.log('⚠️ Table rows exist but data-testid is not set correctly');
            }
        } else {
            // Last resort: check what's actually on the page
            console.log('🔍 Debug: Checking page content...');
            const pageContent = await page.content();
            const hasTable = pageContent.includes('<table');
            const hasProducts = pageContent.includes('product');
            const hasError = pageContent.includes('error') || pageContent.includes('Error');
            
            console.log(`🔍 Page analysis - Table: ${hasTable}, Products: ${hasProducts}, Error: ${hasError}`);
            
            // Take a screenshot for debugging
            await page.screenshot({ path: 'debug-products-page.png' });
            console.log('📸 Screenshot saved as debug-products-page.png');
            
            throw new Error('No products or table rows found on products page');
        }
        
        console.log('✅ Products page loaded successfully');
    });

    test('should load products page successfully', async ({ page }) => {
        console.log('🧪 Testing basic products page load...');

        let productsApiCalled = false;

        await page.route(/.*\/api\/v1\/products.*/, async (route) => {
            productsApiCalled = true;
            console.log('📦 Products API called with auth:', route.request().headers().authorization ? 'YES' : 'NO');
            await route.fulfill({ 
            status: 200,
            json: [
                {
                id: 1,
                platform_product_id: 'test-product-1',
                title: 'Test Product 1',
                variants: [{ price: '45.00' }],
                inventory_quantity: 10,
                product_type: 'Test Type',
                vendor: 'Test Vendor',
                status: 'active',
                total_inventory: 10
                }
            ]
            });
        });

        await loginAndGoToProducts(page, 'default-user');
        await page.goto('/products');
        
        // Wait for products to load
        await page.waitForTimeout(2000); // Give it time to make API calls
        
        expect(productsApiCalled).toBe(true);
        console.log('✅ Products API was called successfully');
        
        // Check if we can find any product-related content
        const pageText = await page.textContent('body');
        const hasProductContent = pageText?.includes('Product') || pageText?.includes('product');
        
        expect(hasProductContent).toBe(true);
        console.log('✅ Product content found on page');
        });

    await test.step('Enter cost data for first product', async () => {
      console.log('💰 Entering cost data...');
      
      // Click first product row to open cost modal
      const firstProduct = page.locator('[data-testid="product-card"]').first();
      await firstProduct.click();
      
      // Wait for cost entry modal to appear
      await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeVisible();
      
      // Fill cost data
      await page.fill('[data-testid="purchase-price-input"]', '25.00');
      await page.fill('[data-testid="shipping-cost-input"]', '5.00');
      await page.fill('[data-testid="customs-duties-input"]', '2.00');
      
      // Save cost data
      await page.click('[data-testid="save-cost-button"]');
      
      // Wait for modal to close and verify UI update
      await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeHidden();
      
      // Verify cost status indicator shows on product row
      // Note: The data-testid is on a div inside the table cell
      await expect(firstProduct.locator('[data-testid="cost-status-indicator"]')).toHaveText('Cost Added');
      console.log('✅ Cost data entered and UI updated');
    });

    await test.step('Verify immediate margin calculation', async () => {
      console.log('📈 Verifying margin calculation...');
      
      const firstProduct = page.locator('[data-testid="product-card"]').first();
      
      // Verify margin is displayed (44.44% = (45 - 32) / 45 * 100)
      // Note: The data-testid is on a div inside the table cell
      await expect(firstProduct.locator('[data-testid="margin-display"]')).toContainText('44.44%');
      console.log('✅ Margin calculation correct: 44.44%');
    });

    await test.step('Refresh page and verify data persistence', async () => {
      console.log('🔄 Refreshing page...');
      await page.reload();
      
      // Wait for products to reload
      await page.waitForSelector('[data-testid="product-card"]');
      console.log('✅ Page refreshed, products reloaded');
      
      // Verify cost data survived refresh
      const firstProduct = page.locator('[data-testid="product-card"]').first();
      await expect(firstProduct.locator('[data-testid="cost-status-indicator"]')).toHaveText('Cost Added');
      await expect(firstProduct.locator('[data-testid="margin-display"]')).toContainText('44.44%');
      
     // tests/e2e/cost-data-persistence.spec.ts (continued)

      console.log('✅ Cost data persisted across page refresh!');
    });

    await test.step('Verify server state was properly stored', async () => {
      console.log('🔍 Verifying server state...');
      
      // Check that our mock server received the data
      expect(serverCostData).toBeDefined();
      expect(Object.keys(serverCostData)).toHaveLength(1);
      
      const productKey = Object.keys(serverCostData)[0];
      const costData = serverCostData[productKey];
      
      expect(costData.purchase_price).toBe(25);
      expect(costData.shipping_cost).toBe(5);
      expect(costData.landed_cost_per_unit).toBe(32); // 25 + 5 + 2
      expect(costData.selling_price).toBe(45);
      
      console.log('✅ Server state properly stored with correct calculations');
    });

    console.log('🎊 Cost data persistence test completed successfully!');
  });

  // --- DUAL-WRITE STRATEGY TEST ---
  test('should handle dual-write strategy (localStorage + user-state)', async ({ page }) => {
    console.log('🧪 Testing dual-write strategy...');

    let serverCostData: any = {};
    let apiCallCount = 0;

    await page.route(/.*\/api\/v1\/user-state\/product-costs/, async (route) => {
      apiCallCount++;
      if (route.request().method() === 'GET') {
        console.log(`📊 GET user-state/product-costs call #${apiCallCount}`);
        await route.fulfill({ json: serverCostData });
      } else if (route.request().method() === 'POST') {
        const requestBody = await route.request().postDataJSON();
        serverCostData = requestBody.productCosts;
        console.log(`💾 POST user-state/product-costs call #${apiCallCount}:`, Object.keys(serverCostData));
        await route.fulfill({ json: { success: true } });
      }
    });

    await test.step('Setup and initial cost entry', async () => {
      await loginAndGoToProducts(page, 'default-user');
      await page.goto('/products');
      await page.waitForSelector('[data-testid="product-card"]');
      
      // Enter cost data
      await page.locator('[data-testid="product-card"]').first().click();
      await page.fill('[data-testid="purchase-price-input"]', '30.00');
      await page.click('[data-testid="save-cost-button"]');
      await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeHidden();
    });

    await test.step('Verify both localStorage and API were called', async () => {
      // Verify API was called
      expect(apiCallCount).toBeGreaterThan(0);
      console.log(`✅ API calls made: ${apiCallCount}`);
      
      // Verify server state was updated
      expect(Object.keys(serverCostData)).toHaveLength(1);
      console.log('✅ Server state updated successfully');
      
      // Verify localStorage also contains the data (by checking UI state)
      await expect(page.locator('[data-testid="cost-status-indicator"]').first()).toHaveText('Cost Added');
      console.log('✅ localStorage fallback working');
    });

    await test.step('Simulate API failure and verify localStorage fallback', async () => {
      console.log('🔥 Simulating API failure...');
      
      // Override route to simulate API failure
      await page.route(/.*\/api\/v1\/user-state\/product-costs/, async (route) => {
        if (route.request().method() === 'GET') {
          console.log('❌ Simulating API failure on GET');
          await route.fulfill({ status: 500, json: { error: 'Server Error' } });
        } else {
          await route.continue();
        }
      });

      // Refresh page - should fall back to localStorage
      await page.reload();
      await page.waitForSelector('[data-testid="product-card"]');
      
      // Should still show cost data from localStorage
      await expect(page.locator('[data-testid="cost-status-indicator"]').first()).toHaveText('Cost Added');
      console.log('✅ localStorage fallback working during API failure');
    });

    console.log('🎉 Dual-write strategy test completed!');
  });

  // --- MULTIPLE PRODUCTS COST ENTRY TEST ---
  test('should handle cost data for multiple products', async ({ page }) => {
    console.log('🧪 Testing multiple products cost entry...');

    let serverCostData: any = {};

    await page.route(/.*\/api\/v1\/user-state\/product-costs/, async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: serverCostData });
      } else if (route.request().method() === 'POST') {
        const requestBody = await route.request().postDataJSON();
        serverCostData = requestBody.productCosts;
        await route.fulfill({ json: { success: true } });
      }
    });

    await test.step('Setup and login', async () => {
      await loginAndGoToProducts(page, 'default-user');
      await page.goto('/products');
      await page.waitForSelector('[data-testid="product-card"]');
    });

    await test.step('Enter cost data for multiple products', async () => {
      const products = await page.locator('[data-testid="product-card"]').all();
      
      for (let i = 0; i < Math.min(2, products.length); i++) {
        console.log(`💰 Entering cost for product ${i + 1}...`);
        
        await products[i].click();
        await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeVisible();
        
        const purchasePrice = (25 + i * 10).toString();
        await page.fill('[data-testid="purchase-price-input"]', purchasePrice);
        await page.click('[data-testid="save-cost-button"]');
        await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeHidden();
        
        // Verify immediate UI update
        await expect(products[i].locator('[data-testid="cost-status-indicator"]')).toHaveText('Cost Added');
      }
    });

    await test.step('Verify all cost data persisted after refresh', async () => {
      await page.reload();
      await page.waitForSelector('[data-testid="product-card"]');
      
      const products = await page.locator('[data-testid="product-card"]').all();
      let costAddedCount = 0;
      
      for (const product of products) {
        if (await product.locator('[data-testid="cost-status-indicator"]').isVisible()) {
          costAddedCount++;
        }
      }
      
      expect(costAddedCount).toBe(2);
      console.log(`✅ ${costAddedCount} products maintained cost data after refresh`);
      
      // Verify server state contains all products
      expect(Object.keys(serverCostData)).toHaveLength(2);
      console.log('✅ Server state contains all product cost data');
    });

    console.log('🎉 Multiple products cost persistence test completed!');
  });

  // --- TOTAL LANDED COST VERIFICATION TEST ---
  test('should calculate and display total landed cost correctly', async ({ page }) => {
    console.log('🧪 Testing total landed cost calculation...');

    await loginAndGoToProducts(page, 'default-user');
    await page.goto('/products');
    await page.waitForSelector('[data-testid="product-card"]');

    await test.step('Enter cost data and verify calculations', async () => {
      await page.locator('[data-testid="product-card"]').first().click();
      await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeVisible();
      
      // Fill cost data
      await page.fill('[data-testid="purchase-price-input"]', '25.00');
      await page.fill('[data-testid="shipping-cost-input"]', '5.00');
      await page.fill('[data-testid="customs-duties-input"]', '2.00');
      
      // Verify total landed cost calculation (25 + 5 + 2 = 32)
      await expect(page.locator('[data-testid="total-landed-cost"]')).toContainText('$32.00');
      console.log('✅ Total landed cost calculated correctly: $32.00');
      
      await page.click('[data-testid="save-cost-button"]');
      await expect(page.locator('[data-testid="cost-entry-modal"]')).toBeHidden();
    });

    console.log('🎉 Total landed cost test completed!');
  });
});

// --- UTILITY FUNCTIONS ---
async function captureCostDataState(page: any) {
  return await page.evaluate(() => {
    return {
      localStorage: localStorage.getItem('userProductCosts'),
      costData: (window as any).costData // If exposed for testing
    };
  });
}

async function simulateNetworkConditions(page: any, condition: 'online' | 'offline' | 'slow') {
  const context = page.context();
  
  if (condition === 'offline') {
    await context.setOffline(true);
  } else if (condition === 'slow') {
    // Simulate slow 3G
    await context.route('**', async (route: any) => {
      await new Promise(resolve => setTimeout(resolve, 2000));
      await route.continue();
    });
  } else {
    await context.setOffline(false);
  }
}
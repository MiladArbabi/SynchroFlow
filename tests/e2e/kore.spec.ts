import { test, expect } from '@playwright/test';
import { loginAs } from './utils/login';

test.describe('Kore OpsCommandCenter Integration', () => {

  // --- GLOBAL HEALTH MOCK ---
  // We must mock this before each test so the HealthContext
  // believes the API is healthy *before* the test runs.
  test.beforeEach(async ({ page }) => {
    await page.route('/api/v1/kore/health', async (route) => {
      await route.fulfill({
        status: 200,
        json: { status: 'healthy', services: { database: 'connected' } },
      });
    });
  });

  // --- MOCK API RESPONSE for Federated Search ---
  const mockFederatedSearch = (page: any, query: string, delay = 100) => {
    return page.route(`/api/v1/kore/search?q=${query}`, async (route: any) => {
      // Simulate a network delay
      await new Promise(f => setTimeout(f, delay));
      await route.fulfill({
        status: 200,
        json: [{
          type: 'customer',
          id: 1,
          title: 'test@example.com', // Our seeded user
          description: 'Customer: Test User',
          url: '/customers/1',
        }],
      });
    });
  };

  // --- Test 1: Default State (Unchanged) ---
  test('should replace the old placeholder and be collapsed by default', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);
    await expect(
      page.getByTestId('ops-command-center-panel'),
    ).not.toBeVisible();
  });

  // --- Test 2: Layer 1 Flow (Icon Button - Unchanged) ---
  test('should open the console panel with the navbar icon', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);
    await expect(page.getByTestId('kore-command-input')).not.toBeVisible();
    await page.getByTestId('kore-navbar-button').click();
    await expect(page.getByTestId('kore-command-input')).toBeVisible();
  });

  // --- Test 3: L1/L2 Progressive Load ---
  test('should progressively load L1 (fast) and L2 (slow) results', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // --- 1. MOCK the API call for "Orders" ---
    // We use a RegExp to catch all /api/v1/kore/search calls
    await page.route(/\/api\/v1\/kore\/search/, async (route) => {
      // Check that the query parameter is correct, case-insensitive
      const params = new URL(route.request().url()).searchParams;
      // --- DEBUG LOG 3 ---
      // console.log(`[DEBUG] E2E mock intercepted API call with query: ${params.get('q')}`);
      const query = params.get('q')?.toLowerCase() || '';

      if (params.get('q')?.toLowerCase() !== 'test') {
        return route.abort();
      }
      await new Promise(f => setTimeout(f, 100)); // 100ms delay
      await route.fulfill({
        status: 200,
        json: [{
          type: 'customer',
          id: 1,
          title: 'test@example.com',
          description: 'Customer: Test User',
          url: '/customers/1',
        }],
      });
    });

    // 2. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 3. Type a query
    await page.getByTestId('kore-command-input').fill('test');

    // 4. Assert L1 result ("Find Customer...") appears immediately
    await expect(page.getByText('Find Customer by Email...')).toBeVisible(); // <-- FIX: Assert correct L1 result
    
    // 5. Assert that the L2 result ("test@example.com") also appears
   await expect(page.getByText('test@example.com')).toBeVisible();
  });

  // --- Test 4: L2 Query ---
  test.skip('should show the InterpretationBanner for a Layer 2 query', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 2. Type a natural language query
    await page.getByTestId('kore-command-input').fill('show orders from yesterday');

    // 3. --- THIS IS THE FIX ---
    // We MUST wait for the UI to react.
    // We'll wait for the "Understood:" text to appear.
    await expect(page.getByText('Understood:')).toBeVisible();

    // 4. And we assert the L2 action name is also visible
    await expect(
      page.getByText('Find orders from yesterday'),
    ).toBeVisible();

    // 5. And we assert the L1 list is NOT visible
    await expect(page.getByText('Go to Dashboard')).not.toBeVisible();
  });

  test('should show the ClarificationList for an ambiguous query', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 2. Type an ambiguous query
    await page.getByTestId('kore-command-input').fill('yesterday');

    // 3. This is the "Red" step. It will fail.
    // We expect the ClarificationList header to be visible.
    await expect(page.getByText('What did you mean?')).toBeVisible();

    // 4. We also expect the options to be visible
    await expect(page.getByText('Show orders from yesterday?')).toBeVisible();
    await expect(page.getByText('Show customers created yesterday?')).toBeVisible();

    // 5. And the L1/L2 UIs should be hidden
    await expect(page.getByText('Understood:')).not.toBeVisible();
    await expect(page.getByText('Go to Dashboard')).not.toBeVisible();
  });

  test('should show the ProactiveList when idle and insights are available', async ({ page }) => {
    // --- MOCKING ---
    // Intercept the /api/v1/kore/subscribe route to *simulate* a real-time insight
    await page.route('/api/v1/kore/subscribe', async (route) => {
      // 1. Define the SSE payload as a string
      const ssePayload =
        'event: insight\n' +
        'data: {"id":"ins-123","type":"alert","title":"Stale Order Detected","message":"Order #1001 is stale.","urgency":"high","status":"new","actionPayload":[]}\n\n';
      // 2. Fulfill the request with the correct type and body
      await route.fulfill({
        contentType: 'text/event-stream',
        body: ssePayload,
        status: 200,
      });
    });

    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // We expect the L3 PROACTIVE list to be visible.
    // This will fail (it will show L1 results or nothing).
    await expect(
      page.getByText("Kore: Here's what needs your attention:")
    ).toBeVisible();

    // 3. Assert the insight content is there
    await expect(page.getByText('Stale Order Detected')).toBeVisible();

    // 4. Assert the L1/L2 UIs are hidden
    await expect(page.getByText('Understood:')).not.toBeVisible();
    await expect(page.getByText('Go to Dashboard')).not.toBeVisible();
  });

  test('should show a notification badge when a new insight arrives', async ({ page }) => {
    // --- MOCKING ---
    // Intercept the SSE route to simulate a new insight
    await page.route('/api/v1/kore/subscribe', async (route) => {
      const ssePayload =
        'event: insight\n' +
        'data: {"id":"ins-123","type":"alert","title":"Stale Order Detected","message":"Order #1001 is stale.","urgency":"high","status":"new","actionPayload":[]}\n\n';
      await route.fulfill({
        contentType: 'text/event-stream',
        body: ssePayload,
        status: 200,
      });
    });
    // --- END MOCKING ---

    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. This is the "Red" step.
    // We expect our new custom SVG icon to be rendered and to have the 'active' class.
    const koreIcon = page.getByTestId('kore-icon-svg');
    await expect(koreIcon).toBeVisible();
    await expect(koreIcon).toHaveClass(/kore-icon-active/); // Check for the animation class
    // 2. (Bonus) Open the console
    await page.getByTestId('kore-navbar-button').click();
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 3. (Bonus) Check that the insight is in the list
    await expect(page.getByText('Stale Order Detected')).toBeVisible();
  });

  test('should gracefully degrade to L1 search when API health check fails', async ({ page }) => {
    // Mock the health check to return a 503 "unhealthy" status
    await page.route('/api/v1/kore/health', async (route) => {
      await route.fulfill({
        status: 503,
        json: { status: 'unhealthy', services: { database: 'disconnected' } },
      });
    });

    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();

    // 2. This is the "Red" step.
    // We expect a "degraded" warning message to be visible
    await expect(
      page.getByText('Kore is in degraded mode. Search is limited.')
    ).toBeVisible();

    // 3. Type a low confidence query
    await page.getByTestId('kore-command-input').fill('dash');

    // 4. Assert that the L1 search *still works*
    await expect(page.getByText('Go to Dashboard')).toBeVisible();
  });

  test('should find commands using a synonym (L1 fuzzy)', async ({ page }) => {
    await loginAs(page, 'default-user');
    await page.waitForURL(/.*dashboard/);

    // 1. Open panel
    const isMac = process.platform === 'darwin';
    const modifier = isMac ? 'Meta' : 'Control';
    await page.locator('body').click();
    await page.keyboard.press(`${modifier}+j`);
    await expect(page.getByTestId('kore-command-input')).toBeVisible();
    
    // 2. Type a *synonym* (e.g., "return")
    await page.getByTestId('kore-command-input').fill('return');

    // 3. This is the "Red" step.
    // We expect the *target* ("Refund Last Order...") to be visible.
    // This will fail because "return" is not in the keywords for "Refund".
    await expect(page.getByText('Refund Last Order...')).toBeVisible();
  });
});
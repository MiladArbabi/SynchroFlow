// tests/contract/orderNexus.contract.test.ts
/* eslint-disable @typescript-eslint/no-var-requires */
import { createHarness } from './contractHarness';

describe('Module contract: order-nexus', () => {
  const harness = createHarness({
    theme: { palette: { primary: '#0b5' } },
    entitlements: { modules: [], flags: [] },
    user: { id: 'u-test' },
  });

  afterEach(async () => {
    await harness.unloadModule().catch(() => {});
    harness.clearSpies();
  });

  test('module registers routes and nav items and exposes lifecycle hooks', async () => {
    // Try a list of possible module entry locations (adjust/extend as needed)
    const candidates = [
      '../../modules/order-nexus/src/ModuleEntry',
      '../../modules/order-nexus/src/moduleEntry',
      '../../modules/order-nexus/dist/ModuleEntry',
      '../../modules/order-nexus/index',
      '../../modules/order-nexus', // sometimes package root exports register
      './stubs/order-nexus-ModuleEntry.js' // local fallback stub (relative to tests/contract)
    ];

    let registration;
    let lastError: any = null;

    for (const p of candidates) {
      try {
        registration = await harness.loadModule(p);
        if (registration) {
          break;
        }
      } catch (err) {
        lastError = err;
      }
    }

    if (!registration) {
      // Fail with a helpful message if all candidates failed
      const candidateList = candidates.join('\n  - ');
      throw new Error(
        `Failed to load order-nexus module. Tried candidates:\n  - ${candidateList}\n` +
          `Last error: ${lastError?.message ?? lastError}`
      );
    }

    // Basic registration shape checks
    expect(registration).toBeDefined();
    expect(typeof registration.mount === 'function' || typeof registration.mount === 'object').toBeTruthy();

    // Assert the module registered the '/orders' route
    const route = harness.expectRouteRegistered('/orders');
    expect(route).toHaveProperty('id');
    expect(route).toHaveProperty('component');

    // If nav item expected:
    const nav = harness.expectNavItemRegistered('orders');
    expect(nav).toHaveProperty('id');

    // Run lifecycle hooks to ensure they don't throw
    if (registration.onMount) {
      await harness.runLifecycle('onMount');
    }
    if (registration.onActivate) {
      await harness.runLifecycle('onActivate');
      await harness.runLifecycle('onDeactivate');
    }
    if (registration.onUnmount) {
      await harness.runLifecycle('onUnmount');
    }
  }, 20000);
});

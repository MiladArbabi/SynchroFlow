// tests/unit/onboarding/specter-onboarding.provider.test.ts
const SHOP_ID_GOOD = 42;

// We need to isolate imports for each test
describe('specterOnboardingSignalProvider (unit)', () => {
  // Store original require cache
  let originalCache: NodeJS.RequireCache;
  
  beforeEach(() => {
    // Save the original require cache
    originalCache = { ...require.cache };
  });
  
  afterEach(() => {
    // Completely clear require cache
    jest.resetModules();
    // Restore original cache
    Object.keys(require.cache).forEach(key => {
      if (!originalCache[key]) {
        delete require.cache[key];
      }
    });
  });

  test('computes FT0 signals from sessions and events when store helpers present', async () => {
    // Clear all mocks and cache
    jest.resetModules();
    jest.clearAllMocks();

    // Mock the module with working functions
    jest.doMock('modules-specter/store/session-store', () => ({
      getSessionsLastNDays: jest.fn(async (shopId: number, days = 7) => {
        if (Number(shopId) === SHOP_ID_GOOD) {
          return [
            { sessionId: 's-1', shopId: SHOP_ID_GOOD, createdAt: '2025-12-01T00:00:00Z', exitIntent: false, pagesViewed: ['a'] },
            { sessionId: 's-2', shopId: SHOP_ID_GOOD, createdAt: '2025-12-02T00:00:00Z', exitIntent: true, pagesViewed: ['b','c'] }
          ];
        }
        return [];
      }),
      getRecentEvents: jest.fn(async (shopId: number, limit = 50) => {
        if (Number(shopId) === SHOP_ID_GOOD) {
          return [
            { type: 'page.view', timestamp: Date.now(), payload: { path: '/home' } },
            { type: 'exit.intent', timestamp: Date.now(), payload: { reason: 'close' } },
            { type: 'funnel.detected', timestamp: Date.now(), payload: { funnelId: 'f1' } }
          ];
        }
        return [];
      }),
      getShopConfig: jest.fn(async (shopId: number) => {
        if (Number(shopId) === SHOP_ID_GOOD) return { enabled: true, syncFrequency: 60 };
        return null;
      })
    }), { virtual: true });

    // Mock OTHER candidate paths to throw by importing canonical candidate list from the provider
    // so tests remain in sync with the provider's fallback list.
    const { SPECTER_STORE_CANDIDATES } = require('api-src/onboarding/readiness.providers');
    for (const candidate of SPECTER_STORE_CANDIDATES) {
      // skip the alias we already mocked above ('modules-specter/store/session-store')
      if (candidate === 'modules-specter/store/session-store') continue;
      jest.doMock(candidate, () => { throw new Error('Module not found'); }, { virtual: true });
    }

    // Force fresh import
    delete require.cache[require.resolve('api-src/onboarding/readiness.providers')];
    const providers = require('api-src/onboarding/readiness.providers');
    
    const signals = await providers.specterOnboardingSignalProvider.getSignals({ shopId: SHOP_ID_GOOD });
    const map: Record<string, any> = {};
    for (const s of signals) map[s.name] = s.value;

    expect(map['specter.sdkInstalled']).toBe(true);
    expect(map['specter.sessionVolume']).toBe(2);
    expect(map['specter.intentFeedActive']).toBe(true);
    expect(map['specter.exitIntentRate']).toBeGreaterThanOrEqual(0);
    expect(map['specter.topPageFunnelsDetected']).toBe(true);
    expect(map['specter.customerSignalFallbackMode']).toBe('integrated');
    expect(map['specter.config']).toMatchObject({ enabled: true, syncFrequency: 60 });
  });

  test('falls back safely when store helpers absent', async () => {
    // Clear everything
    jest.resetModules();
    jest.clearAllMocks();

     // Mock ALL candidate paths to throw by iterating the provider's canonical list.
    const { SPECTER_STORE_CANDIDATES } = require('api-src/onboarding/readiness.providers');
    for (const candidate of SPECTER_STORE_CANDIDATES) {
      jest.doMock(candidate, () => { throw new Error('Module not found'); }, { virtual: true });
    }

    // Force fresh import
    delete require.cache[require.resolve('api-src/onboarding/readiness.providers')];
    const providers = require('api-src/onboarding/readiness.providers');

    const signals = await providers.specterOnboardingSignalProvider.getSignals({ shopId: 9999 });
    
    const sdkInstalled = signals.find((s: any) => s.name === 'specter.sdkInstalled')?.value;
    const fallbackMode = signals.find((s: any) => s.name === 'specter.customerSignalFallbackMode')?.value;
    const sessionVolume = signals.find((s: any) => s.name === 'specter.sessionVolume')?.value;
    const intentFeedActive = signals.find((s: any) => s.name === 'specter.intentFeedActive')?.value;

    expect(sdkInstalled).toBe(false);
    expect(fallbackMode).toBe('fallback');
    expect(sessionVolume).toBe(0);
    expect(intentFeedActive).toBe(false);
  });
});
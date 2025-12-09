// tests/unit/api/insight-core.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';

describe('insightCoreOnboardingSignalProvider (DB-backed)', () => {
  const mockShopId = 1;
  const mockUserId = 123;

  /**
   * Helper: create a fake `db` module factory that returns chainable query builders.
   * countsMap: { 'canonical_orders': number, 'canonical_products': number }
   */
  function makeMockDb(countsMap: Record<string, number>) {
    // db(tableName) => query builder
    const dbFn = (tableName: string) => {
      return {
        where: (_: any) => ({
          count: (_countExpr: string) => ({
            first: async () => {
              // Return shape used by provider: { count: string }
              const val = countsMap[tableName] ?? 0;
              return { count: String(val) };
            }
          })
        })
      };
    };

    // default export (CommonJS / ESModule interop)
    return { __esModule: true, default: dbFn };
  }

  it('returns fallback zeros when DB mock throws (graceful fallback)', async () => {
    // Simulate DB module that throws when invoked.
    await jest.isolateModulesAsync(async () => {
      // Mock db to throw (simulate missing tables / runtime error)
      jest.doMock('api-src/db', () => {
        const bad = () => {
          throw new Error('DB missing');
        };
        return { __esModule: true, default: bad };
      });

      const { insightCoreOnboardingSignalProvider } = await import(
        'api-src/onboarding/readiness.providers'
      );

      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const map = Object.fromEntries(signals.map((s: ReadinessSignal) => [s.name, s.value]));
      expect(map['insightCore.orderCount']).toBe(0);
      expect(map['insightCore.productCount']).toBe(0);
      expect(map['insightCore.baseSignalsReady']).toBe(false);

      expect(signals).toHaveLength(3);

      const names = signals.map(s => s.name);
      expect(names).toEqual([
        'insightCore.orderCount',
        'insightCore.productCount',
        'insightCore.baseSignalsReady'
      ]);
    });
  });

  it('returns real counts and baseSignalsReady=true when DB has data', async () => {
    await jest.isolateModulesAsync(async () => {
      // Provide mock counts: 42 orders, 7 products
      const counts = {
        canonical_orders: 42,
        canonical_products: 7
      };
      jest.doMock('api-src/db', () => makeMockDb(counts));

      const { insightCoreOnboardingSignalProvider } = await import(
        'api-src/onboarding/readiness.providers'
      );

      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const map = Object.fromEntries(signals.map((s: ReadinessSignal) => [s.name, s.value]));
      expect(map['insightCore.orderCount']).toBe(42);
      expect(map['insightCore.productCount']).toBe(7);
      expect(map['insightCore.baseSignalsReady']).toBe(true);

      expect(signals).toHaveLength(3);

      const names = signals.map(s => s.name);
      expect(names).toEqual([
        'insightCore.orderCount',
        'insightCore.productCount',
        'insightCore.baseSignalsReady'
      ]);

      // Type assertions
      const orderCountSignal = signals.find(s => s.name === 'insightCore.orderCount');
      const productCountSignal = signals.find(s => s.name === 'insightCore.productCount');
      const baseReadySignal = signals.find(s => s.name === 'insightCore.baseSignalsReady');

      expect(typeof orderCountSignal!.value).toBe('number');
      expect(typeof productCountSignal!.value).toBe('number');
      expect(typeof baseReadySignal!.value).toBe('boolean');
    });
  });

  it('returns baseSignalsReady=false when one side is zero', async () => {
    await jest.isolateModulesAsync(async () => {
      // 10 orders, 0 products -> baseSignalsReady=false
      const counts = {
        canonical_orders: 10,
        canonical_products: 0
      };
      jest.doMock('api-src/db', () => makeMockDb(counts));

      const { insightCoreOnboardingSignalProvider } = await import(
        'api-src/onboarding/readiness.providers'
      );

      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const map = Object.fromEntries(signals.map((s: ReadinessSignal) => [s.name, s.value]));

      expect(map['insightCore.orderCount']).toBe(10);
      expect(map['insightCore.productCount']).toBe(0);
      expect(map['insightCore.baseSignalsReady']).toBe(false);
    });
  });

  it('has correct moduleId', async () => {
    // No need to mock db for this assertion
    await jest.isolateModulesAsync(async () => {
      // Provide zero counts for safety
      jest.doMock('api-src/db', () => makeMockDb({}));

      const { insightCoreOnboardingSignalProvider } = await import(
        'api-src/onboarding/readiness.providers'
      );

      expect(insightCoreOnboardingSignalProvider.moduleId).toBe('insight-core');
    });
  });

  it('maintains signal consistency across multiple calls', async () => {
    await jest.isolateModulesAsync(async () => {
      const countsForShops: Record<number, Record<string, number>> = {
        1: { canonical_orders: 1, canonical_products: 1 },
        2: { canonical_orders: 0, canonical_products: 0 },
        3: { canonical_orders: 5, canonical_products: 2 }
      };

      // For each shop, mock db and call provider
      for (const shopIdStr of Object.keys(countsForShops)) {
        const shopId = Number(shopIdStr);
        jest.doMock('api-src/db', () => makeMockDb(countsForShops[shopId]));
        const { insightCoreOnboardingSignalProvider } = await import(
          'api-src/onboarding/readiness.providers'
        );

        const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId, userId: mockUserId });
        expect(signals).toHaveLength(3);
        const signalNames = signals.map(s => s.name);
        expect(signalNames).toContain('insightCore.orderCount');
        expect(signalNames).toContain('insightCore.productCount');
        expect(signalNames).toContain('insightCore.baseSignalsReady');
      }
    });
  });
});

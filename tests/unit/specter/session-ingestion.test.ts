// tests/unit/specter/session-ingestion.test.ts
describe('session ingestion flow (PCD safety + store wiring)', () => {
  const mockSessionId = 'sess-TEST-INGEST';

  // Mock privacy guard to keep behavior deterministic for tests
  beforeEach(() => {
    jest.resetModules();
    jest.doMock('../../../modules/specter/src/session-id-service', () => ({
      __esModule: true,
      default: { generate: () => mockSessionId }
    }));
  });

  it('throws PCD_VIOLATION when raw customerId is present', async () => {
    await jest.isolateModulesAsync(async () => {
      // Import fresh copy so our mock above applies
      const { ingestRawSession } = await import('../../../modules/specter/src/ingestion/session-ingestion');

      const rawSession = {
        shopId: 1,
        customerId: 'customer-123',
        landingPage: '/home',
        pagesViewed: ['/p1'],
        exitIntent: false
      };

      // ingestRawSession is async and rejects on PCD — assert the Promise rejects.
      await expect((ingestRawSession as any)(1, rawSession)).rejects.toThrow(/PCD_VIOLATION/);
    });
  });

  it('stores normalized session and computeSessionMetrics returns expected values', async () => {
    await jest.isolateModulesAsync(async () => {
      // mock sessionIdService again for deterministic sessionId
      jest.doMock('../../../modules/specter/src/session-id-service', () => ({
        __esModule: true,
        default: { generate: () => mockSessionId }
      }));

      const { ingestRawSession, computeSessionMetrics } = await import('../../../modules/specter/src/ingestion/session-ingestion');

      // clear store between runs (module exports default sessionStore singleton)
      const { sessionStore } = await import('../../../modules/specter/src/store/session-store');
      sessionStore.reset();

      // two sessions: one exitIntent=true with /product, one exitIntent=false
      const s1 = {
        shopId: 10,
        landingPage: '/product',
        pagesViewed: ['/product', '/checkout'],
        exitIntent: true
      };

      const s2 = {
        shopId: 10,
        landingPage: '/product',
        pagesViewed: ['/product'],
        exitIntent: false
      };

      // Ensure ingestion completes before computing metrics
      await ingestRawSession(10, s1 as any);
      await ingestRawSession(10, s2 as any);

      const metrics = computeSessionMetrics(10, 7);

      expect(metrics.sessionVolume).toBe(2);
      expect(metrics.exitIntentRate).toBeCloseTo(0.5);

      // funnel detection: '/product' appears twice in exit sessions -> true
      expect(metrics.topPageFunnelsDetected).toBe(true);

      // verify normalized session fields exist in store
      const all = sessionStore.getAllSessionsForShop(10);
      expect(all.length).toBe(2);
      expect(all[0].sessionId).toBeDefined();
      expect(all[0].createdAt).toBeDefined();
    });
  });
});

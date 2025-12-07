// tests/unit/api/insight-core.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { insightCoreOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

describe('insightCoreOnboardingSignalProvider', () => {
  const mockShopId = 1;
  const mockUserId = 123;

  describe('getSignals', () => {
    it('returns base insightCore signals with stubbed values', async () => {
      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));
      expect(map['insightCore.orderCount']).toBe(0);
      expect(map['insightCore.productCount']).toBe(0);
      expect(map['insightCore.baseSignalsReady']).toBe(false);
    });

    it('returns exactly three signals', async () => {
      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      expect(signals).toHaveLength(3);
    });

    it('returns signals in expected order', async () => {
      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const names = signals.map(s => s.name);
      
      expect(names).toEqual([
        'insightCore.orderCount',
        'insightCore.productCount',
        'insightCore.baseSignalsReady'
      ]);
    });

    it('has correct signal types', async () => {
      const signals = await insightCoreOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      
      const orderCountSignal = signals.find(s => s.name === 'insightCore.orderCount');
      const productCountSignal = signals.find(s => s.name === 'insightCore.productCount');
      const baseReadySignal = signals.find(s => s.name === 'insightCore.baseSignalsReady');
      
      expect(typeof orderCountSignal!.value).toBe('number');
      expect(typeof productCountSignal!.value).toBe('number');
      expect(typeof baseReadySignal!.value).toBe('boolean');
    });

    it('works with userId parameter', async () => {
      const signals = await insightCoreOnboardingSignalProvider.getSignals({ 
        shopId: mockShopId, 
        userId: mockUserId 
      });
      
      expect(signals).toHaveLength(3);
      expect(signals.every(s => typeof s.name === 'string')).toBe(true);
    });

    it('has correct moduleId', () => {
      expect(insightCoreOnboardingSignalProvider.moduleId).toBe('insight-core');
    });

    it('maintains signal consistency across multiple calls', async () => {
      const calls = await Promise.all([
        insightCoreOnboardingSignalProvider.getSignals({ shopId: 1 }),
        insightCoreOnboardingSignalProvider.getSignals({ shopId: 2 }),
        insightCoreOnboardingSignalProvider.getSignals({ shopId: 3, userId: 123 })
      ]);

      // All calls should return the same structure
      calls.forEach(signals => {
        expect(signals).toHaveLength(3);
        const signalNames = signals.map(s => s.name);
        expect(signalNames).toContain('insightCore.orderCount');
        expect(signalNames).toContain('insightCore.productCount');
        expect(signalNames).toContain('insightCore.baseSignalsReady');
      });
    });
  });
});
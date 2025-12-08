// tests/unit/api/wms-lite.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { wmsLiteOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

describe('wmsLiteOnboardingSignalProvider', () => {
  const mockShopId = 1;
  const mockUserId = 123;

  describe('getSignals', () => {
    it('exposes a stubbed wmsLite.enabled signal', async () => {
      const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));
      expect(map['wmsLite.enabled']).toBe(false);
    });

    it('returns exactly one signal', async () => {
      const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      expect(signals).toHaveLength(1);
    });

    it('signal has correct structure', async () => {
      const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const signal = signals[0];
      
      expect(signal).toEqual({
        name: 'wmsLite.enabled',
        value: false
      });
    });

    it('signal value is always boolean false', async () => {
      const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const signal = signals[0];
      
      expect(signal.value).toBe(false);
      expect(typeof signal.value).toBe('boolean');
    });

    it('works with optional userId parameter', async () => {
      const signals = await wmsLiteOnboardingSignalProvider.getSignals({ 
        shopId: mockShopId, 
        userId: mockUserId 
      });
      
      expect(signals).toHaveLength(1);
      expect(signals[0].name).toBe('wmsLite.enabled');
    });

    it('has correct moduleId', () => {
      expect(wmsLiteOnboardingSignalProvider.moduleId).toBe('wms-lite');
    });

    it('returns consistent results across multiple shopIds', async () => {
      const testShopIds = [1, 100, 999, 0, -1];
      
      for (const shopId of testShopIds) {
        const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId });
        expect(signals).toHaveLength(1);
        expect(signals[0]).toEqual({
          name: 'wmsLite.enabled',
          value: false
        });
      }
    });

    describe('edge cases', () => {
      it('handles null/undefined userId gracefully', async () => {
        const signals1 = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        const signals2 = await wmsLiteOnboardingSignalProvider.getSignals({ 
          shopId: mockShopId, 
          userId: undefined 
        });
        
        expect(signals1).toEqual(signals2);
      });

      it('maintains signal immutability', async () => {
        const signals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        const originalSignal = { ...signals[0] };
        
        // Attempt to mutate (should not affect anything but testing defensive programming)
        (signals as any)[0].value = true;
        
        // New call should still return original value
        const newSignals = await wmsLiteOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        expect(newSignals[0].value).toBe(false);
      });
    });
  });
});
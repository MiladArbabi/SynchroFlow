// tests/unit/api/return-nexus.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { returnNexusOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

describe('returnNexusOnboardingSignalProvider', () => {
  const mockShopId = 1;
  const mockUserId = 123;

  describe('getSignals', () => {
    it('returns stubbed returnNexus signals', async () => {
      const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));
      expect(map['returnNexus.enabled']).toBe(false);
      expect(map['returnNexus.returnsTracked']).toBe(0);
    });

    it('returns exactly two signals', async () => {
      const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      expect(signals).toHaveLength(2);
    });

    it('has correct signal types and values', async () => {
      const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      
      const enabledSignal = signals.find(s => s.name === 'returnNexus.enabled');
      const returnsSignal = signals.find(s => s.name === 'returnNexus.returnsTracked');
      
      expect(enabledSignal).toBeDefined();
      expect(returnsSignal).toBeDefined();
      expect(enabledSignal!.value).toBe(false);
      expect(returnsSignal!.value).toBe(0);
    });

    it('returns signals in consistent order', async () => {
      const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const names = signals.map(s => s.name);
      
      expect(names).toEqual(['returnNexus.enabled', 'returnNexus.returnsTracked']);
    });

    it('accepts userId parameter without error', async () => {
      const signals = await returnNexusOnboardingSignalProvider.getSignals({ 
        shopId: mockShopId, 
        userId: mockUserId 
      });
      
      expect(Array.isArray(signals)).toBe(true);
      expect(signals.length).toBe(2);
    });

    it('has correct moduleId', () => {
      expect(returnNexusOnboardingSignalProvider.moduleId).toBe('return-nexus');
    });

    it('provides predictable output for edge cases', async () => {
      // Test with zero shopId
      const signals1 = await returnNexusOnboardingSignalProvider.getSignals({ shopId: 0 });
      
      // Test with very large shopId
      const signals2 = await returnNexusOnboardingSignalProvider.getSignals({ shopId: 999999 });
      
      expect(signals1).toEqual(signals2);
      expect(signals1.every(s => 
        s.name === 'returnNexus.enabled' || s.name === 'returnNexus.returnsTracked'
      )).toBe(true);
    });

    describe('signal validation', () => {
      it('enabled signal is boolean', async () => {
        const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        const enabledSignal = signals.find(s => s.name === 'returnNexus.enabled');
        expect(typeof enabledSignal!.value).toBe('boolean');
      });

      it('returnsTracked signal is number', async () => {
        const signals = await returnNexusOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        const returnsSignal = signals.find(s => s.name === 'returnNexus.returnsTracked');
        expect(typeof returnsSignal!.value).toBe('number');
      });
    });
  });
});
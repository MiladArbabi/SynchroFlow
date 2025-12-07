// tests/unit/api/specter.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { specterOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

describe('specterOnboardingSignalProvider', () => {
  const mockShopId = 1;
  const mockUserId = 123;

  describe('getSignals', () => {
    it('returns signals in correct format', async () => {
      const signals = await specterOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      expect(Array.isArray(signals)).toBe(true);
      expect(signals.length).toBeGreaterThan(0);
      signals.forEach(signal => {
        expect(signal).toHaveProperty('name');
        expect(signal).toHaveProperty('value');
        expect(typeof signal.name).toBe('string');
      });
    });

    it('returns a specter.sdkInstalled signal with false value', async () => {
      const signals = await specterOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const sdkSignal = signals.find(s => s.name === 'specter.sdkInstalled');
      expect(sdkSignal).toBeDefined();
      expect(sdkSignal!.value).toBe(false);
    });

    it('contains exactly the expected signals', async () => {
      const signals = await specterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      
      const signalNames = signals.map(s => s.name);
      expect(signalNames).toEqual(['specter.sdkInstalled']);
    });

    it('works with userId provided', async () => {
      const signals = await specterOnboardingSignalProvider.getSignals({ 
        shopId: mockShopId, 
        userId: mockUserId 
      });

      expect(Array.isArray(signals)).toBe(true);
      const sdkSignal = signals.find(s => s.name === 'specter.sdkInstalled');
      expect(sdkSignal).toBeDefined();
    });

    it('has correct moduleId', () => {
      expect(specterOnboardingSignalProvider.moduleId).toBe('specter');
    });

    it('returns consistent signal values for same input', async () => {
      const signals1 = await specterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const signals2 = await specterOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      expect(signals1).toEqual(signals2);
    });

    it('handles different shopIds consistently', async () => {
      const signals1 = await specterOnboardingSignalProvider.getSignals({ shopId: 1 });
      const signals2 = await specterOnboardingSignalProvider.getSignals({ shopId: 999 });

      // Both should return the same stubbed structure
      expect(signals1.length).toBe(signals2.length);
      expect(signals1[0].name).toBe(signals2[0].name);
      expect(signals1[0].value).toBe(signals2[0].value);
    });
  });
});
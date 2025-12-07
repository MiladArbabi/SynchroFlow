// tests/unit/api/problem-center.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { problemCenterOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

describe('problemCenterOnboardingSignalProvider', () => {
  const mockShopId = 1;
  const mockUserId = 123;

  describe('getSignals', () => {
    it('exposes a stubbed problemCenter.enabled signal', async () => {
      const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });

      const map = Object.fromEntries(signals.map((s) => [s.name, s.value]));
      expect(map['problemCenter.enabled']).toBe(false);
    });

    it('returns exactly one signal', async () => {
      const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      expect(signals).toHaveLength(1);
    });

    it('signal matches expected structure', async () => {
      const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      
      expect(signals[0]).toMatchObject({
        name: 'problemCenter.enabled',
        value: expect.any(Boolean)
      });
      expect(signals[0].value).toBe(false);
    });

    it('signal name follows naming convention', async () => {
      const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
      const signalName = signals[0].name;
      
      expect(signalName).toMatch(/^problemCenter\.[a-zA-Z]+$/);
      expect(signalName.startsWith('problemCenter.')).toBe(true);
    });

    it('works with userId parameter', async () => {
      const signals = await problemCenterOnboardingSignalProvider.getSignals({ 
        shopId: mockShopId, 
        userId: mockUserId 
      });
      
      expect(signals).toHaveLength(1);
      expect(signals[0].name).toBe('problemCenter.enabled');
      expect(signals[0].value).toBe(false);
    });

    it('has correct moduleId', () => {
      expect(problemCenterOnboardingSignalProvider.moduleId).toBe('problem-center');
    });

    it('provides deterministic output', async () => {
      const results = await Promise.all([
        problemCenterOnboardingSignalProvider.getSignals({ shopId: 1 }),
        problemCenterOnboardingSignalProvider.getSignals({ shopId: 1 }),
        problemCenterOnboardingSignalProvider.getSignals({ shopId: 1, userId: 123 })
      ]);
      
      // All results should be identical
      results.forEach(result => {
        expect(result).toEqual([{ name: 'problemCenter.enabled', value: false }]);
      });
    });

    describe('signal properties', () => {
      it('signal value is boolean type', async () => {
        const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        expect(typeof signals[0].value).toBe('boolean');
      });

      it('signal is always disabled in stub', async () => {
        const signals = await problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        expect(signals[0].value).toBe(false);
      });
    });

    describe('provider interface compliance', () => {
      it('implements OnboardingSignalProvider interface', () => {
        expect(problemCenterOnboardingSignalProvider).toHaveProperty('moduleId');
        expect(problemCenterOnboardingSignalProvider).toHaveProperty('getSignals');
        expect(typeof problemCenterOnboardingSignalProvider.getSignals).toBe('function');
      });

      it('getSignals returns Promise<ReadinessSignal[]>', async () => {
        const result = problemCenterOnboardingSignalProvider.getSignals({ shopId: mockShopId });
        expect(result).toBeInstanceOf(Promise);
        
        const signals = await result;
        expect(Array.isArray(signals)).toBe(true);
        if (signals.length > 0) {
          expect(signals[0]).toHaveProperty('name');
          expect(signals[0]).toHaveProperty('value');
        }
      });
    });
  });
});
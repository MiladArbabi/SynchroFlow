// tests/unit/onboarding/specter.provider.test.ts
import { ReadinessSignal } from '@lasyncro/shared';
import { specterOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';
import { ModuleOnboardingReadiness } from '@lasyncro/shared';

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
      if (!sdkSignal) throw new Error('specter.sdkInstalled signal missing');
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

  describe('specterOnboardingSignalProvider & onboarding integration', () => {
    const shopId = 100;
    const userId = 200;

    it('specter provider exposes specter.sdkInstalled signal and moduleId', async () => {
      // Import the real provider (no mocking) directly from providers file
      const { specterOnboardingSignalProvider } = await import(
        'api-src/onboarding/readiness.providers'
      );

      expect(specterOnboardingSignalProvider.moduleId).toBe('specter');

      const signals = await specterOnboardingSignalProvider.getSignals({ shopId });
      expect(Array.isArray(signals)).toBe(true);

      const sdkSignal = signals.find((s: any) => s.name === 'specter.sdkInstalled');
      expect(sdkSignal).toBeDefined();
      if (!sdkSignal) throw new Error('specter.sdkInstalled signal missing (integration test)');
      expect(typeof sdkSignal.value).toBe('boolean');
    });

    it('OnboardingReadinessService marks specter tasks complete when specter.sdkInstalled=true', async () => {
      await jest.isolateModulesAsync(async () => {
        // Mock onboarding providers to return a specter provider that says sdkInstalled = true
        const mockProvider = {
          moduleId: 'specter',
          getSignals: async () => [
            { name: 'specter.sdkInstalled', value: true }
          ]
        };

        jest.doMock('api-src/onboarding/readiness.providers', () => ({
          __esModule: true,
          onboardingSignalProviders: [mockProvider]
        }));

        // Import the manifest and service after mocking providers
        const { MODULE_ONBOARDING_MANIFESTS } = await import('api-src/onboarding/readiness.manifest');
        const { OnboardingReadinessService } = await import('api-src/onboarding/readiness.service');

        const service = new OnboardingReadinessService();
        const snapshot = await service.getSnapshot({ shopId, userId });

        expect(snapshot).toBeDefined();
        const specterModule = snapshot.modules.find((m: ModuleOnboardingReadiness) => m.moduleId === 'specter');
        expect(specterModule).toBeDefined();
        if (!specterModule) throw new Error('specter module missing in snapshot');

        // Find the task that checks specter.sdkInstalled in the manifest
        const sdkTask = specterModule!.tasks.find((t: any) =>
          t.completionRules?.some((r: any) => r.signal === 'specter.sdkInstalled')
        );

        expect(sdkTask).toBeDefined();
        if (!sdkTask) throw new Error('specter sdk task missing in manifest');
        expect(sdkTask.complete).toBe(true);
      });
    });

    it('OnboardingReadinessService marks specter tasks incomplete when specter.sdkInstalled=false', async () => {
      await jest.isolateModulesAsync(async () => {
        // Mock provider returning false
        const mockProvider = {
          moduleId: 'specter',
          getSignals: async () => [
            { name: 'specter.sdkInstalled', value: false }
          ]
        };

        jest.doMock('api-src/onboarding/readiness.providers', () => ({
          __esModule: true,
          onboardingSignalProviders: [mockProvider]
        }));

        const { OnboardingReadinessService } = await import('api-src/onboarding/readiness.service');
        const service = new OnboardingReadinessService();
        const snapshot = await service.getSnapshot({ shopId, userId });

        const specterModule = snapshot.modules.find((m: ModuleOnboardingReadiness) => m.moduleId === 'specter');
        expect(specterModule).toBeDefined();
        if (!specterModule) throw new Error('specter module missing in snapshot (false case)');

        const sdkTask = specterModule!.tasks.find((t: any) =>
          t.completionRules?.some((r: any) => r.signal === 'specter.sdkInstalled')
        );

        expect(sdkTask).toBeDefined();
        if (!sdkTask) throw new Error('specter sdk task missing in manifest (false case)');
        expect(sdkTask.complete).toBe(false);
      });
    });
  });
});

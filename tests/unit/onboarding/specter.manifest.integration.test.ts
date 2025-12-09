// tests/unit/onboarding/specter.manifest.integration.test.ts
import { ModuleOnboardingReadiness } from '@lasyncro/shared';

describe('OnboardingReadinessService — Specter manifest integration (red tests)', () => {
  const shopId = 500;
  const userId = 600;

  it('marks reviewBehaviorSnapshot complete when sessionVolume >= 1', async () => {
    await jest.isolateModulesAsync(async () => {
      // Mock provider returning sessionVolume >= 1 (and other signals)
      const mockProvider = {
        moduleId: 'specter',
        getSignals: async () => [
          { name: 'specter.sdkInstalled', value: true },
          { name: 'specter.sessionVolume', value: 5 },
          { name: 'specter.intentFeedActive', value: 'medium' },
          { name: 'specter.exitIntentRate', value: 0.12 },
          { name: 'specter.topPageFunnelsDetected', value: false },
          { name: 'specter.customerSignalFallbackMode', value: 'default' }
        ]
      };

      jest.doMock('api-src/onboarding/readiness.providers', () => ({
        __esModule: true,
        onboardingSignalProviders: [mockProvider]
      }));

      const { OnboardingReadinessService } = await import('api-src/onboarding/readiness.service');
      const service = new OnboardingReadinessService();
      const snapshot = await service.getSnapshot({ shopId, userId });

      expect(snapshot).toBeDefined();
      const specterModule = snapshot.modules.find((m: ModuleOnboardingReadiness) => m.moduleId === 'specter');
      expect(specterModule).toBeDefined();
      if (!specterModule) throw new Error('specter module missing in snapshot');

      const reviewTask = specterModule.tasks.find((t: any) => t.id === 'specter.reviewBehaviorSnapshot');
      expect(reviewTask).toBeDefined();
      if (!reviewTask) throw new Error('specter.reviewBehaviorSnapshot task missing');
      expect(reviewTask.complete).toBe(true);
    });
  });

  it('keeps reviewBehaviorSnapshot incomplete when sessionVolume = 0 and no funnels detected', async () => {
    await jest.isolateModulesAsync(async () => {
      // Mock provider returning only sdkInstalled true but no sessionVolume
      const mockProvider = {
        moduleId: 'specter',
        getSignals: async () => [
          { name: 'specter.sdkInstalled', value: true },
          { name: 'specter.sessionVolume', value: 0 },
          { name: 'specter.intentFeedActive', value: false },
          { name: 'specter.exitIntentRate', value: 0 },
          { name: 'specter.topPageFunnelsDetected', value: false },
          { name: 'specter.customerSignalFallbackMode', value: 'default' }
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

      const reviewTask = specterModule.tasks.find((t: any) => t.id === 'specter.reviewBehaviorSnapshot');
      expect(reviewTask).toBeDefined();
      if (!reviewTask) throw new Error('specter.reviewBehaviorSnapshot task missing in manifest (false case)');
      expect(reviewTask.complete).toBe(false);
    });
  });

  it('marks reviewBehaviorSnapshot complete when topPageFunnelsDetected=true even if sessionVolume=0', async () => {
    await jest.isolateModulesAsync(async () => {
      // Mock provider returning funnels detected
      const mockProvider = {
        moduleId: 'specter',
        getSignals: async () => [
          { name: 'specter.sdkInstalled', value: false },
          { name: 'specter.sessionVolume', value: 0 },
          { name: 'specter.intentFeedActive', value: 'low' },
          { name: 'specter.exitIntentRate', value: 0 },
          { name: 'specter.topPageFunnelsDetected', value: true },
          { name: 'specter.customerSignalFallbackMode', value: 'default' }
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
      if (!specterModule) throw new Error('specter module missing in snapshot (funnels case)');

      const reviewTask = specterModule.tasks.find((t: any) => t.id === 'specter.reviewBehaviorSnapshot');
      expect(reviewTask).toBeDefined();
      if (!reviewTask) throw new Error('specter.reviewBehaviorSnapshot task missing (funnels case)');
      expect(reviewTask.complete).toBe(true);
    });
  });
});

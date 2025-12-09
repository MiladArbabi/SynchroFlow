// tests/unit/onboarding/readiness.service.insightcore.test.ts
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import { ModuleOnboardingReadiness } from '@lasyncro/shared';

describe('OnboardingReadinessService — insight-core integration', () => {
  const shopId = 1;
  const userId = 11;

  it('computes insight-core tasks as complete when base signals are present', async () => {
    await jest.isolateModulesAsync(async () => {
      // Mock the onboardingSignalProviders module to return a single insight-core provider
      const mockProvider = {
        moduleId: 'insight-core',
        getSignals: async ({ shopId: s }: { shopId: number }) => {
          // Provide signals that mark baseSignalsReady
          return [
            { name: 'insightCore.orderCount', value: 42 },
            { name: 'insightCore.productCount', value: 7 },
            { name: 'insightCore.baseSignalsReady', value: true }
          ];
        }
      };

      jest.doMock('api-src/onboarding/readiness.providers', () => {
        return {
          __esModule: true,
          onboardingSignalProviders: [mockProvider]
        };
      });

      // Import manifest and service AFTER mocking providers
      const { MODULE_ONBOARDING_MANIFESTS } = await import('api-src/onboarding/readiness.manifest');
      const { OnboardingReadinessService } = await import('api-src/onboarding/readiness.service');

      const service = new OnboardingReadinessService();
      const snapshot = await service.getSnapshot({ shopId, userId });

      expect(snapshot).toBeDefined();
      expect(snapshot.shopId).toBe(shopId);
      expect(Array.isArray(snapshot.modules)).toBe(true);

      // Find the insight-core entry in the returned modules
      const insightModule = snapshot.modules.find((m: ModuleOnboardingReadiness) => m.moduleId === 'insight-core');
      expect(insightModule).toBeDefined();
      if (!insightModule) throw new Error('insight-core module missing from snapshot');

      // Tasks should be present and marked complete
      const tasks = insightModule!.tasks || [];
      const baseTask = tasks.find((t: any) => t.id === 'insight-core-base-signals');
      const viewTopDriver = tasks.find((t: any) => t.id === 'insight-core-view-top-driver');
      const exploreBaseline = tasks.find((t: any) => t.id === 'insight-core-explore-baseline');

      // runtime guards for TS compiler / safety
      expect(baseTask).toBeDefined();
      if (!baseTask) throw new Error('baseTask not found');

      expect(viewTopDriver).toBeDefined();
      if (!viewTopDriver) throw new Error('viewTopDriver not found');

      expect(exploreBaseline).toBeDefined();
      if (!exploreBaseline) throw new Error('exploreBaseline not found');

      // All three tasks should be marked complete when baseSignalsReady=true and counts >=1
      expect((baseTask as any).complete).toBe(true);
      expect((viewTopDriver as any).complete).toBe(true);
      expect((exploreBaseline as any).complete).toBe(true);

      // isReady type is boolean
      expect(typeof insightModule!.isReady).toBe('boolean');

      // Signals exposed should match what the provider returned
      const signalNames = (insightModule!.signals || []).map((s: any) => s.name);
      expect(signalNames).toEqual([
        'insightCore.orderCount',
        'insightCore.productCount',
        'insightCore.baseSignalsReady'
      ]);
    });
  });

  it('computes insight-core tasks as incomplete when baseSignalsReady=false', async () => {
    await jest.isolateModulesAsync(async () => {
      const mockProvider = {
        moduleId: 'insight-core',
        getSignals: async ({ shopId: s }: { shopId: number }) => {
          // Provide signals that mark baseSignalsReady false
          return [
            { name: 'insightCore.orderCount', value: 0 },
            { name: 'insightCore.productCount', value: 0 },
            { name: 'insightCore.baseSignalsReady', value: false }
          ];
        }
      };

      jest.doMock('api-src/onboarding/readiness.providers', () => {
        return {
          __esModule: true,
          onboardingSignalProviders: [mockProvider]
        };
      });

      const { OnboardingReadinessService } = await import('api-src/onboarding/readiness.service');
      const service = new OnboardingReadinessService();
      const snapshot = await service.getSnapshot({ shopId, userId });

      const insightModule = snapshot.modules.find((m: ModuleOnboardingReadiness) => m.moduleId === 'insight-core');
      expect(insightModule).toBeDefined();
      if (!insightModule) throw new Error('insight-core module missing from snapshot (false case)');

      const tasks = insightModule!.tasks || [];
      const baseTask = tasks.find((t: any) => t.id === 'insight-core-base-signals');
      const viewTopDriver = tasks.find((t: any) => t.id === 'insight-core-view-top-driver');
      const exploreBaseline = tasks.find((t: any) => t.id === 'insight-core-explore-baseline');

      // runtime guards
      expect(baseTask).toBeDefined();
      if (!baseTask) throw new Error('baseTask not found (false case)');

      expect(viewTopDriver).toBeDefined();
      if (!viewTopDriver) throw new Error('viewTopDriver not found (false case)');

      expect(exploreBaseline).toBeDefined();
      if (!exploreBaseline) throw new Error('exploreBaseline not found (false case)');

      expect((baseTask as any).complete).toBe(false);
      expect((viewTopDriver as any).complete).toBe(false);
      // exploreBaseline requires orderCount >=1 and productCount >=1, so should be false
      expect((exploreBaseline as any).complete).toBe(false);
    });
  });
});
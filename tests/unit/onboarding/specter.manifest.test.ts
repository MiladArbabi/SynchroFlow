// tests/unit/api/specter.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';
import { ModuleOnboardingReadiness } from '@lasyncro/shared';

describe('Onboarding manifest – specter module', () => {
  const findSpecterManifest = () =>
    MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'specter');

  describe('module presence and structure', () => {
    it('includes a specter module manifest', () => {
      const specter = findSpecterManifest();
      expect(specter).toBeDefined();
    });

    it('has correct moduleId', () => {
      const specter = findSpecterManifest();
      expect(specter?.moduleId).toBe('specter');
    });

    it('has appropriate displayName', () => {
      const specter = findSpecterManifest();
      expect(specter?.displayName).toBe('Customer & Conversion (Specter)');
    });

    it('matches the ModuleOnboardingReadiness interface (excluding isReady and signals)', () => {
      const specter = findSpecterManifest();
      expect(specter).toMatchObject({
        moduleId: expect.any(String),
        displayName: expect.any(String),
        requiredSignals: expect.any(Array),
        tasks: expect.any(Array),
      });
    });
  });

  describe('requiredSignals validation', () => {
    it('declares exactly one required signal', () => {
      const specter = findSpecterManifest();
      expect(specter?.requiredSignals).toHaveLength(1);
    });

    it('includes specter.sdkInstalled signal', () => {
      const specter = findSpecterManifest();
      expect(specter?.requiredSignals).toContain('specter.sdkInstalled');
    });

    it('has no duplicate signals', () => {
      const specter = findSpecterManifest();
      const signals = specter?.requiredSignals || [];
      const uniqueSignals = new Set(signals);
      expect(uniqueSignals.size).toBe(signals.length);
    });

    it('signal names follow naming convention', () => {
      const specter = findSpecterManifest();
      const signals = specter?.requiredSignals || [];
      
      signals.forEach(signalName => {
        expect(signalName).toMatch(/^[a-zA-Z]+(?:\.[a-zA-Z]+)+$/);
      });
    });
  });

  describe('tasks validation', () => {
    it('defines exactly one task', () => {
      const specter = findSpecterManifest();
      expect(specter?.tasks).toHaveLength(1);
    });

    it('task has correct id', () => {
      const specter = findSpecterManifest();
      const taskIds = specter?.tasks.map(t => t.id) || [];
      expect(taskIds).toContain('specter-sdk-installed');
    });

    describe('task structure', () => {
      let task: any;

      beforeEach(() => {
        const specter = findSpecterManifest();
        task = specter?.tasks.find(t => t.id === 'specter-sdk-installed');
      });

      it('task exists', () => {
        expect(task).toBeDefined();
      });

      it('has correct label', () => {
        expect(task?.label).toBe('Enable Specter tracking');
      });

      it('is not required (optional)', () => {
        expect(task?.required).toBe(false);
      });

      it('has exactly one completion rule', () => {
        expect(task?.completionRules).toHaveLength(1);
      });

      it('completion rule references correct signal', () => {
        const rule = task?.completionRules[0];
        expect(rule?.signal).toBe('specter.sdkInstalled');
        expect(rule?.expectedValue).toBe(true);
        expect(rule?.operator).toBeUndefined(); // Default operator is 'equals'
      });

      it('has external action configuration', () => {
        expect(task?.action).toEqual({
          type: 'openExternal',
          target: 'https://docs.lasyncro.com/specter/getting-started'
        });
      });
    });
  });

  describe('integration with signals', () => {
    it('required signals match task completion rule signals', () => {
      const specter = findSpecterManifest();
      const requiredSignals = specter?.requiredSignals || [];
      const taskSignals = specter?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      // All signals used in tasks should be in requiredSignals
      taskSignals.forEach(signal => {
        expect(requiredSignals).toContain(signal);
      });
    });
  });

  describe('manifest array properties', () => {
    it('specter module is in the correct position in the array', () => {
      const index = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'specter');
      expect(index).toBeGreaterThanOrEqual(3); // After platform, order-nexus, sku-os
      expect(index).toBeLessThan(MODULE_ONBOARDING_MANIFESTS.length);
    });

    it('moduleIds are unique in the manifest array', () => {
      const moduleIds = MODULE_ONBOARDING_MANIFESTS.map(m => m.moduleId);
      const uniqueIds = new Set(moduleIds);
      expect(uniqueIds.size).toBe(moduleIds.length);
    });
  });
});
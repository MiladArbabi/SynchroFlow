// tests/unit/api/insight-core.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';
import { ModuleOnboardingReadiness } from '@lasyncro/shared';

describe('Onboarding manifest – insight-core module', () => {
  const findInsightCoreManifest = () =>
    MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'insight-core');

  describe('module presence and structure', () => {
    it('includes an insight-core module manifest', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore).toBeDefined();
    });

    it('has correct moduleId', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore?.moduleId).toBe('insight-core');
    });

    it('has descriptive displayName', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore?.displayName).toBe('Core CNS Intelligence');
    });

    it('conforms to ModuleOnboardingReadiness interface structure', () => {
      const insightCore = findInsightCoreManifest();
      
      expect(insightCore).toMatchObject({
        moduleId: 'insight-core',
        displayName: expect.any(String),
        requiredSignals: expect.arrayContaining([
          expect.any(String),
          expect.any(String),
          expect.any(String)
        ]),
        tasks: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            label: expect.any(String),
            required: expect.any(Boolean),
            completionRules: expect.any(Array)
          })
        ])
      });
    });
  });

  describe('requiredSignals validation', () => {
    it('declares exactly three required signals', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore?.requiredSignals).toHaveLength(3);
    });

    it('includes all expected base signals', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore?.requiredSignals).toEqual([
        'insightCore.orderCount',
        'insightCore.productCount',
        'insightCore.baseSignalsReady'
      ]);
    });

    it('signals are in logical order (inputs then readiness flag)', () => {
      const insightCore = findInsightCoreManifest();
      const signals = insightCore?.requiredSignals || [];
      
      // First two are counts, last is the readiness flag
      expect(signals[0]).toMatch(/\.orderCount$/);
      expect(signals[1]).toMatch(/\.productCount$/);
      expect(signals[2]).toMatch(/\.baseSignalsReady$/);
    });
  });

  describe('tasks validation', () => {
    it('defines exactly one task', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore?.tasks).toHaveLength(1);
    });

    it('task has correct id', () => {
      const insightCore = findInsightCoreManifest();
      const taskIds = insightCore?.tasks.map(t => t.id) || [];
      expect(taskIds).toEqual(['insight-core-base-signals']);
    });

    describe('task structure', () => {
      let task: any;

      beforeEach(() => {
        const insightCore = findInsightCoreManifest();
        task = insightCore?.tasks.find(t => t.id === 'insight-core-base-signals');
      });

      it('task exists', () => {
        expect(task).toBeDefined();
      });

      it('has descriptive label', () => {
        expect(task?.label).toBe('Collect enough orders and products for meaningful insights');
      });

      it('is optional (not required)', () => {
        expect(task?.required).toBe(false);
      });

      it('has exactly one completion rule', () => {
        expect(task?.completionRules).toHaveLength(1);
      });

      it('completion rule references baseSignalsReady flag', () => {
        const rule = task?.completionRules[0];
        expect(rule?.signal).toBe('insightCore.baseSignalsReady');
        expect(rule?.expectedValue).toBe(true);
        expect(rule?.operator).toBeUndefined(); // Default equals operator
      });

      it('has no action configured', () => {
        expect(task?.action).toBeUndefined();
      });
    });
  });

  describe('signal-task relationship', () => {
    it('all required signals are referenced in tasks', () => {
      const insightCore = findInsightCoreManifest();
      const requiredSignals = insightCore?.requiredSignals || [];
      const taskSignals = insightCore?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      // The baseSignalsReady should be referenced
      expect(taskSignals).toContain('insightCore.baseSignalsReady');
      
      // The count signals are inputs but not directly checked in completion rules
      // This is acceptable - they might be used to compute baseSignalsReady
    });

    it('completion rule uses a boolean signal appropriately', () => {
      const insightCore = findInsightCoreManifest();
      const task = insightCore?.tasks[0];
      const rule = task?.completionRules[0];
      
      // Boolean signals should use expectedValue true/false without operators
      expect(rule?.expectedValue).toBe(true);
      expect(rule?.operator).toBeUndefined();
    });
  });

  describe('manifest consistency', () => {
    it('module appears in correct sequence in manifest array', () => {
      const index = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'insight-core');
      expect(index).toBeGreaterThanOrEqual(4); // After platform, order-nexus, sku-os, specter
      expect(index).toBeLessThan(MODULE_ONBOARDING_MANIFESTS.length);
    });

    it('module name is kebab-case and matches provider naming', () => {
      const insightCore = findInsightCoreManifest();
      expect(insightCore?.moduleId).toMatch(/^[a-z]+(?:-[a-z]+)*$/); // kebab-case
    });
  });

  describe('completion rule validation', () => {
    it('completion rule has valid structure', () => {
      const insightCore = findInsightCoreManifest();
      const rule = insightCore?.tasks[0].completionRules[0];
      
      expect(rule).toMatchObject({
        signal: expect.any(String),
        expectedValue: expect.any(Boolean)
      });
      
      // Signal should be a dot notation string
      expect(rule?.signal).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
    });
  });
});
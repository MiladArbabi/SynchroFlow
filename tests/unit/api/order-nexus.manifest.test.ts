// tests/unit/api/order-nexus.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Onboarding manifest - order-nexus module', () => {
  const findOrderNexusManifest = () =>
    MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'order-nexus');

  describe('module presence and structure', () => {
    it('includes an order-nexus module manifest', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest).toBeDefined();
    });

    it('has correct moduleId (kebab-case)', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest?.moduleId).toBe('order-nexus');
    });

    it('has clear business-focused display name', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest?.displayName).toBe('Orders & Profitability');
    });

    it('matches manifest interface structure', () => {
      const manifest = findOrderNexusManifest();
      
      expect(manifest).toMatchObject({
        moduleId: 'order-nexus',
        displayName: expect.any(String),
        requiredSignals: expect.any(Array),
        tasks: expect.arrayContaining([
          expect.objectContaining({
            id: expect.any(String),
            label: expect.any(String),
            required: expect.any(Boolean)
          })
        ])
      });
    });
  });

  describe('requiredSignals validation', () => {
    it('declares exactly three required signals', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest?.requiredSignals).toHaveLength(3);
    });

    it('includes all necessary order-related signals', () => {
      const manifest = findOrderNexusManifest();
      const expectedSignals = [
        'integration.syncCompleted',
        'orderNexus.profitabilityActive',
        'orderNexus.ordersIngested'
      ];
      
      expectedSignals.forEach(signal => {
        expect(manifest?.requiredSignals).toContain(signal);
      });
    });

    it('signals follow dependency order', () => {
      const manifest = findOrderNexusManifest();
      const signals = manifest?.requiredSignals || [];
      
      // Foundation dependency first
      expect(signals[0]).toBe('integration.syncCompleted');
      // Then business readiness flag
      expect(signals[1]).toBe('orderNexus.profitabilityActive');
      // Then quantitative metric
      expect(signals[2]).toBe('orderNexus.ordersIngested');
    });

    it('signals have no duplicates', () => {
      const manifest = findOrderNexusManifest();
      const signals = manifest?.requiredSignals || [];
      const uniqueSignals = new Set(signals);
      expect(uniqueSignals.size).toBe(signals.length);
    });
  });

  describe('tasks validation', () => {
    it('defines exactly two tasks', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest?.tasks).toHaveLength(2);
    });

    it('has tasks with meaningful ids', () => {
      const manifest = findOrderNexusManifest();
      const taskIds = manifest?.tasks.map(t => t.id) || [];
      expect(taskIds).toEqual(expect.arrayContaining([
        'profitability-engine',
        'ingest-first-orders'
      ]));
      expect(taskIds).toHaveLength(2);
    });

    describe('profitability-engine task', () => {
      let task: any;

      beforeEach(() => {
        const manifest = findOrderNexusManifest();
        task = manifest?.tasks.find(t => t.id === 'profitability-engine');
      });

      it('exists', () => {
        expect(task).toBeDefined();
      });

      it('has action-oriented label', () => {
        expect(task?.label).toBe('Profitability Engine Activated');
      });

      it('is required', () => {
        expect(task?.required).toBe(true);
      });

      it('has exactly one completion rule', () => {
        expect(task?.completionRules).toHaveLength(1);
      });

      it('completion rule checks boolean activation flag', () => {
        const rule = task?.completionRules[0];
        expect(rule).toEqual({
          signal: 'orderNexus.profitabilityActive',
          expectedValue: true
        });
      });

      it('uses implicit equals operator for boolean', () => {
        const rule = task?.completionRules[0];
        expect(rule?.operator).toBeUndefined();
      });

      it('has no action configured', () => {
        expect(task?.action).toBeUndefined();
      });
    });

    describe('ingest-first-orders task', () => {
      let task: any;

      beforeEach(() => {
        const manifest = findOrderNexusManifest();
        task = manifest?.tasks.find(t => t.id === 'ingest-first-orders');
      });

      it('exists', () => {
        expect(task).toBeDefined();
      });

      it('has quantitative goal label', () => {
        expect(task?.label).toBe('Ingest first 5 orders');
      });

      it('is required', () => {
        expect(task?.required).toBe(true);
      });

      it('has exactly one completion rule', () => {
        expect(task?.completionRules).toHaveLength(1);
      });

      it('completion rule uses gte operator with threshold', () => {
        const rule = task?.completionRules[0];
        expect(rule).toEqual({
          signal: 'orderNexus.ordersIngested',
          operator: 'gte',
          expectedValue: 5
        });
      });

      it('numeric threshold is appropriate for onboarding', () => {
        const rule = task?.completionRules[0];
        expect(rule?.expectedValue).toBe(5);
        expect(typeof rule?.expectedValue).toBe('number');
      });
    });

    describe('task ordering and progression', () => {
      it('tasks follow logical progression order', () => {
        const manifest = findOrderNexusManifest();
        const tasks = manifest?.tasks || [];
        
        // Profitability engine should come before order ingestion
        // (though they might be parallel in practice)
        const profitabilityIndex = tasks.findIndex(t => t.id === 'profitability-engine');
        const ingestionIndex = tasks.findIndex(t => t.id === 'ingest-first-orders');
        
        expect(profitabilityIndex).toBeLessThan(ingestionIndex);
      });
    });
  });

  describe('signal-task relationships', () => {
    it('all task signals are declared in requiredSignals', () => {
      const manifest = findOrderNexusManifest();
      const requiredSignals = manifest?.requiredSignals || [];
      const taskSignals = manifest?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      taskSignals.forEach(signal => {
        expect(requiredSignals).toContain(signal);
      });
    });

    it('dependency signal is declared but not directly checked', () => {
      const manifest = findOrderNexusManifest();
      const requiredSignals = manifest?.requiredSignals || [];
      const taskSignals = manifest?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      // integration.syncCompleted is a prerequisite but not directly validated
      expect(requiredSignals).toContain('integration.syncCompleted');
      expect(taskSignals).not.toContain('integration.syncCompleted');
    });

    it('signals align with provider capabilities', () => {
      const manifest = findOrderNexusManifest();
      const taskSignals = manifest?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      // All signals used in tasks should be provided by order-nexus provider
      taskSignals.forEach(signal => {
        expect(signal).toMatch(/^orderNexus\./);
      });
    });
  });

  describe('completion rule analysis', () => {
    it('uses appropriate operators for signal types', () => {
      const manifest = findOrderNexusManifest();
      const tasks = manifest?.tasks || [];
      
      tasks.forEach(task => {
        task.completionRules.forEach(rule => {
          if (rule.signal === 'orderNexus.profitabilityActive') {
            expect(rule.operator).toBeUndefined(); // Boolean equality
            expect(rule.expectedValue).toBe(true);
          } else if (rule.signal === 'orderNexus.ordersIngested') {
            expect(rule.operator).toBe('gte'); // Numeric comparison
            expect(rule.expectedValue).toBe(5);
          }
        });
      });
    });

    it('numeric threshold follows reasonable onboarding progression', () => {
      const manifest = findOrderNexusManifest();
      const orderTask = manifest?.tasks.find(t => t.id === 'ingest-first-orders');
      const rule = orderTask?.completionRules[0];
      
      // 5 orders is a reasonable initial goal
      expect(rule?.expectedValue).toBe(5);
      expect(rule?.expectedValue).toBeGreaterThan(0);
    });
  });

  describe('manifest integration', () => {
    it('module appears in correct sequence', () => {
      const index = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'order-nexus');
      expect(index).toBe(1); // Second position after platform
    });

    it('follows platform dependency', () => {
      const orderNexusIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'order-nexus');
      const platformIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'platform');
      
      expect(orderNexusIndex).toBeGreaterThan(platformIndex);
    });

    it('precedes modules that depend on orders', () => {
      const orderNexusIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'order-nexus');
      const insightCoreIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'insight-core');
      
      // Insight core depends on order data
      expect(orderNexusIndex).toBeLessThan(insightCoreIndex);
    });
  });

  describe('edge cases and validation', () => {
    it('tasks have unique ids within module', () => {
      const manifest = findOrderNexusManifest();
      const taskIds = manifest?.tasks.map(t => t.id) || [];
      const uniqueIds = new Set(taskIds);
      expect(uniqueIds.size).toBe(taskIds.length);
    });

    it('completion rules reference valid signal patterns', () => {
      const manifest = findOrderNexusManifest();
      const rules = manifest?.tasks.flatMap(t => t.completionRules) || [];
      
      rules.forEach(rule => {
        expect(rule.signal).toMatch(/^[a-zA-Z]+\.[a-zA-Z]+$/);
        expect(typeof rule.expectedValue).toBeDefined();
      });
    });
  });
});
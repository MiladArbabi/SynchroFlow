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
    it('declares exactly eight required signals', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest?.requiredSignals).toHaveLength(8);
    });

    it('includes all necessary order-related signals', () => {
      const manifest = findOrderNexusManifest();
      const expectedSignals = [
        'orderNexus.profitabilityActive',
        'orderNexus.missingCostCount',
        'orderNexus.hasNegativeMarginOrder',
        'orderNexus.modeDetermined',
        'orderNexus.ordersIngested',
        'order-nexus.freeTierState',
        'order-nexus.freeTierRemaining'
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
    it('defines exactly four tasks', () => {
      const manifest = findOrderNexusManifest();
      expect(manifest?.tasks).toHaveLength(4);
    });

    it('has tasks with meaningful ids', () => {
      const manifest = findOrderNexusManifest();
      const taskIds = manifest?.tasks.map(t => t.id) || [];
      expect(taskIds).toEqual([
        'orderNexus.reviewProfitAutopsy',
        'orderNexus.resolveMissingCosts',
        'orderNexus.checkBleedFeed',
        'orderNexus.confirmMode'
      ]);
    });

    const byId = (id: string) => {
      const manifest = findOrderNexusManifest();
      return manifest?.tasks.find(t => t.id === id);
    };

    describe('reviewProfitAutopsy task', () => {
      it('exists and is required', () => {
        const task = byId('orderNexus.reviewProfitAutopsy');
        expect(task).toBeDefined();
        expect(task?.required).toBe(true);
        expect(task?.label).toBe('Review your first Profit Autopsy');
      });

      it('has correct completion rule and action', () => {
        const task = byId('orderNexus.reviewProfitAutopsy');
        expect(task?.completionRules).toHaveLength(1);
        expect(task?.completionRules[0]).toEqual({
          signal: 'orderNexus.profitabilityActive',
          operator: 'equals',
          expectedValue: true
        });
        expect(task?.action).toEqual({
          type: 'navigate',
          target: '/orders'
        });
      });
    });

    describe('resolveMissingCosts task', () => {
      it('exists and is required', () => {
        const task = byId('orderNexus.resolveMissingCosts');
        expect(task).toBeDefined();
        expect(task?.required).toBe(true);
        expect(task?.label).toBe('Fix missing costs so your profit is real');
      });

      it('has correct completion rule and action', () => {
        const task = byId('orderNexus.resolveMissingCosts');
        expect(task?.completionRules).toHaveLength(1);
        expect(task?.completionRules[0]).toEqual({
          signal: 'orderNexus.missingCostCount',
          operator: 'equals',
          expectedValue: 0
        });
        expect(task?.action).toEqual({
          type: 'navigate',
          target: '/products'
        });
      });
    });

    describe('checkBleedFeed task', () => {
      it('exists and is optional', () => {
        const task = byId('orderNexus.checkBleedFeed');
        expect(task).toBeDefined();
        expect(task?.required).toBe(false);
        expect(task?.label).toBe('Check your Bleed Feed');
      });

      it('has correct completion rule and action', () => {
        const task = byId('orderNexus.checkBleedFeed');
        expect(task?.completionRules).toHaveLength(1);
        expect(task?.completionRules[0]).toEqual({
          signal: 'orderNexus.hasNegativeMarginOrder',
          operator: 'equals',
          expectedValue: true
        });
        expect(task?.action).toEqual({
          type: 'navigate',
          target: '/orders/bleeders'
        });
      });
    });

    describe('confirmMode task', () => {
      it('exists and is optional', () => {
        const task = byId('orderNexus.confirmMode');
        expect(task).toBeDefined();
        expect(task?.required).toBe(false);
        expect(task?.label).toBe('Confirm your operating mode');
      });

      it('has correct completion rule and action', () => {
        const task = byId('orderNexus.confirmMode');
        expect(task?.completionRules).toHaveLength(1);
        expect(task?.completionRules[0]).toEqual({
          signal: 'orderNexus.modeDetermined',
          operator: 'equals',
          expectedValue: true
        });
        expect(task?.action).toEqual({
          type: 'openModal',
          target: 'orderNexus.mode'
        });
      });
    });

    describe('task ordering and progression', () => {
      it('tasks follow logical progression order', () => {
        const manifest = findOrderNexusManifest();
        const tasks = manifest?.tasks || [];
        const idsInOrder = tasks.map(t => t.id);

        expect(idsInOrder).toEqual([
          'orderNexus.reviewProfitAutopsy',
          'orderNexus.resolveMissingCosts',
          'orderNexus.checkBleedFeed',
          'orderNexus.confirmMode'
        ]);
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
    it('uses equals operator consistently for boolean and numeric rules', () => {
      const manifest = findOrderNexusManifest();
      const rules = manifest?.tasks.flatMap(t => t.completionRules) || [];

      rules.forEach(rule => {
        expect(rule.operator).toBe('equals');
        expect(rule.expectedValue).not.toBeUndefined();
      });
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
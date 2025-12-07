// tests/unit/api/sku-os.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Onboarding manifest - sku-os module', () => {
  const findSkuOsManifest = () =>
    MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'sku-os');

  describe('module presence and structure', () => {
    it('includes a sku-os module manifest', () => {
      const manifest = findSkuOsManifest();
      expect(manifest).toBeDefined();
    });

    it('has correct moduleId (kebab-case)', () => {
      const manifest = findSkuOsManifest();
      expect(manifest?.moduleId).toBe('sku-os');
    });

    it('has clear display name', () => {
      const manifest = findSkuOsManifest();
      expect(manifest?.displayName).toBe('Products & Inventory');
    });

    it('conforms to expected manifest structure', () => {
      const manifest = findSkuOsManifest();
      
      expect(manifest).toMatchObject({
        moduleId: 'sku-os',
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
      const manifest = findSkuOsManifest();
      expect(manifest?.requiredSignals).toHaveLength(3);
    });

    it('includes all expected signals', () => {
      const manifest = findSkuOsManifest();
      const expectedSignals = [
        'integration.syncCompleted',
        'skuOs.productCount',
        'skuOs.inventoryInsightsReady'
      ];
      
      expectedSignals.forEach(signal => {
        expect(manifest?.requiredSignals).toContain(signal);
      });
    });

    it('signals are in logical dependency order', () => {
      const manifest = findSkuOsManifest();
      const signals = manifest?.requiredSignals || [];
      
      // integration.syncCompleted should come first as dependency
      expect(signals[0]).toBe('integration.syncCompleted');
      // Then product count
      expect(signals[1]).toBe('skuOs.productCount');
      // Then derived readiness flag
      expect(signals[2]).toBe('skuOs.inventoryInsightsReady');
    });

    it('contains no duplicate signals', () => {
      const manifest = findSkuOsManifest();
      const signals = manifest?.requiredSignals || [];
      const uniqueSignals = new Set(signals);
      expect(uniqueSignals.size).toBe(signals.length);
    });
  });

  describe('tasks validation', () => {
    it('defines exactly two tasks', () => {
      const manifest = findSkuOsManifest();
      expect(manifest?.tasks).toHaveLength(2);
    });

    it('has tasks with correct ids', () => {
      const manifest = findSkuOsManifest();
      const taskIds = manifest?.tasks.map(t => t.id) || [];
      expect(taskIds).toEqual(expect.arrayContaining([
        'review-products',
        'unlock-inventory-intelligence'
      ]));
      expect(taskIds).toHaveLength(2);
    });

    describe('review-products task', () => {
      let task: any;

      beforeEach(() => {
        const manifest = findSkuOsManifest();
        task = manifest?.tasks.find(t => t.id === 'review-products');
      });

      it('exists', () => {
        expect(task).toBeDefined();
      });

      it('has appropriate label', () => {
        expect(task?.label).toBe('Review your synced product catalog');
      });

      it('is required', () => {
        expect(task?.required).toBe(true);
      });

      it('has exactly one completion rule', () => {
        expect(task?.completionRules).toHaveLength(1);
      });

      it('completion rule checks for at least one product', () => {
        const rule = task?.completionRules[0];
        expect(rule).toEqual({
          signal: 'skuOs.productCount',
          operator: 'gte',
          expectedValue: 1
        });
      });

      it('has no action configured', () => {
        expect(task?.action).toBeUndefined();
      });
    });

    describe('unlock-inventory-intelligence task', () => {
      let task: any;

      beforeEach(() => {
        const manifest = findSkuOsManifest();
        task = manifest?.tasks.find(t => t.id === 'unlock-inventory-intelligence');
      });

      it('exists', () => {
        expect(task).toBeDefined();
      });

      it('has descriptive label', () => {
        expect(task?.label).toBe('Unlock inventory health insights');
      });

      it('is required', () => {
        expect(task?.required).toBe(true);
      });

      it('has exactly one completion rule', () => {
        expect(task?.completionRules).toHaveLength(1);
      });

      it('completion rule uses boolean readiness flag', () => {
        const rule = task?.completionRules[0];
        expect(rule).toEqual({
          signal: 'skuOs.inventoryInsightsReady',
          expectedValue: true
        });
      });

      it('uses default equals operator for boolean check', () => {
        const rule = task?.completionRules[0];
        expect(rule?.operator).toBeUndefined(); // Default is 'equals'
      });
    });
  });

  describe('signal-task relationships', () => {
    it('all task signals are in requiredSignals', () => {
      const manifest = findSkuOsManifest();
      const requiredSignals = manifest?.requiredSignals || [];
      const taskSignals = manifest?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      taskSignals.forEach(signal => {
        expect(requiredSignals).toContain(signal);
      });
    });

    it('dependency signal (integration.syncCompleted) is declared but not used in tasks', () => {
      const manifest = findSkuOsManifest();
      const requiredSignals = manifest?.requiredSignals || [];
      const taskSignals = manifest?.tasks.flatMap(t => 
        t.completionRules.map(r => r.signal)
      ) || [];
      
      // integration.syncCompleted is a dependency but not directly checked
      expect(requiredSignals).toContain('integration.syncCompleted');
      expect(taskSignals).not.toContain('integration.syncCompleted');
    });
  });

  describe('completion rule operators', () => {
    it('uses correct operators for different signal types', () => {
      const manifest = findSkuOsManifest();
      const tasks = manifest?.tasks || [];
      
      tasks.forEach(task => {
        task.completionRules.forEach(rule => {
          if (rule.signal === 'skuOs.productCount') {
            expect(rule.operator).toBe('gte'); // Numeric comparison
          } else if (rule.signal === 'skuOs.inventoryInsightsReady') {
            expect(rule.operator).toBeUndefined(); // Boolean equality
          }
        });
      });
    });

    it('numeric comparison uses appropriate expectedValue', () => {
      const manifest = findSkuOsManifest();
      const productTask = manifest?.tasks.find(t => t.id === 'review-products');
      const rule = productTask?.completionRules[0];
      
      expect(rule?.expectedValue).toBe(1);
      expect(typeof rule?.expectedValue).toBe('number');
    });
  });

  describe('manifest array properties', () => {
    it('sku-os module is in correct position in overall manifest', () => {
      const index = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'sku-os');
      expect(index).toBe(2); // Third position after platform and order-nexus
    });

    it('module order follows logical dependency flow', () => {
      const skuOsIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'sku-os');
      const platformIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'platform');
      const orderNexusIndex = MODULE_ONBOARDING_MANIFESTS.findIndex(m => m.moduleId === 'order-nexus');
      
      // Platform (integration) comes first as foundation
      expect(platformIndex).toBeLessThan(skuOsIndex);
      // Order nexus might come before or after depending on product dependency
      expect(orderNexusIndex).toBeLessThan(skuOsIndex);
    });
  });
});
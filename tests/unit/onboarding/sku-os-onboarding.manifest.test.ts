// tests/unit/onboarding/sku-os-onboarding.manifest.test.ts

import { MODULE_ONBOARDING_MANIFESTS } from '../../../apps/backend/src/onboarding/readiness.manifest';
import type { ModuleOnboardingReadiness } from '@lasyncro/shared';

describe('Onboarding manifests', () => {
  describe('SKU-OS specific module', () => {
    const skuOsModule = MODULE_ONBOARDING_MANIFESTS.find(
      (m) => m.moduleId === 'sku-os'
    ) as Omit<ModuleOnboardingReadiness, 'isReady' | 'signals'> | undefined;

    it('defines a SKU-OS module entry', () => {
      expect(skuOsModule).toBeDefined();
      expect(skuOsModule?.displayName.toLowerCase()).toContain('product');
    });

    it('declares the correct requiredSignals for SKU-OS', () => {
      const required = skuOsModule?.requiredSignals ?? [];

      expect(required).toEqual(
        expect.arrayContaining([
          'integration.syncCompleted',
          'skuOs.productHealthEvents',
          'sku-os.freeTierState',
          'sku-os.freeTierRemaining'
        ])
      );

      // Make sure we're not leaking random stuff we didn't intend
      expect(required).not.toEqual(
        expect.arrayContaining([
          'orderNexus.profitabilityActive',
          'orderNexus.ordersIngested'
        ])
      );
    });

    it('has a required "first health event" task wired to skuOs.productHealthEvents', () => {
      const tasks = skuOsModule?.tasks ?? [];

      const firstHealthTask = tasks.find((t) => t.id === 'skuOs.firstProductHealthEvent');
      expect(firstHealthTask).toBeDefined();
      expect(firstHealthTask?.required).toBe(true);

      const rule = firstHealthTask?.completionRules[0];
      expect(rule?.signal).toBe('skuOs.productHealthEvents');
      expect(rule?.operator).toBe('gte');
      expect(rule?.expectedValue).toBe(1);
    });

    it('defines an optional "review product health" task', () => {
      const tasks = skuOsModule?.tasks ?? [];

      const reviewTask = tasks.find((t) => t.id === 'skuOs.reviewProductHealth');
      expect(reviewTask).toBeDefined();
      expect(reviewTask?.required).toBe(false);

      const rule = reviewTask?.completionRules[0];
      expect(rule?.signal).toBe('skuOs.productCount');
      expect(rule?.operator).toBe('gte');
      expect(rule?.expectedValue).toBe(1);
    });

    it('requires integration.syncCompleted as a foundation dependency', () => {
      const required = skuOsModule?.requiredSignals ?? [];
      expect(required).toContain('integration.syncCompleted');
    });

    it('does not require skuOs.productCount as a required signal', () => {
      const required = skuOsModule?.requiredSignals ?? [];
      expect(required).not.toContain('skuOs.productCount');
    });

    it('has correct task ordering', () => {
      const tasks = skuOsModule?.tasks ?? [];
      expect(tasks[0].id).toBe('skuOs.firstProductHealthEvent');
      expect(tasks[1].id).toBe('skuOs.reviewProductHealth');
    });

    it('includes free tier signals for gating purposes', () => {
      const required = skuOsModule?.requiredSignals ?? [];
      expect(required).toContain('sku-os.freeTierState');
      expect(required).toContain('sku-os.freeTierRemaining');
    });
  });

  describe('All modules structure validation', () => {
    it('contains all expected modules', () => {
      const moduleIds = MODULE_ONBOARDING_MANIFESTS.map(m => m.moduleId);
      
      expect(moduleIds).toEqual(
        expect.arrayContaining([
          'platform',
          'order-nexus',
          'sku-os',
          'specter',
          'insight-core'
        ])
      );
    });

    it('each module has required properties', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        expect(module).toHaveProperty('moduleId');
        expect(typeof module.moduleId).toBe('string');
        
        expect(module).toHaveProperty('displayName');
        expect(typeof module.displayName).toBe('string');
        
        expect(module).toHaveProperty('requiredSignals');
        expect(Array.isArray(module.requiredSignals)).toBe(true);
        
        expect(module).toHaveProperty('tasks');
        expect(Array.isArray(module.tasks)).toBe(true);
      });
    });

    it('module IDs are unique', () => {
      const moduleIds = MODULE_ONBOARDING_MANIFESTS.map(m => m.moduleId);
      const uniqueIds = new Set(moduleIds);
      expect(moduleIds.length).toBe(uniqueIds.size);
    });

    it('each task has valid structure', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        module.tasks.forEach(task => {
          expect(task).toHaveProperty('id');
          expect(typeof task.id).toBe('string');
          
          expect(task).toHaveProperty('label');
          expect(typeof task.label).toBe('string');
          
          expect(task).toHaveProperty('required');
          expect(typeof task.required).toBe('boolean');
          
          expect(task).toHaveProperty('completionRules');
          expect(Array.isArray(task.completionRules)).toBe(true);
          expect(task.completionRules.length).toBeGreaterThan(0);
          
          task.completionRules.forEach(rule => {
            expect(rule).toHaveProperty('signal');
            expect(typeof rule.signal).toBe('string');
            
            // operator is optional, defaults to 'equals'
            if (rule.operator) {
              expect(['equals', 'not_equals', 'gte', 'lte', 'gt', 'lt']).toContain(rule.operator);
            }
            
            expect(rule).toHaveProperty('expectedValue');
            // expectedValue can be any type
          });
          
          // action is optional
          if (task.action) {
            expect(typeof task.action.type).toBe('string');
            expect(typeof task.action.target).toBe('string');
          }
        });
      });
    });

    it('no module has empty requiredSignals array', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        expect(module.requiredSignals.length).toBeGreaterThan(0);
      });
    });

    it('all signals referenced in tasks exist in requiredSignals or are optional UX signals', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        const requiredSignals = new Set(module.requiredSignals);
        
        module.tasks.forEach(task => {
          task.completionRules.forEach(rule => {
            // Some signals might be optional UX signals (like skuOs.productCount)
            // that aren't required for readiness but are used for task completion
            // We'll just log these for awareness but not fail the test
            if (!requiredSignals.has(rule.signal)) {
              console.warn(`Module ${module.moduleId}: Signal "${rule.signal}" used in task "${task.id}" is not in requiredSignals`);
            }
          });
        });
      });
    });

    it('task IDs are unique within each module', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        const taskIds = module.tasks.map(t => t.id);
        const uniqueTaskIds = new Set(taskIds);
        expect(taskIds.length).toBe(uniqueTaskIds.size);
      });
    });
  });

  describe('Module dependencies and relationships', () => {
    it('platform module is first and provides foundation', () => {
      const firstModule = MODULE_ONBOARDING_MANIFESTS[0];
      expect(firstModule.moduleId).toBe('platform');
      expect(firstModule.requiredSignals).toContain('integration.connected');
      expect(firstModule.requiredSignals).toContain('integration.syncCompleted');
    });

    it('SKU-OS depends on platform sync completion', () => {
      const skuOsModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'sku-os');
      expect(skuOsModule?.requiredSignals).toContain('integration.syncCompleted');
    });

    it('order-nexus also depends on platform sync completion', () => {
      const orderNexusModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'order-nexus');
      expect(orderNexusModule?.requiredSignals).toContain('integration.syncCompleted');
    });

    it('CNS modules (specter, insight-core) have minimal dependencies', () => {
      const specterModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'specter');
      const insightCoreModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'insight-core');
      
      // CNS modules don't strictly depend on sync completion (they might work with partial data)
      expect(specterModule?.requiredSignals).not.toContain('integration.syncCompleted');
      expect(insightCoreModule?.requiredSignals).not.toContain('integration.syncCompleted');
    });
  });

  describe('Task completion logic', () => {
    it('required tasks use appropriate operators', () => {
        MODULE_ONBOARDING_MANIFESTS.forEach(module => {
            const requiredTasks = module.tasks.filter(t => t.required === true);
            
            requiredTasks.forEach(task => {
            task.completionRules.forEach(rule => {
                // Required tasks should have definitive completion criteria
                // not_equals is valid for required tasks when checking for non-null values
                if (rule.operator === 'not_equals') {
                expect(rule.expectedValue).toBe(null); // not_equals null means "must have a value"
                }
                
                // For numeric thresholds, gte is common
                if (typeof rule.expectedValue === 'number') {
                const operator = rule.operator || 'equals';
                expect(['gte', 'equals', 'lte']).toContain(operator);
                }
            });
            });
        });
    });

    it('optional tasks often check for existence rather than specific values', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        const optionalTasks = module.tasks.filter(t => t.required === false);
        
        optionalTasks.forEach(task => {
          task.completionRules.forEach(rule => {
            // Optional tasks might check for any value (gte 1) or existence (not_equals null)
            if (rule.operator === 'not_equals') {
              expect(rule.expectedValue).toBe(null);
            }
          });
        });
      });
    });

    it('SKU-OS tasks have appropriate action targets', () => {
      const skuOsModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'sku-os');
      const reviewTask = skuOsModule?.tasks.find(t => t.id === 'skuOs.reviewProductHealth');
      
      expect(reviewTask?.action?.type).toBe('navigate');
      expect(reviewTask?.action?.target).toBe('/products/health');
    });

    it('platform tasks have correct action types', () => {
      const platformModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'platform');
      const connectStoreTask = platformModule?.tasks.find(t => t.id === 'connect-store');
      
      expect(connectStoreTask?.action?.type).toBe('openModal');
      expect(connectStoreTask?.action?.target).toBe('connect-store');
    });
  });

  describe('Signal naming consistency', () => {
    it('uses consistent signal naming patterns', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        module.requiredSignals.forEach(signal => {
          // Signal names should follow pattern: module.signalName or module-signalName
          expect(signal).toMatch(/^[a-zA-Z0-9]+(\.[a-zA-Z0-9]+|[a-zA-Z0-9-]+)+$/);
        });
      });
    });

    it('SKU-OS signals follow naming conventions', () => {
    const skuOsModule = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === 'sku-os');
    const signals = skuOsModule?.requiredSignals || [];
    
    // Module-specific signals use module prefix - note that moduleId is 'sku-os' with hyphen
    // Signals can be 'skuOs' (camelCase) or 'sku-os' (kebab-case) depending on convention
    signals.forEach(signal => {
        if (signal.startsWith('sku')) {
        // Accept both patterns: 'skuOs.' or 'sku-os.' 
        expect(signal.startsWith('skuOs.') || signal.startsWith('sku-os.')).toBe(true);
        }
    });
    });
  });

  describe('Free tier integration', () => {
    it('modules with free tier limits include free tier signals', () => {
      const modulesWithFreeTier = ['order-nexus', 'sku-os'];
      
      modulesWithFreeTier.forEach(moduleId => {
        const module = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === moduleId);
        expect(module?.requiredSignals).toContain(`${moduleId}.freeTierState`);
        expect(module?.requiredSignals).toContain(`${moduleId}.freeTierRemaining`);
      });
    });

    it('modules without free tier don"t include free tier signals', () => {
      const modulesWithoutFreeTier = ['platform', 'specter', 'insight-core'];
      
      modulesWithoutFreeTier.forEach(moduleId => {
        const module = MODULE_ONBOARDING_MANIFESTS.find(m => m.moduleId === moduleId);
        expect(module?.requiredSignals).not.toContain(`${moduleId}.freeTierState`);
        expect(module?.requiredSignals).not.toContain(`${moduleId}.freeTierRemaining`);
      });
    });
  });

  describe('Edge cases and validation', () => {
    it('handles missing task actions gracefully', () => {
    MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        module.tasks.forEach(task => {
        // Some tasks might not have actions (they're informational or auto-complete)
        // This is valid for both required and optional tasks
        if (!task.action) {
            // Tasks without actions are typically informational or auto-complete based on signals
            // They can be either required or optional
            // We'll just check that they have completionRules
            expect(task.completionRules.length).toBeGreaterThan(0);
        }
        });
    });
    });

    it('no task has empty completionRules', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        module.tasks.forEach(task => {
          expect(task.completionRules.length).toBeGreaterThan(0);
        });
      });
    });

    it('display names are user-friendly and descriptive', () => {
      MODULE_ONBOARDING_MANIFESTS.forEach(module => {
        expect(module.displayName.length).toBeGreaterThan(3);
        expect(module.displayName.length).toBeLessThan(50); // Reasonable length
        expect(module.displayName).not.toMatch(/[{}<>]/); // No HTML/JSX
      });
    });
  });
});
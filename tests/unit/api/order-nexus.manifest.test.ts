// tests/unit/api/order-nexus.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Onboarding manifest - order-nexus module', () => {
  const findOrderNexusManifest = () =>
    MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'order-nexus');

  it('includes an order-nexus module manifest', () => {
    const manifest = findOrderNexusManifest();
    expect(manifest).toBeDefined();
    if (!manifest) return;

    expect(manifest.displayName).toBe('Orders & Profitability');
  });

  it('declares the correct required signals', () => {
    const manifest = findOrderNexusManifest();
    if (!manifest) return;

    expect(manifest.requiredSignals).toEqual(
      expect.arrayContaining([
        'integration.syncCompleted',
        'orderNexus.profitabilityActive',
        'orderNexus.ordersIngested',
      ])
    );
  });

  it('defines the expected tasks and completion rules', () => {
    const manifest = findOrderNexusManifest();
    if (!manifest) return;

    const tasksById = new Map(manifest.tasks.map((t) => [t.id, t]));

    const profitabilityEngine = tasksById.get('profitability-engine');
    const ingestFirstOrders = tasksById.get('ingest-first-orders');

    expect(profitabilityEngine).toBeDefined();
    expect(profitabilityEngine!.required).toBe(true);
    expect(profitabilityEngine!.completionRules).toEqual([
      {
        signal: 'orderNexus.profitabilityActive',
        expectedValue: true,
      },
    ]);

    expect(ingestFirstOrders).toBeDefined();
    expect(ingestFirstOrders!.required).toBe(true);
    expect(ingestFirstOrders!.completionRules).toEqual([
      {
        signal: 'orderNexus.ordersIngested',
        operator: 'gte',
        expectedValue: 5,
      },
    ]);
  });
});

// tests/unit/api/sku-os.manifest.test.ts
import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

describe('Onboarding manifest - sku-os module', () => {
  const findSkuOsManifest = () =>
    MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'sku-os');

  it('includes a sku-os module manifest', () => {
    const manifest = findSkuOsManifest();
    expect(manifest).toBeDefined();
    if (!manifest) return; // type guard for TS

    expect(manifest.displayName).toBe('Products & Inventory');
  });

  it('declares the correct required signals', () => {
    const manifest = findSkuOsManifest();
    if (!manifest) return;

    expect(manifest.requiredSignals).toEqual(
      expect.arrayContaining([
        'integration.syncCompleted',
        'skuOs.productCount',
        'skuOs.inventoryInsightsReady',
      ])
    );
  });

  it('defines the expected tasks and completion rules', () => {
    const manifest = findSkuOsManifest();
    if (!manifest) return;

    const tasksById = new Map(manifest.tasks.map((t) => [t.id, t]));

    const reviewProducts = tasksById.get('review-products');
    const unlockInventory = tasksById.get('unlock-inventory-intelligence');

    expect(reviewProducts).toBeDefined();
    expect(reviewProducts!.required).toBe(true);
    expect(reviewProducts!.completionRules).toEqual([
      {
        signal: 'skuOs.productCount',
        operator: 'gte',
        expectedValue: 1,
      },
    ]);

    expect(unlockInventory).toBeDefined();
    expect(unlockInventory!.required).toBe(true);
    expect(unlockInventory!.completionRules).toEqual([
      {
        signal: 'skuOs.inventoryInsightsReady',
        expectedValue: true,
      },
    ]);
  });
});

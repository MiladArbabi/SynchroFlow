// tests/unit/backend/onboarding/readiness.opening-inventory-reconciled.test.ts
//
// GH-1156 — DB-free coverage for the canonical Opening Inventory readiness
// completion. wms.openingInventoryReconciled must be exposed to the WMS
// module (requiredSignals filters what the service evaluates), must be true
// for legacy tenants, and for v2 tenants must come ONLY from the persisted
// Shopify-sync marker opening_inventory_shopify_synced_at — never from
// counting every bin or ready_for_cutover.

import { MODULE_ONBOARDING_MANIFESTS } from 'api-src/onboarding/readiness.manifest';

const mockTableRows: Record<string, unknown> = {};

jest.mock('@lasyncro/backend-core/db.js', () => {
  const builder = (table: string) => {
    const b: Record<string, unknown> = {};
    for (const method of ['where', 'whereNotNull', 'orWhere', 'count', 'select']) {
      b[method] = () => b;
    }
    b.first = () => Promise.resolve(mockTableRows[table]);
    return b;
  };
  return { __esModule: true, default: (table: string) => builder(table) };
});

const mockGetShopOpeningInventoryProgress = jest.fn();
jest.mock('api-src/services/wms/inventoryRecount.service', () => ({
  getShopOpeningInventoryProgress: (...args: unknown[]) => mockGetShopOpeningInventoryProgress(...args),
}));

import { wmsOnboardingSignalProvider } from 'api-src/onboarding/readiness.providers';

const SHOP_ID = 91156;

function v2Progress(state: string) {
  return {
    bootstrap_model: 'reconcile_opening_expectation_v2',
    reconciliation_required: true,
    state,
    progress_pct: state === 'ready_for_cutover' ? 100 : 0,
  };
}

async function reconciledSignal(settings: Record<string, unknown>) {
  mockTableRows.shop_wms_settings = settings;
  const signals = await wmsOnboardingSignalProvider.getSignals({ shopId: SHOP_ID });
  return signals.find((s) => s.name === 'wms.openingInventoryReconciled')?.value;
}

describe('WMS manifest — reconcile-inventory readiness exposure', () => {
  const wms = MODULE_ONBOARDING_MANIFESTS.find((m) => m.moduleId === 'wms');
  const task = wms?.tasks.find((t) => t.id === 'reconcile-inventory');

  it('exposes wms.openingInventoryReconciled through requiredSignals', () => {
    expect(wms?.requiredSignals).toContain('wms.openingInventoryReconciled');
  });

  it('exposes wms.openingInventoryReconciliationRequired through requiredSignals', () => {
    expect(wms?.requiredSignals).toContain('wms.openingInventoryReconciliationRequired');
  });

  it('adds no required-task obligation (FT1 gating unchanged)', () => {
    expect(wms?.tasks.filter((t) => t.required).map((t) => t.id)).toEqual([]);
  });

  it('keeps reconcile-inventory optional and gated on the canonical signal', () => {
    expect(task?.required).toBe(false);
    expect(task?.completionRules).toEqual([
      { signal: 'wms.openingInventoryReconciled', expectedValue: true },
    ]);
  });
});

describe('wmsOnboardingSignalProvider — wms.openingInventoryReconciled', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    for (const key of Object.keys(mockTableRows)) delete mockTableRows[key];
  });

  it('legacy_opening_balance_v1 → true, without reading opening progress', async () => {
    await expect(reconciledSignal({
      bootstrap_model: 'legacy_opening_balance_v1',
      opening_inventory_shopify_synced_at: null,
    })).resolves.toBe(true);
    expect(mockGetShopOpeningInventoryProgress).not.toHaveBeenCalled();
  });

  it.each(['not_started', 'counting', 'review_required', 'ready_for_cutover'])(
    'v2 + no Shopify-sync marker → false (progress state %s is not reconciliation)',
    async (state) => {
      mockGetShopOpeningInventoryProgress.mockResolvedValue(v2Progress(state));
      await expect(reconciledSignal({
        bootstrap_model: 'reconcile_opening_expectation_v2',
        opening_inventory_shopify_synced_at: null,
      })).resolves.toBe(false);
    }
  );

  it('v2 + opening_inventory_shopify_synced_at → true', async () => {
    mockGetShopOpeningInventoryProgress.mockResolvedValue(v2Progress('ready_for_cutover'));
    await expect(reconciledSignal({
      bootstrap_model: 'reconcile_opening_expectation_v2',
      opening_inventory_shopify_synced_at: new Date('2026-09-20T10:00:00.000Z'),
    })).resolves.toBe(true);
  });
});

describe('OnboardingReadinessService — reconcile-inventory completes from the canonical signal', () => {
  async function reconcileTaskComplete(reconciled: boolean) {
    let complete: boolean | undefined;
    await jest.isolateModulesAsync(async () => {
      jest.doMock('api-src/onboarding/readiness.providers', () => ({
        onboardingSignalProviders: [{
          moduleId: 'wms',
          getSignals: async () => [
            { name: 'wms.zonesConfigured', value: false },
            { name: 'wms.openingInventoryReconciled', value: reconciled },
          ],
        }],
      }));
      const { OnboardingReadinessService } = await import('api-src/onboarding/readiness.service');
      const snapshot = await new OnboardingReadinessService().getSnapshot({ shopId: SHOP_ID });
      complete = snapshot.modules
        .find((m) => m.moduleId === 'wms')
        ?.tasks.find((t) => t.id === 'reconcile-inventory')
        ?.complete;
    });
    return complete;
  }

  it('signal true → task complete', async () => {
    await expect(reconcileTaskComplete(true)).resolves.toBe(true);
  });

  it('signal false → task incomplete', async () => {
    await expect(reconcileTaskComplete(false)).resolves.toBe(false);
  });
});

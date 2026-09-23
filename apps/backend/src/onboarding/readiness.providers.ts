// apps/backend/src/onboarding/readiness.providers.ts
import db from '@lasyncro/backend-core/db.js';
import {
  ReadinessSignal,
  ModuleId,
  computeModuleAccessState,
  ModuleEntitlementAccess,
  ReadinessSignalName,
  ReadinessSignalValue
} from '@lasyncro/shared';

import { financesOnboardingSignalProvider } from './providers/finances.provider.js';

import { UserStateService } from '../services/user-state.service.js';
import { getShopOpeningInventoryProgress } from '../services/wms/inventoryRecount.service.js';
import { deriveKnownCount } from './utils/deriveKnownCount.js';
import { devReadinessOverrideProvider } from './providers/dev-readiness.provider.js';

const makeSignal = (
  name: ReadinessSignalName,
  value: ReadinessSignalValue
): ReadinessSignal => ({
  name,
  value
});

/**
 * Each module has a provider that outputs readiness signals.
 * Providers DO NOT evaluate tasks — they only produce signals.
 */

export interface OnboardingSignalProvider {
  moduleId: ModuleId;
  getSignals(ctx: { shopId: number; userId?: number }): Promise<ReadinessSignal[]>;
}

// --- Platform (FT0) provider: integration + sync + segmentation ---
export const platformOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'platform',

  async getSignals(ctx: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    const { shopId, userId } = ctx;

    // 1) Integration presence & sync status (from integrations table)
    const integration = await db('integrations')
      .where({ shop_id: shopId })
      .first();

    const integrationConnected = !!integration;
    const integrationSyncCompleted = integration?.sync_status === 'COMPLETED';

    let ordersPerMonthSegment: string | null = null;
    if (userId) {
      const segment = await UserStateService.getOrdersPerMonthSegment(userId);
      ordersPerMonthSegment = segment ?? null;
    }

    return [
      {
        name: 'integration.connected',
        value: integrationConnected,
      },
      {
        name: 'integration.syncCompleted',
        value: integrationSyncCompleted,
      },
      {
        name: 'user.ordersPerMonthSegment',
        value: ordersPerMonthSegment,
      },
    ];
  },
};

// --- OrderNexus provider: orders & profitability readiness (FT0) ---
export const orderNexusOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'order-nexus',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // 1) How many canonical orders did we ingest?
    const ordersRow = await db('orders')

      .where({ shop_id: shopId })
      .count<{ count: string }>('lasyncro_order_id as count')
      .first();

    const ordersIngested =
      ordersRow?.count != null ? Number(ordersRow.count) : null;

    /**
     * CATALOG COST COMPLETENESS CHECK
     * --------------------------------
     * OrderNexus profitability readiness must be evaluated
     * against the canonical product catalog.
     *
     * Using variants.unit_cost ensures we detect missing cost
     * even before orders exist.
     *
     * Historical revenue snapshots (order_revenue_units)
     * must NOT be used for readiness detection.
     */
    const missingCostRow = await db('variants as v')
      .where('v.shop_id', shopId)
      .where('v.unit_cost', 0)
      .count<{ count: string }>('v.lasyncro_variant_id as count')
      .first();

    const missingCostCount = Number(missingCostRow?.count ?? 0);

    // 3) Free tier access – FT0: everyone gets free-tier OrderNexus, usage based on order count
    const entitlementAccess: ModuleEntitlementAccess = 'free-tier';

    const freeTier = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: ordersIngested,
      entitlementAccess,
    });

    return [
      {
        name: 'orderNexus.ordersIngested',
        value: ordersIngested,
      },
      {
        name: 'orderNexus.missingCostCount',
        value: missingCostCount,
      },
      {
        name: 'order-nexus.freeTierState',
        value: freeTier.state,
      },
      {
        name: 'order-nexus.freeTierRemaining',
        value: freeTier.remaining,
      },
    ];
  },
};

// --- SKU OS provider: product catalog & inventory readiness ---
export const skuOsOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'sku-os',

  async getSignals({ shopId }): Promise<ReadinessSignal[]> {
    let productsKnown = false;
    let productCount: number | null = null;
    let freeTierUsageCount = 0;

    try {
      const row = await db('products')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();
      
      console.log('[sku-os][debug]', {
        shopId,
        canonicalProductsCount: row?.count,
      });

      const derived = deriveKnownCount(row?.count);

      productsKnown = derived.known;
      productCount = derived.count;
      freeTierUsageCount = derived.usageCount;
    } catch {
      productsKnown = false;
      productCount = null;
      freeTierUsageCount = 0;
    }

    const productHealthEvents =
      productsKnown && productCount !== null ? productCount : null;

    const freeTier = computeModuleAccessState({
      moduleId: 'sku-os',
      usageCount: freeTierUsageCount,
      entitlementAccess: 'free-tier',
    });

    const signals: ReadinessSignal[] = [];

    signals.push(makeSignal('sku-os.productsKnown', productsKnown));
    signals.push(makeSignal('sku-os.productCount', productCount));
    signals.push(makeSignal('sku-os.productHealthEvents', productHealthEvents));
    signals.push(makeSignal('sku-os.freeTierState', freeTier.state));
    signals.push(makeSignal('sku-os.freeTierRemaining', freeTier.remaining ?? null));

    return signals;
  },
};

// --- ReturnNexus provider: returns & refund intelligence ---
export const returnNexusOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'return-nexus',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // Stubbed: no DB access until ReturnNexus schema is finalized.
    return [
      { name: 'returnNexus.enabled', value: false },
      { name: 'returnNexus.returnsTracked', value: 0 }
    ];
  }
};

// --- WMS provider: basic operations readiness ---
export const wmsOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'wms',
  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    const zonesRow = await db('warehouse_locations')
      .where({ shop_id: shopId })
      .count<{ count: string }>('location_code as count')
      .first();
    const zonesConfigured = Number(zonesRow?.count ?? 0) > 0;

    const printedRow = await db('warehouse_locations')
      .where({ shop_id: shopId })
      .whereNotNull('last_printed_at')
      .count<{ count: string }>('location_code as count')
      .first();
    const barcodesPrinted = Number(printedRow?.count ?? 0) > 0;

    /**
     * Existence-only check: selects carrier_code alone so no encrypted
     * credential material (public_key/private_key/api_token) is ever
     * fetched into application memory. This signal means CONFIGURED, not
     * externally verified — it never decrypts or calls the carrier API.
     */
    const carrierRow = await db('shop_carrier_settings')
      .where({ shop_id: shopId, is_active: true })
      .where((qb) => {
        qb.where((sendcloud) =>
          sendcloud
            .where('carrier_code', 'sendcloud')
            .whereNotNull('public_key')
            .whereNotNull('private_key')
        ).orWhere((shippo) =>
          shippo.where('carrier_code', 'shippo').whereNotNull('api_token')
        );
      })
      .select('carrier_code')
      .first();
    const carrierConfigured = !!carrierRow;

    const openingSettings = await db('shop_wms_settings')
      .where({ shop_id: shopId })
      .select('bootstrap_model')
      .first();

    let openingInventoryReconciliationRequired = true;
    let openingInventoryProgressPct = 0;
    let openingInventoryNeedsReview = false;
    let openingInventoryReconciled = false;

    if (
      openingSettings?.bootstrap_model ===
      'legacy_opening_balance_v1'
    ) {
      openingInventoryReconciliationRequired = false;
      openingInventoryProgressPct = 100;
      openingInventoryNeedsReview = false;
      openingInventoryReconciled = true;
    } else if (
      openingSettings?.bootstrap_model ===
      'reconcile_opening_expectation_v2'
    ) {
      const openingProgress =
        await getShopOpeningInventoryProgress(
          db as any,
          shopId
        );

      openingInventoryReconciliationRequired =
        openingProgress.reconciliation_required;
      openingInventoryProgressPct =
        openingProgress.progress_pct;
      openingInventoryNeedsReview =
        openingProgress.state === 'needs_bin_review' ||
        openingProgress.state === 'review_required';

      /**
       * 4b-2a deliberately stops before merchant acceptance / Shopify
       * cutover. A v2 tenant cannot be called reconciled merely because every
       * bin was counted or the imported expectation happened to match.
       */
      openingInventoryReconciled = false;
    }

    return [
      { name: 'wms.enabled', value: zonesConfigured },
      { name: 'wms.zonesConfigured', value: zonesConfigured },
      { name: 'wms.barcodesPrinted', value: barcodesPrinted },
      { name: 'wms.carrierConfigured', value: carrierConfigured },
      {
        name: 'wms.openingInventoryReconciliationRequired',
        value: openingInventoryReconciliationRequired
      },
      {
        name: 'wms.openingInventoryProgressPct',
        value: openingInventoryProgressPct
      },
      {
        name: 'wms.openingInventoryNeedsReview',
        value: openingInventoryNeedsReview
      },
      {
        name: 'wms.openingInventoryReconciled',
        value: openingInventoryReconciled
      }
    ];
  }
};

// --- Problem Center provider: CNS "problems" pipeline readiness ---
export const problemCenterOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'problem-center',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // Stubbed: will later map to OpsIntel / ProblemCentral events.
    return [
      { name: 'problemCenter.enabled', value: false }
    ];
  }
};

// Register providers
// Register providers
export const onboardingSignalProviders: OnboardingSignalProvider[] = [
  devReadinessOverrideProvider, // Dev signal provider
  
  platformOnboardingSignalProvider,
  orderNexusOnboardingSignalProvider,
  // existing sku-os provider if you already added it earlier:
  skuOsOnboardingSignalProvider,
  financesOnboardingSignalProvider,
  returnNexusOnboardingSignalProvider,
  wmsOnboardingSignalProvider,
  problemCenterOnboardingSignalProvider
];

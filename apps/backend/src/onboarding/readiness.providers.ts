// apps/backend/src/onboarding/readiness.providers.ts
import db from '../db';
import {
  ReadinessSignal,
  ModuleId,
  computeModuleAccessState,
  ModuleEntitlementAccess,
  ReadinessSignalName,
  ReadinessSignalValue
} from '@lasyncro/shared';

import { specterOnboardingSignalProvider } from './providers/specter.provider';
import { analyticsOnboardingSignalProvider } from './providers/analytics.provider';
import { financesOnboardingSignalProvider } from './providers/finances.provider';

import { UserStateService } from '../services/user-state.service';
import { deriveKnownCount } from './utils/deriveKnownCount';

// canonical module IDs the provider will try to resolve (exported so tests can mock them)
 export const SPECTER_STORE_CANDIDATES = [
   'modules-specter/store/session-store',
   '../../../../modules/specter/src/store/session-store',
   `${process.cwd()}/modules/specter/src/store/session-store`,
   `${process.cwd()}/modules/specter/dist/store/session-store`
 ];

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
    const ordersRow = await db('canonical_orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const ordersIngested = Number(ordersRow?.count ?? 0);

    // 2) How many line items are still missing a cost?
    const missingCostRow = await db('canonical_order_line_items')
      .where({ shop_id: shopId })
      .whereNull('estimated_unit_cost')
      .count<{ count: string }>('id as count')
      .first();

    const missingCostCount = Number(missingCostRow?.count ?? 0);

    // 3) Free tier access – FT0: everyone gets free-tier OrderNexus, usage based on order count
    const entitlementAccess: ModuleEntitlementAccess = 'free-tier';

    const freeTier = computeModuleAccessState({
      moduleId: 'order-nexus',
      usageCount: ordersIngested,
      entitlementAccess,
    });

    // 4) FT0 stubs for "profitability" detail; we'll wire real signals later
    const profitabilityActive = ordersIngested > 0;
    const hasNegativeMarginOrder = false; // FT0 stub
    const modeDetermined = false;         // FT0 stub

    return [
      {
        name: 'orderNexus.ordersKnown',
        value: true, // query executed → count is known
      },
      {
        name: 'orderNexus.profitabilityActive',
        value: profitabilityActive,
      },
      {
        name: 'orderNexus.ordersIngested',
        value: ordersIngested,
      },
      {
        name: 'orderNexus.missingCostCount',
        value: missingCostCount,
      },
      {
        name: 'orderNexus.hasNegativeMarginOrder',
        value: hasNegativeMarginOrder,
      },
      {
        name: 'orderNexus.modeDetermined',
        value: modeDetermined,
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
      const row = await db('canonical_products')
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

// --- InsightCore provider: base CNS intelligence readiness ---
export const insightCoreOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'insight-core',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // Read counts from canonical tables (DB-safe).
    // If tables are missing or queries fail, fall back to 0 counts and baseSignalsReady=false.
    try {
      const ordersRow = await db('canonical_orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('id as count')
        .first();

      const productsRow = await db('canonical_products')
        .where({ shop_id: shopId })
        .count<{ count: string }>('id as count')
        .first();

      const orderCount = Number(ordersRow?.count ?? 0);
      const productCount = Number(productsRow?.count ?? 0);

      const baseSignalsReady = orderCount > 0 && productCount > 0;

      return [
        { name: 'insightCore.orderCount', value: orderCount },
        { name: 'insightCore.productCount', value: productCount },
        { name: 'insightCore.baseSignalsReady', value: baseSignalsReady }
      ];
    } catch (err) {
      // Safe fallback for environments where the schema isn't present yet.
      return [
        { name: 'insightCore.orderCount', value: 0 },
        { name: 'insightCore.productCount', value: 0 },
        { name: 'insightCore.baseSignalsReady', value: false }
      ];
    }
  }
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

// --- WMS Lite provider: basic operations readiness ---
export const wmsLiteOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'wms-lite',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // Stubbed: FT0 does not yet expose WMS flows.
    return [
      { name: 'wmsLite.enabled', value: false }
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
  platformOnboardingSignalProvider,
  orderNexusOnboardingSignalProvider,
  // existing sku-os provider if you already added it earlier:
  skuOsOnboardingSignalProvider,
  // new CNS spine providers:
  specterOnboardingSignalProvider,
  insightCoreOnboardingSignalProvider,
  analyticsOnboardingSignalProvider,
  financesOnboardingSignalProvider,
  returnNexusOnboardingSignalProvider,
  wmsLiteOnboardingSignalProvider,
  problemCenterOnboardingSignalProvider
];

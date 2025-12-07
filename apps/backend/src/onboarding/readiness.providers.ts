// apps/backend/src/onboarding/readiness.providers.ts
import db from '../db';
import {
  ReadinessSignal,
  ModuleId,
} from '@lasyncro/shared';
import { UserStateService } from '../services/user-state.service';

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

// --- OrderNexus provider: orders & profitability readiness ---
export const orderNexusOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'order-nexus',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // Count canonical orders for this shop.
    const row = await db('canonical_orders')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const ordersIngested = Number(row?.count ?? 0);

    return [
      {
        name: 'orderNexus.profitabilityActive',
        value: ordersIngested > 0,
      },
      {
        name: 'orderNexus.ordersIngested',
        value: ordersIngested,
      },
    ];
  },
};

// --- SKU OS provider: product catalog & inventory readiness ---
export const skuOsOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'sku-os',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // IMPORTANT: use the actual table we have in the schema: `shopify_products`
    const row = await db('shopify_products')
      .where({ shop_id: shopId })
      .count<{ count: string }>('id as count')
      .first();

    const productCount = Number(row?.count ?? 0);

    // v1 heuristic: once we have at least 10 products in the catalog,
    // we consider SKU-OS "ready" to surface inventory intelligence.
    const inventoryInsightsReady = productCount >= 10;

    return [
      {
        name: 'skuOs.productCount',
        value: productCount,
      },
      {
        name: 'skuOs.inventoryInsightsReady',
        value: inventoryInsightsReady,
      },
    ];
  },
};

// --- Specter provider: customer & conversion intelligence readiness ---
export const specterOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'specter',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // For now, we expose a simple, DB-safe stub signal.
    // Later, this will be wired to real Specter config / SDK health.
    return [
      {
        name: 'specter.sdkInstalled',
        value: false // placeholder; refined in Specter FT0 issue
      }
    ];
  }
};

// --- InsightCore provider: base CNS intelligence readiness ---
export const insightCoreOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'insight-core',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // DB-safe placeholder signals.
    // Later, we can derive these from canonical_orders + product signals.
    const orderCount = 0;
    const productCount = 0;
    const baseSignalsReady = false;

    return [
      { name: 'insightCore.orderCount', value: orderCount },
      { name: 'insightCore.productCount', value: productCount },
      { name: 'insightCore.baseSignalsReady', value: baseSignalsReady }
    ];
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
  returnNexusOnboardingSignalProvider,
  wmsLiteOnboardingSignalProvider,
  problemCenterOnboardingSignalProvider
];



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

import { UserStateService } from '../services/user-state.service';

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
    const row = await db('canonical_products')
      .where({ shop_id: shopId })
      .count<{ count: string }>('* as count')
      .first();

    const rawCount = row ? Number(row.count) : 0;
    const productCount = Number.isFinite(rawCount) ? rawCount : 0;

    // v1 readiness: we treat "health events" as "we have at least some products to score"
    const productHealthEvents = productCount;

    const freeTier = computeModuleAccessState({
      moduleId: 'sku-os',
      usageCount: productCount,
      entitlementAccess: 'free-tier',
    });

    const signals: ReadinessSignal[] = [];

    signals.push(makeSignal('skuOs.productCount', productCount));
    signals.push(makeSignal('skuOs.productHealthEvents', productHealthEvents));
    signals.push(makeSignal('sku-os.freeTierState', freeTier.state));
    signals.push(makeSignal('sku-os.freeTierRemaining', freeTier.remaining ?? null));

    return signals;
  },
};

// --- Specter provider: customer & conversion intelligence readiness (FT0-aware) ---
export const specterOnboardingSignalProvider: OnboardingSignalProvider = {
  moduleId: 'specter',

  async getSignals({ shopId }: { shopId: number; userId?: number }): Promise<ReadinessSignal[]> {
    // Attempt to resolve the Specter store helpers used in FT0:
    // getSessionsLastNDays(shopId), getRecentEvents(shopId, limit), getShopConfig(shopId)
    let getSessionsLastNDays: ((shopId: number, days?: number) => Promise<any[]>) | undefined;
    let getRecentEvents: ((shopId: number, limit?: number) => Promise<any[]>) | undefined;
    let getShopConfig: ((shopId: number) => Promise<any | null>) | undefined;

    const tryAssign = (mod: any) => {
      if (!mod) return;
      getSessionsLastNDays = getSessionsLastNDays ?? (mod.getSessionsLastNDays ?? mod.default?.getSessionsLastNDays);
      getRecentEvents = getRecentEvents ?? (mod.getRecentEvents ?? mod.default?.getRecentEvents);
      getShopConfig = getShopConfig ?? (mod.getShopConfig ?? mod.default?.getShopConfig);
    };

    // Prefer the project alias (jest mocks or runtime alias)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod: any = require('modules-specter/store/session-store');
      tryAssign(mod);
    } catch (_) {
      // ignore
    }

    // Try ESM-style import as fallback
    if (!getSessionsLastNDays || !getRecentEvents || !getShopConfig) {
      try {
        const mod: any = await import('modules-specter/store/session-store');
        tryAssign(mod);
      } catch (_) {
        // ignore
      }
    }

    // Additional path fallbacks (src/dist)
    if (!getSessionsLastNDays || !getRecentEvents || !getShopConfig) {
      for (const c of SPECTER_STORE_CANDIDATES) {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const mod: any = require(c);
          tryAssign(mod);
          if (getSessionsLastNDays && getRecentEvents && getShopConfig) break;
        } catch (_) {
          // ignore
        }
      }
    }

    // Default conservative values
    let sdkInstalled = false;
    let sessionVolume = 0;
    let intentFeedActive = false;
    let exitIntentRate = 0;
    let topPageFunnelsDetected = false;
    let customerSignalFallbackMode: 'default' | 'fallback' | 'integrated' = 'default';
    let configObj: any = null;

    const hasSessionsHelper = typeof getSessionsLastNDays === 'function';
    const hasEventsHelper = typeof getRecentEvents === 'function';
    const hasConfigHelper = typeof getShopConfig === 'function';

    // DEBUG: reveal which store helpers we managed to resolve in this environment.
    // This will print in test logs / server logs and is safe to keep as debug-level output.
    // Example output: { hasGetSessionsLastNDays: true, hasGetRecentEvents: false, hasGetShopConfig: true }
    try {
      // eslint-disable-next-line no-console
      console.debug('[specterOnboarding] resolved helpers', {
        hasGetSessionsLastNDays: typeof getSessionsLastNDays === 'function',
        hasGetRecentEvents: typeof getRecentEvents === 'function',
        hasGetShopConfig: typeof getShopConfig === 'function',
      });
    } catch (_) {
      // ignore any logging errors
    }

    try {
      // 1) detect SDK/store presence.
      // Require *both* core helpers for full "integrated" mode. If only one helper exists,
      // treat as partial/fragile (fallback mode) so we remain conservative in readiness signals.
      if (typeof getRecentEvents === 'function' && typeof getSessionsLastNDays === 'function') {
        sdkInstalled = true;
        customerSignalFallbackMode = 'integrated';
      } else if (typeof getRecentEvents === 'function' || typeof getSessionsLastNDays === 'function') {
        // partial presence — mark as fragile but indicate some SDK bits exist.
        sdkInstalled = true;
        customerSignalFallbackMode = 'fallback';
      } else {
        // No helpers present — full fallback.
        sdkInstalled = false;
        customerSignalFallbackMode = 'fallback';
      }

      // DEBUG: log the detection result and intended mode (helpful in CI)
      try {
        // eslint-disable-next-line no-console
        console.debug('[specterOnboarding] detection result', {
          sdkInstalled,
          customerSignalFallbackMode,
          resolvedHelpers: {
            hasGetSessionsLastNDays: typeof getSessionsLastNDays === 'function',
            hasGetRecentEvents: typeof getRecentEvents === 'function',
            hasGetShopConfig: typeof getShopConfig === 'function'
          }
        });
      } catch (_) { /* ignore logging errors */ }

      // 2) compute session volume (last 7 days)
      if (typeof getSessionsLastNDays === 'function') {
        try {
          const sessions = await getSessionsLastNDays(shopId, 7);
          sessionVolume = Array.isArray(sessions) ? sessions.length : 0;
        } catch (_) {
          sessionVolume = 0;
        }
      } else if (typeof getRecentEvents === 'function') {
        // fallback heuristic: count session.start events in recent events
        try {
          const ev = await getRecentEvents(shopId, 200);
          const sessionStarts = Array.isArray(ev) ? ev.filter((e: any) => String(e.type).startsWith('session.')).length : 0;
          sessionVolume = sessionStarts;
        } catch (_) {
          sessionVolume = 0;
        }
      }

      // 3) compute exitIntent rate and intent feed health from recent events / sessions
      if (typeof getRecentEvents === 'function') {
        try {
          const ev = await getRecentEvents(shopId, 200);
          const events = Array.isArray(ev) ? ev : [];
          const exitIntents = events.filter((e: any) => e && e.type === 'exit.intent').length;
          const pageViews = events.filter((e: any) => e && e.type && String(e.type).startsWith('page.')).length;
          exitIntentRate = pageViews > 0 ? exitIntents / pageViews : (sessionVolume > 0 ? exitIntents / sessionVolume : 0);
          intentFeedActive = events.length > 0;
          // crude funnel detection: presence of specific funnel event types
          topPageFunnelsDetected = events.some((e: any) => e && (e.type === 'funnel.detected' || e.type === 'page.funnel'));
        } catch (_) {
          exitIntentRate = 0;
          intentFeedActive = false;
          topPageFunnelsDetected = false;
        }
      } else if (typeof getSessionsLastNDays === 'function') {
        // fallback: analyze sessions for exitIntent boolean
        try {
          const sessions = await getSessionsLastNDays(shopId, 7);
          const sessionsArr = Array.isArray(sessions) ? sessions : [];
          const exitCount = sessionsArr.filter((s: any) => !!s.exitIntent).length;
          exitIntentRate = sessionsArr.length > 0 ? exitCount / sessionsArr.length : 0;
          intentFeedActive = sessionsArr.length > 0;
          topPageFunnelsDetected = false;
        } catch (_) {
          exitIntentRate = 0;
          intentFeedActive = false;
          topPageFunnelsDetected = false;
        }
      }

      // 4) shop config (optional)
      if (typeof getShopConfig === 'function') {
        try {
          configObj = await getShopConfig(shopId);
        } catch (_) {
          configObj = null;
        }
      }
    } catch (err) {
      // non-fatal: just return stubs if anything fails
      sdkInstalled = sdkInstalled ?? false;
      sessionVolume = sessionVolume ?? 0;
      intentFeedActive = intentFeedActive ?? false;
      exitIntentRate = exitIntentRate ?? 0;
      topPageFunnelsDetected = topPageFunnelsDetected ?? false;
    }

    // Compose signals (FT0-appropriate)
    const signals: ReadinessSignal[] = [
      { name: 'specter.sdkInstalled', value: sdkInstalled },
      { name: 'specter.sessionVolume', value: sessionVolume },
      { name: 'specter.intentFeedActive', value: intentFeedActive },
      { name: 'specter.exitIntentRate', value: exitIntentRate },
      { name: 'specter.topPageFunnelsDetected', value: topPageFunnelsDetected },
      { name: 'specter.customerSignalFallbackMode', value: customerSignalFallbackMode },
      { name: 'specter.config', value: configObj ?? null }
    ];

        // DEBUG: final computed signal summary for diagnostics
    try {
      // eslint-disable-next-line no-console
      console.debug('[specterOnboarding] computed signals summary', {
        shopId,
        sdkInstalled,
        sessionVolume,
        intentFeedActive,
        exitIntentRate,
        topPageFunnelsDetected,
        customerSignalFallbackMode,
        configPresent: !!configObj
      });
    } catch (_) { /* ignore */ }

    return signals;
  }
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
  returnNexusOnboardingSignalProvider,
  wmsLiteOnboardingSignalProvider,
  problemCenterOnboardingSignalProvider
];



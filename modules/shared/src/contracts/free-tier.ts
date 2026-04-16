// modules/shared/src/contracts/free-tier.ts
// Free Tier Exposure Policy Contract (FTEP v1.1) – LOCKED
import { ModuleId } from './onboarding.js';

export type ModuleAccessState =
  | 'visible'
  | 'free_tier_active'
  | 'free_tier_exhausted'
  | 'locked';

export interface ModuleFreeTierPolicy {
  enabled: boolean;
  maxUnits: number | null;
  metric:
    | 'orders'
    | 'skus'
    | 'returns'
    | 'nudges'
    | 'insights'
    | 'tasks'
    | 'pos';

  softWarningThreshold?: number;

  upgradeRoute: string;
  lockedMessage: string;

  resetPeriod: 'monthly';
}

export interface ModuleConfig {
  moduleId: ModuleId;
  freeTier: ModuleFreeTierPolicy;
}

// Default Free Tier policy per module – FTEP v1.1
// This is the SINGLE source of truth for module-level free-tier limits.

export const MODULE_FREE_TIER_POLICIES: Record<ModuleId, ModuleFreeTierPolicy> = {
  // FT0 / platform-level – not gated by free tier
  platform: {
    enabled: false,
    maxUnits: null,
    metric: 'tasks',
    upgradeRoute: '/upgrade',
    lockedMessage: 'Core platform access is always available on the Free tier.',
    resetPeriod: 'monthly'
  },

  // Profitability engine – 50 orders/month
  'order-nexus': {
    enabled: true,
    maxUnits: 50,
    metric: 'orders',
    softWarningThreshold: 0.8,
    upgradeRoute: '/upgrade/order-nexus',
    lockedMessage:
      'You have reached the Free tier limit for OrderNexus profitability analysis. Upgrade to unlock full profitability intelligence.',
    resetPeriod: 'monthly'
  },

  // Returns – 3 cases/month
  'return-nexus': {
    enabled: true,
    maxUnits: 3,
    metric: 'returns',
    softWarningThreshold: 0.8,
    upgradeRoute: '/upgrade/return-nexus',
    lockedMessage:
      'You have reached the Free tier limit for ReturnNexus workflows. Upgrade to manage all your return cases.',
    resetPeriod: 'monthly'
  },

  // Specter – 1 nudge/day (~30/month) – we track monthly, policy is “about 1/day”
  specter: {
    enabled: true,
    maxUnits: 30,
    metric: 'nudges',
    softWarningThreshold: 0.8,
    upgradeRoute: '/upgrade/specter',
    lockedMessage:
      'You have reached the Free tier limit for Specter nudges. Upgrade to unlock continuous CNS intelligence.',
    resetPeriod: 'monthly'
  },

  // Finances – diagnostic only in FT1, no free-tier gating
  finances: {
    enabled: false,
    maxUnits: null,
    metric: 'orders',
    upgradeRoute: '/upgrade/finances',
    lockedMessage:
      'Financial diagnostics are always available at the diagnostic level on the Free tier.',
    resetPeriod: 'monthly'
  },

  // SKU-OS – 5 SKUs
  'sku-os': {
    enabled: true,
    maxUnits: 5,
    metric: 'skus',
    softWarningThreshold: 0.8,
    upgradeRoute: '/upgrade/sku-os',
    lockedMessage:
      'You have reached the Free tier limit for SKU-OS. Upgrade to manage your full catalog in CNS.',
    resetPeriod: 'monthly'
  },

  // WMS Lite – 1 PO/month
  'wms-lite': {
    enabled: true,
    maxUnits: 1,
    metric: 'pos',
    softWarningThreshold: 1.0,
    upgradeRoute: '/upgrade/wms-lite',
    lockedMessage:
      'You have reached the Free tier limit for WMS Lite. Upgrade to automate your full operations.',
    resetPeriod: 'monthly'
  },

  // Problem Center – 1 workflow
  'problem-center': {
    enabled: true,
    maxUnits: 1,
    metric: 'tasks',
    softWarningThreshold: 1.0,
    upgradeRoute: '/upgrade/problem-center',
    lockedMessage:
      'You have reached the Free tier limit for Problem Center workflows. Upgrade to unlock the full EchoHub experience.',
    resetPeriod: 'monthly'
  },

  // FEAT-001: Suppliers Portal — PO management, supplier ratings, ETA tracking
  'suppliers-portal': {
    enabled: false,
    maxUnits: null,
    metric: 'tasks',
    upgradeRoute: '/upgrade/suppliers-portal',
    lockedMessage: 'Suppliers Portal is not available on the Free tier. Upgrade to manage POs, ETAs, and supplier ratings.',
    resetPeriod: 'monthly',
  },

  // FEAT-002: Floor Planning — warehouse floor layout + barcode management
  'floor-planning': {
    enabled: false,
    maxUnits: null,
    metric: 'tasks',
    upgradeRoute: '/upgrade/floor-planning',
    lockedMessage: 'Floor Planning is not available on the Free tier. Upgrade to manage warehouse layouts and barcodes.',
    resetPeriod: 'monthly',
  },
};

// How entitlements describe module-level access.
// "allowed"  -> paid / full access
// "free-tier" -> subject to FTEP limits
// "locked"  -> no access (plan restriction)
export type ModuleEntitlementAccess = 'allowed' | 'free-tier' | 'locked';

export interface ModuleAccessComputationInput {
  moduleId: ModuleId;
  usageCount: number | null;
  entitlementAccess: ModuleEntitlementAccess;
}

export interface ModuleAccessComputationResult {
  state: ModuleAccessState;
  /**
   * Remaining units in this period.
   * null = not applicable / unlimited (e.g., paid plan, disabled FTEP, or unlimited policy).
   */
  remaining: number | null;
}

export function computeModuleAccessState(
  input: ModuleAccessComputationInput
): ModuleAccessComputationResult {
  const { moduleId, usageCount, entitlementAccess } = input;

  // 1. Hard lock via entitlements
  if (entitlementAccess === 'locked') {
    return {
      state: 'locked',
      remaining: 0
    };
  }

  const policy = MODULE_FREE_TIER_POLICIES[moduleId];

  // 2. No policy or disabled policy or unlimited maxUnits => no gating
  if (!policy || !policy.enabled || policy.maxUnits === null) {
    return {
      state: 'visible',
      remaining: null
    };
  }

  // 3. Paid plans ("allowed") – unlimited usage but treated as active
  if (entitlementAccess === 'allowed') {
    return {
      state: 'free_tier_active',
      remaining: null
    };
  }

  // 4. Free-tier enforcement
  // If usage is unknown, do not enforce free-tier limits
  if (usageCount == null) {
    return {
      state: 'visible',
      remaining: null
    };
  }

  const safeUsage = Math.max(0, usageCount);
  const maxUnits = policy.maxUnits;

  if (safeUsage >= maxUnits) {
    return {
      state: 'free_tier_exhausted',
      remaining: 0
    };
  }

  return {
    state: 'free_tier_active',
    remaining: maxUnits - safeUsage
  };
}

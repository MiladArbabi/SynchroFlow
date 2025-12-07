// modules/shared/src/contracts/free-tier.ts
// Free Tier Exposure Policy Contract (FTEP v1.1) – LOCKED
import { ModuleId } from './onboarding';

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

  // InsightCore – 2 insights/day (~60/month)
  'insight-core': {
    enabled: true,
    maxUnits: 60,
    metric: 'insights',
    softWarningThreshold: 0.8,
    upgradeRoute: '/upgrade/insight-core',
    lockedMessage:
      'You have reached the Free tier limit for InsightCore. Upgrade to unlock continuous insight generation.',
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
  }
};

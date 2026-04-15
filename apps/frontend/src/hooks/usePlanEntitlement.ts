/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/hooks/usePlanEntitlement.ts
//
// Plan Entitlement Hook (MON-06)
// ------------------------------
// Single interface for all tier-gated UI decisions.
//
// Sourced from EntitlementsContext — zero additional network calls.
//
// Usage:
//   const { tier, can, mustUpgradeTo } = usePlanEntitlement();
//   if (can('orders.sla_bands')) { ... }
//   const target = mustUpgradeTo('wms.pick_batches'); // 'core' | null
//
// CHANGE POLICY:
//   Add new features to PLAN_FEATURES below — never gate inline with raw tier strings.
//   Feature keys follow the pattern '<module>.<feature>'.

import { useEntitlements } from '../contexts/EntitlementsContext';
import { Tier, TIERS } from '../config/tiers';

// --- Feature registry ---
// Maps every gated feature to its minimum required tier.
// Evaluated cumulatively: 'growth' includes 'core' includes 'starter'.
const PLAN_FEATURES = {
  // Orders
  'orders.sla_bands':          'core',
  'orders.aging_orders':       'core',
  'orders.quick_actions':      'growth',
  'orders.bulk_review':        'growth',
  'orders.pick_list':          'growth',
  'orders.advanced_filters':   'growth',

  // Products
  'products.operator_summary': 'core',
  'products.sku_gaps':         'core',
  'products.top_returned':     'growth',

  // Cash Flow
  'cashflow.revenue_buckets':      'core',
  'cashflow.constraint_breakdown': 'growth',

  // Customers
  'customers.ltv':             'growth',
  'customers.segmentation':    'growth',

  // Demand
  'demand.forecasting':        'growth',

  // Returns
  'returns.analysis':          'growth',

  // Finances
  'finances.overview':         'growth',

  // WMS
  'wms.pick_batches':          'core',
  'wms.pack':                  'core',
  'wms.stow':                  'core',
  'wms.sku_gaps':              'core',

  // Alerts
  'alerts.inbox':              'core',

  // Specter
  'specter.full_capture':      'growth',
} as const satisfies Record<string, Tier>;

export type PlanFeature = keyof typeof PLAN_FEATURES;

const TIER_ORDER: Record<Tier, number> = {
  starter: 0,
  core:    1,
  growth:  2,
  scale:   3,
};

export function usePlanEntitlement() {
  const { tier } = useEntitlements();

  /**
   * Returns true if the current tier meets the minimum required for this feature.
   */
  function can(feature: PlanFeature): boolean {
    const required = PLAN_FEATURES[feature];
    return TIER_ORDER[tier] >= TIER_ORDER[required];
  }

  /**
   * Returns the minimum tier needed to unlock this feature, or null if already unlocked.
   * Use to drive upgrade prompt CTAs.
   */
  function mustUpgradeTo(feature: PlanFeature): Tier | null {
    const required = PLAN_FEATURES[feature];
    if (TIER_ORDER[tier] >= TIER_ORDER[required]) return null;
    return required;
  }

  return {
    tier,
    can,
    mustUpgradeTo,
  };
}
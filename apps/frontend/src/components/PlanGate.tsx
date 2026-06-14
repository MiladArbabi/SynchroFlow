// apps/frontend/src/components/PlanGate.tsx
//
// PlanGate (MON-06)
// -----------------
// Declarative tier-gating wrapper for any UI section.
// Composes usePlanEntitlement + UpgradePrompt — no logic duplication.
//
// Modes:
//   'locked' — hides children entirely, renders UpgradePrompt in place.
//   'teased' — renders children blurred with UpgradePrompt overlaid.
//
// Usage:
//   <PlanGate feature="orders.sla_bands" mode="teased">
//     <SLABandsSection />
//   </PlanGate>
//
// CHANGE POLICY:
//   Never add inline tier strings here.
//   To gate a new feature, add it to PLAN_FEATURES in usePlanEntitlement.ts.

import React, { ReactNode } from 'react';
import { usePlanEntitlement, PlanFeature } from '../hooks/usePlanEntitlement';
import { Tier } from '../config/tiers';
import { UpgradePrompt } from './UpgradePrompt';

// Human-readable feature names for upgrade CTA copy.
// Add an entry here when adding a new feature to PLAN_FEATURES.
const FEATURE_LABELS: Partial<Record<PlanFeature, string>> = {
  'orders.sla_bands':          'SLA Bands',
  'orders.aging_orders':       'Aging Orders',
  'orders.quick_actions':      'Quick Actions',
  'orders.bulk_review':        'Bulk Review',
  'orders.pick_list':          'Pick List',
  'orders.advanced_filters':   'Advanced Filters',
  'products.operator_summary': 'Products Summary',
  'products.problem_center':   'Problem Center',
  'products.top_returned':     'Top Returned Products',
  'cashflow.revenue_buckets':      'Cash Flow',
  'cashflow.constraint_breakdown': 'Constraint Breakdown',
  'customers.ltv':             'Customer LTV',
  'customers.segmentation':    'Customer Segmentation',
  'demand.forecasting':        'Demand Forecasting',
  'returns.analysis':          'Returns Analysis',
  'finances.overview':         'Finances',
  'wms.pick_batches':          'WMS',
  'wms.pack':                  'WMS Pack',
  'wms.stow':                  'WMS Stow',
  'wms.problem_center':        'WMS Problem Center',
  'problem-center.analytics':  'Problem Center Analytics',
  'alerts.inbox':              'Alerts',
  'specter.full_capture':      'Full Analytics',
};

interface PlanGateProps {
  feature: PlanFeature;
  mode?: 'locked' | 'teased';
  children: ReactNode;
}

export const PlanGate: React.FC<PlanGateProps> = ({
  feature,
  mode = 'locked',
  children,
}) => {
  const { can, mustUpgradeTo } = usePlanEntitlement();

  if (can(feature)) {
    return <>{children}</>;
  }

  const requiredTier = mustUpgradeTo(feature) as Tier;
  const featureName = FEATURE_LABELS[feature];

  return (
    <UpgradePrompt
      requiredTier={requiredTier}
      mode={mode === 'teased' ? 'overlay' : 'overlay'}
      featureName={featureName}
    >
      {mode === 'teased' ? children : undefined}
    </UpgradePrompt>
  );
};

export default PlanGate;
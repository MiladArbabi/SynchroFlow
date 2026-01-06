// apps/frontend/src/pages/customers/useCustomersFt2Adapter.ts

import type { CustomersModuleFT2Props } from '@lasyncro/customers';

type CustomersFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  customersAnalyzed?: number | null;

  valueSummary?: {
    activeCustomers?: number | null;
    repeatRatePct?: number | null;
    avgOrderValue?: number | null;
    lifetimeValue?: number | null;
    currency?: string | null;
  };

  qualitySignal?: {
    type:
      | 'low_repeat'
      | 'low_value'
      | 'high_churn'
      | 'concentration'
      | 'unknown';
    confidence: 'high' | 'medium' | 'low';
  } | null;

  timeSignal?: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
};

/**
 * FT2 Customers Adapter
 * --------------------
 * Pure mapping from backend snapshot → CustomersModuleFT2Props
 *
 * Invariants:
 * - No inference
 * - No lifecycle
 * - No defaulting beyond undefined → null
 * - Shape-stable
 */
export function mapCustomersFt2Props(
  snapshot: CustomersFt2Snapshot
): CustomersModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },
      customersAnalyzed:
        snapshot.customersAnalyzed === undefined
          ? null
          : snapshot.customersAnalyzed,
    },

    valueSummary: {
      activeCustomers:
        snapshot.valueSummary?.activeCustomers === undefined
          ? null
          : snapshot.valueSummary.activeCustomers,
      repeatRatePct:
        snapshot.valueSummary?.repeatRatePct === undefined
          ? null
          : snapshot.valueSummary.repeatRatePct,
      avgOrderValue:
        snapshot.valueSummary?.avgOrderValue === undefined
          ? null
          : snapshot.valueSummary.avgOrderValue,
      lifetimeValue:
        snapshot.valueSummary?.lifetimeValue === undefined
          ? null
          : snapshot.valueSummary.lifetimeValue,
      currency:
        snapshot.valueSummary?.currency === undefined
          ? null
          : snapshot.valueSummary.currency,
    },

    qualitySignal:
      snapshot.qualitySignal === undefined
        ? null
        : snapshot.qualitySignal,

    timeSignal:
      snapshot.timeSignal === undefined ? null : snapshot.timeSignal,
  };
}
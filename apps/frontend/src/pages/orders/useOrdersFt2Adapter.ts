// apps/frontend/src/pages/orders/useOrdersFt2Adapter.ts

import type { OrdersModuleFT2Props } from '@lasyncro/order-nexus';

type OrdersFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };
  ordersAnalyzed?: number | null;

  marginSummary?: {
    avgMarginPct?: number | null;
    lossRatePct?: number | null;
    totalLossAmount?: number | null;
    currency?: string | null;
  };

  lossDrivers?: Array<{
    type:
      | 'shipping'
      | 'product_cost'
      | 'fees'
      | 'discount'
      | 'refund'
      | 'overhead'
      | 'unknown';
    contributionPct?: number | null;
    confidence: 'high' | 'medium' | 'low';
  }> | null;

  patterns?: Array<{
    description: string;
    affectedOrdersPct?: number | null;
    estimatedImpact?: number | null;
    currency?: string | null;
  }> | null;

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
 * FT2 Orders Adapter
 * ------------------
 * Pure mapping from backend snapshot → OrdersModuleFT2Props
 *
 * Invariants:
 * - No inference
 * - No lifecycle checks
 * - No defaulting (null is preserved)
 * - Shape-stable
 */
export function mapOrdersFt2Props(
  snapshot: OrdersFt2Snapshot
): OrdersModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },
      ordersAnalyzed:
        snapshot.ordersAnalyzed === undefined
          ? null
          : snapshot.ordersAnalyzed,
    },

    marginSummary: {
      avgMarginPct:
        snapshot.marginSummary?.avgMarginPct === undefined
          ? null
          : snapshot.marginSummary.avgMarginPct,
      lossRatePct:
        snapshot.marginSummary?.lossRatePct === undefined
          ? null
          : snapshot.marginSummary.lossRatePct,
      totalLossAmount:
        snapshot.marginSummary?.totalLossAmount === undefined
          ? null
          : snapshot.marginSummary.totalLossAmount,
      currency:
        snapshot.marginSummary?.currency === undefined
          ? null
          : snapshot.marginSummary.currency,
    },

    lossDrivers:
      snapshot.lossDrivers == null
        ? null
        : snapshot.lossDrivers.map((d) => ({
            type: d.type,
            contributionPct:
              d.contributionPct === undefined ? null : d.contributionPct,
            confidence: d.confidence,
          })),

    patterns:
      snapshot.patterns == null
        ? null
        : snapshot.patterns.map((p) => ({
            description: p.description,
            affectedOrdersPct:
              p.affectedOrdersPct === undefined
                ? null
                : p.affectedOrdersPct,
            estimatedImpact:
              p.estimatedImpact === undefined
                ? null
                : p.estimatedImpact,
            currency:
              p.currency === undefined ? null : p.currency,
          })),

    timeSignal:
      snapshot.timeSignal === undefined ? null : snapshot.timeSignal,
  };
}
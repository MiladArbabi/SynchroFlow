// apps/frontend/src/pages/products/useProductsFt2Adapter.ts

import type { ProductsModuleFT2Props } from '@lasyncro/products';

type ProductsFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  productsAnalyzed?: number | null;

  productSummary?: {
    totalRevenue?: number | null;
    totalCost?: number | null;
    netContribution?: number | null;
    currency?: string | null;
  };

  productBreakdown?: Array<{
    sku: string;
    revenue?: number | null;
    cost?: number | null;
    marginPct?: number | null;
  }> | null;

  dominantProductPressure?: {
    sku: string;
    pressureType:
      | 'loss'
      | 'low-margin'
      | 'overhead-heavy'
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
 * FT2 Products Adapter
 * -------------------
 * Pure mapping from backend snapshot → ProductsModuleFT2Props
 *
 * Invariants:
 * - No inference
 * - No lifecycle
 * - Undefined → null
 * - Shape-stable
 */
export function mapProductsFt2Props(
  snapshot: ProductsFt2Snapshot
): ProductsModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },
      productsAnalyzed:
        snapshot.productsAnalyzed === undefined
          ? null
          : snapshot.productsAnalyzed,
    },

    productSummary: {
      totalRevenue:
        snapshot.productSummary?.totalRevenue === undefined
          ? null
          : snapshot.productSummary.totalRevenue,
      totalCost:
        snapshot.productSummary?.totalCost === undefined
          ? null
          : snapshot.productSummary.totalCost,
      netContribution:
        snapshot.productSummary?.netContribution === undefined
          ? null
          : snapshot.productSummary.netContribution,
      currency:
        snapshot.productSummary?.currency === undefined
          ? null
          : snapshot.productSummary.currency,
    },

    productBreakdown:
      snapshot.productBreakdown == null
        ? null
        : snapshot.productBreakdown.map((p) => ({
            sku: p.sku,
            revenue: p.revenue === undefined ? null : p.revenue,
            cost: p.cost === undefined ? null : p.cost,
            marginPct:
              p.marginPct === undefined ? null : p.marginPct,
          })),

    dominantProductPressure:
      snapshot.dominantProductPressure === undefined
        ? null
        : snapshot.dominantProductPressure,

    timeSignal:
      snapshot.timeSignal === undefined ? null : snapshot.timeSignal,
  };
}
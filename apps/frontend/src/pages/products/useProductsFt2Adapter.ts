// apps/frontend/src/pages/products/useProductsFt2Adapter.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// FT2 Products Adapter
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT
// ----
// Pure adapter mapping a backend snapshot into the **Products FT2 observability
// contract**.
//
// This adapter is a **dumb pipe**.
// It exists ONLY to normalize shape and preserve null semantics.
//
//
// WHY
// ---
// FT2 must remain:
// - Read-only
// - Non-inferential
// - Shape-stable
//
// Any intelligence, prioritization, or “why” is explicitly forbidden here
// and belongs to SKU-OS / FT3+.
//
//
// INVARIANTS (NON-NEGOTIABLE)
// --------------------------
// - No inference
// - No defaults (except undefined → null)
// - No computation
// - No semantic mapping
// - Never throws
//
// If you feel tempted to “help” the data → STOP.
//
// ─────────────────────────────────────────────────────────────────────────────

import type { ProductsModuleFT2Props } from '@lasyncro/products';

/**
 * ProductsFt2Snapshot
 * -------------------
 * Backend snapshot shape as consumed by FT2.
 *
 * This is intentionally permissive and nullable.
 * The adapter enforces the UI contract, not meaning.
 */
type ProductsFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  productsObserved?: number | null;

  productSummary?: {
    totalRevenue?: number | null;
    totalCost?: number | null;
    netValue?: number | null;
    currency?: string | null;
  };

  productBreakdown?: Array<{
    sku: string;
    revenue?: number | null;
    cost?: number | null;
    marginReportedPct?: number | null;
  }> | null;

  trendSignal?: {
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
 * mapProductsFt2Props
 * ------------------
 * Canonical FT2 adapter.
 *
 * Converts a backend snapshot into ProductsModuleFT2Props
 * without inference or interpretation.
 */
export function mapProductsFt2Props(
  snapshot: ProductsFt2Snapshot
): ProductsModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },
      productsObserved:
        snapshot.productsObserved === undefined
          ? null
          : snapshot.productsObserved,
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
      netValue:
        snapshot.productSummary?.netValue === undefined
          ? null
          : snapshot.productSummary.netValue,
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
            revenue:
              p.revenue === undefined ? null : p.revenue,
            cost: p.cost === undefined ? null : p.cost,
            marginReportedPct:
              p.marginReportedPct === undefined
                ? null
                : p.marginReportedPct,
          })),

    trendSignal:
      snapshot.trendSignal === undefined
        ? null
        : snapshot.trendSignal,
  };
}
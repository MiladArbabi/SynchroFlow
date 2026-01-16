// apps/frontend/src/pages/products/useProductsFt2Adapter.ts

import type { ProductsModuleFT2Props } from '@lasyncro/products';

/**
 * ProductsFt2Snapshot
 * -------------------
 * Authoritative backend FT2 snapshot shape for Products.
 *
 * Notes:
 * - Fields may be missing, null, or partial
 * - Adapter MUST NOT infer or compute
 * - Adapter MUST normalize undefined → null
 */
type ProductsFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    productsObserved?: number | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  signals?: {
    catalog: 'ok' | 'attention' | 'unknown';
    skuCoverage: 'ok' | 'gaps' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';
  } | null;
};

/**
 * mapProductsFt2Props
 * ------------------
 * Canonical FT2 Products adapter.
 *
 * Invariants:
 * - Pure function
 * - No inference
 * - No computation
 * - No semantic translation
 * - Deterministic output
 */
export function mapProductsFt2Props(
  snapshot: ProductsFt2Snapshot
): ProductsModuleFT2Props {
  return {
    context: {
      period: snapshot.context?.period ?? { from: null, to: null },

      productsObserved:
        snapshot.context?.productsObserved === undefined
          ? null
          : snapshot.context.productsObserved,
    },

    outcome:
      snapshot.outcome === undefined
        ? null
        : snapshot.outcome,

    trend:
      snapshot.trend === undefined
        ? null
        : snapshot.trend,

    signals:
      snapshot.signals === undefined
        ? null
        : snapshot.signals,
  };
}

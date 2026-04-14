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
export type ProductsFt2Snapshot = {
  context?: {
    period?: {
      from?: string;
      to?: string;
    };
    productsObserved?: number | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  /**
   * FT2 — Product Data Integrity
   *
   * Notes:
   * - Downgraded, lossy exposure
   * - Null = unknown or withheld by policy
   */
  productDataIntegrity?: {
    integrity: 'ok' | 'attention' | 'unknown';
    duplication: 'present' | 'absent' | 'unknown';
  } | null;

  operational?: {
    inventory: 'ok' | 'gaps' | 'unknown';
    fulfillment: 'visible' | 'missing' | 'unknown';
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;

  supply: {
    replenishment: 'observable' | 'missing' | 'unknown';
    coverage: 'complete' | 'partial' | 'missing' | 'unknown';
  } | null;

   // Each field is independently nullable — backend FTEP returns null per-field
  // when that domain's freshness is 'unknown' (see ProductDataFreshnessFtep.service.ts)
  dataFreshness?: {
    structural: 'fresh' | 'stale' | 'unknown' | null;
    inventory: 'fresh' | 'stale' | 'unknown' | null;
    sales: 'fresh' | 'stale' | 'unknown' | null;
    fulfillment: 'fresh' | 'stale' | 'unknown' | null;
    cost: 'fresh' | 'stale' | 'unknown' | null;
  } | null;

  alignment?: {
    alignment: 'aligned' | 'misaligned' | 'unknown';
  } | null;

  dependency?: {
    surface: 'isolated' | 'coupled' | 'unknown';
    blastRadius: 'contained' | 'wide' | 'unknown';
  } | null;

  // Catalog-level signals — downgraded from intelligence layer
  // Source of truth: ProductsFtep.types.ts → signals
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
      period: snapshot.context?.period
        ? {
            from: snapshot.context.period.from ?? '',
            to: snapshot.context.period.to ?? '',
          }
        : { from: '', to: '' },

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
    
    productDataIntegrity:
      snapshot.productDataIntegrity === undefined
        ? null
        : snapshot.productDataIntegrity,

    operational:
      snapshot.operational === undefined
        ? null
        : snapshot.operational,

    supply:
      snapshot.supply === undefined
        ? null
        : snapshot.supply,

    dataFreshness:
      snapshot.dataFreshness === undefined
        ? null
        : snapshot.dataFreshness,

    alignment:
      snapshot.alignment === undefined
        ? null
        : snapshot.alignment,
    
    dependency:
      snapshot.dependency === undefined
        ? null
        : snapshot.dependency,

    signals:
      snapshot.signals === undefined
        ? null
        : snapshot.signals,
  };
}
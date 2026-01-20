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

  dataGaps?: {
    productsWithConflictingDataCount?: number | null;
    totalProductsChecked?: number | null;

    productsWithMultipleSkusCount?: number | null;
    maxSkusPerProduct?: number | null;

    variantGrowth?: Array<{
      date: string;
      totalProducts: number;
      totalVariants: number;
    }> | null;
  } | null;

  operationalRisk?: {
    productsWithConfirmedStockCount?: number | null;
    totalProducts?: number | null;

    productsWhereSalesExceedStockCount?: number | null;

    averageSystemsTouchedPerProduct?: number | null;
    productsTouchingMultipleSystemsCount?: number | null;
  } | null;

  economicBlindSpots?: {
    productsWithCostCount?: number | null;
    productsWithoutCostCount?: number | null;

    priceVsCostTrend?: Array<{
      date: string;
      averagePrice: number | null;
      averageCost: number | null;
    }> | null;

    revenueVsProfit?: Array<{
      productId: string;
      revenue: number;
      profit: number | null;
    }> | null;
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

    dataGaps:
      snapshot.dataGaps === undefined
        ? null
        : {
            productsWithConflictingDataCount:
              snapshot.dataGaps.productsWithConflictingDataCount ?? null,
            totalProductsChecked:
              snapshot.dataGaps.totalProductsChecked ?? null,

            productsWithMultipleSkusCount:
              snapshot.dataGaps.productsWithMultipleSkusCount ?? null,
            maxSkusPerProduct:
              snapshot.dataGaps.maxSkusPerProduct ?? null,

            variantGrowth:
              snapshot.dataGaps.variantGrowth ?? null,
          },

    operationalRisk:
      snapshot.operationalRisk === undefined
        ? null
        : {
            productsWithConfirmedStockCount:
              snapshot.operationalRisk.productsWithConfirmedStockCount ?? null,
            totalProducts:
              snapshot.operationalRisk.totalProducts ?? null,

            productsWhereSalesExceedStockCount:
              snapshot.operationalRisk.productsWhereSalesExceedStockCount ?? null,

            averageSystemsTouchedPerProduct:
              snapshot.operationalRisk.averageSystemsTouchedPerProduct ?? null,
            productsTouchingMultipleSystemsCount:
              snapshot.operationalRisk.productsTouchingMultipleSystemsCount ?? null,
          },

    economicBlindSpots:
      snapshot.economicBlindSpots === undefined
        ? null
        : {
            productsWithCostCount:
              snapshot.economicBlindSpots.productsWithCostCount ?? null,
            productsWithoutCostCount:
              snapshot.economicBlindSpots.productsWithoutCostCount ?? null,

            priceVsCostTrend:
              snapshot.economicBlindSpots.priceVsCostTrend ?? null,

            revenueVsProfit:
              snapshot.economicBlindSpots.revenueVsProfit ?? null,
          },
    
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

  };
}
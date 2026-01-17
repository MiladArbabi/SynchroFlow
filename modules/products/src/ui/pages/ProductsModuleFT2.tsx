// modules/products/src/ui/pages/ProductsModuleFT2.tsx

import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

/**
 * ProductsModuleFT2DataProps
 * --------------------------
 * DATA-ONLY FT2 contract.
 *
 * Rules:
 * - Observational facts only
 * - No inference, scoring, or recommendations
 * - Aggregated + time-series facts allowed
 * - Null = truth unavailable
 */
export interface ProductsModuleFT2DataProps {
  /** Global context */
  context: {
    period: {
      from: string;
      to: string;
    };
    productsObserved: number | null;
  };

  /** High-level system status (downgraded) */
  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  /** Directional trend (if available) */
  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * Layer 1 — DATA GAPS (Truth & Consistency)
   * ─────────────────────────────────────────
   */

  dataGaps: {
    /** Products with conflicting fields across systems */
    productsWithConflictingDataCount: number | null;
    totalProductsChecked: number | null;

    /** Products represented by multiple SKUs */
    productsWithMultipleSkusCount: number | null;
    maxSkusPerProduct: number | null;

    /** Variant growth over time */
    variantGrowth: Array<{
      date: string;
      totalProducts: number;
      totalVariants: number;
    }> | null;
  } | null;

  /**
   * ─────────────────────────────────────────
   * Layer 2 — OPERATIONAL RISK (Flow & Control)
   * ─────────────────────────────────────────
   */

  operationalRisk: {
    /** Inventory visibility */
    productsWithConfirmedStockCount: number | null;
    totalProducts: number | null;

    /** Demand vs stock pressure */
    productsWhereSalesExceedStockCount: number | null;

    /** Change impact / dependency surface */
    averageSystemsTouchedPerProduct: number | null;
    productsTouchingMultipleSystemsCount: number | null;
  } | null;

  /**
   * ─────────────────────────────────────────
   * Layer 3 — ECONOMIC BLIND SPOTS (Money)
   * ─────────────────────────────────────────
   */

  economicBlindSpots: {
    /** Cost coverage */
    productsWithCostCount: number | null;
    productsWithoutCostCount: number | null;

    /** Price vs cost movement */
    priceVsCostTrend: Array<{
      date: string;
      averagePrice: number | null;
      averageCost: number | null;
    }> | null;

    /** Revenue vs profit attribution */
    revenueVsProfit: Array<{
      productId: string;
      revenue: number;
      profit: number | null;
    }> | null;
  } | null;
}

/**
 * ProductsModuleFT2Props
 * ----------------------
 * FULL render contract.
 *
 * - Extends data props
 * - Visuals injected
 */
export type ProductsModuleFT2Props = ProductsModuleFT2DataProps;

export default function ProductsModuleFT2(
  props: ProductsModuleFT2Props
) {
  const {
    context,
    outcome,
    trend,
    dataGaps,
    operationalRisk,
    economicBlindSpots,
  } = props;

  return (
    <FT2Layout>
      {/* ───────── Layer 0 — Context & Trust / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Period">
          {context.period.from} → {context.period.to}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Products observed">
          {context.productsObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Overall status">
          {outcome?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Trend">
          {trend?.direction ?? '—'}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 1 — DATA GAPS (Truth & Consistency) ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Product data consistency">
          <div>
            Products with conflicts:{' '}
            {dataGaps?.productsWithConflictingDataCount ?? '—'}
          </div>
          <div>
            Products checked:{' '}
            {dataGaps?.totalProductsChecked ?? '—'}
          </div>
        </FT2Surface>

        <FT2Surface title="Duplicate products">
          <div>
            Products with multiple SKUs:{' '}
            {dataGaps?.productsWithMultipleSkusCount ?? '—'}
          </div>
          <div>
            Max SKUs per product:{' '}
            {dataGaps?.maxSkusPerProduct ?? '—'}
          </div>
        </FT2Surface>

        <FT2Surface title="Variant growth">
          {dataGaps?.variantGrowth ? (
            <div>
              Data points: {dataGaps.variantGrowth.length}
            </div>
          ) : (
            '—'
          )}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 2 — OPERATIONAL RISK (Flow & Control) ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Stock visibility">
          <div>
            Products with confirmed stock:{' '}
            {operationalRisk?.productsWithConfirmedStockCount ?? '—'}
          </div>
          <div>
            Total products:{' '}
            {operationalRisk?.totalProducts ?? '—'}
          </div>
        </FT2Surface>

        <FT2Surface title="Demand vs stock">
          <div>
            Products where sales exceed stock:{' '}
            {operationalRisk?.productsWhereSalesExceedStockCount ?? '—'}
          </div>
        </FT2Surface>

        <FT2Surface title="Change impact">
          <div>
            Avg systems per product:{' '}
            {operationalRisk?.averageSystemsTouchedPerProduct ?? '—'}
          </div>
          <div>
            Products touching multiple systems:{' '}
            {operationalRisk?.productsTouchingMultipleSystemsCount ?? '—'}
          </div>
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 3 — ECONOMIC BLIND SPOTS (Money) ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Cost coverage">
          <div>
            Products with cost:{' '}
            {economicBlindSpots?.productsWithCostCount ?? '—'}
          </div>
          <div>
            Products without cost:{' '}
            {economicBlindSpots?.productsWithoutCostCount ?? '—'}
          </div>
        </FT2Surface>

        <FT2Surface title="Price vs cost">
          {economicBlindSpots?.priceVsCostTrend ? (
            <div>
              Data points:{' '}
              {economicBlindSpots.priceVsCostTrend.length}
            </div>
          ) : (
            '—'
          )}
        </FT2Surface>

        <FT2Surface title="Revenue vs profit">
          {economicBlindSpots?.revenueVsProfit ? (
            <div>
              Products with revenue data:{' '}
              {economicBlindSpots.revenueVsProfit.length}
            </div>
          ) : (
            '—'
          )}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 4 — CNS Summary ───────── */}
      <FT2Row intent="support">
        <FT2Surface title="What stands out" span={2}>
          <ul>
            <li>Product data may differ across systems</li>
            <li>Some sales may occur without cost visibility</li>
            <li>Demand and stock visibility are not always aligned</li>
          </ul>
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}
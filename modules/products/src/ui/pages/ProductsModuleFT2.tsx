// modules/products/src/ui/pages/ProductsModuleFT2.tsx
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
  FT2Stat,
  FT2Ratio,
  FT2DualTimeSeries,
  FT2Distribution,
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

  /**
   * FT2-Paid — Product Data Integrity
   *
   * Null when:
   * - truth is unknown
   * - downgraded by policy
   */
  productDataIntegrity: {
    integrity: 'ok' | 'attention' | 'unknown';
    duplication: 'present' | 'absent' | 'unknown';
  } | null;

/**
 * ─────────────────────────────────────────
 * Operational Exposure (FT2)
 * ─────────────────────────────────────────
 */
  operational: {
    inventory: 'ok' | 'gaps' | 'unknown';
    fulfillment: 'visible' | 'missing' | 'unknown';
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;

  /**
   * ─────────────────────────────────────────
   * Supply & Replenishment Observability (FT2)
   * ─────────────────────────────────────────
   */
  supply: {
    replenishment: 'observable' | 'missing' | 'unknown';
    coverage: 'complete' | 'partial' | 'missing' | 'unknown';
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
    operational,
    operationalRisk,
    economicBlindSpots,
    productDataIntegrity,
    supply,
  } = props;

  return (
    <FT2Layout>
      {/* ─────────────────────────────────────────
      * Layer A — Existence & Trust (Conversion Spine)
      * ───────────────────────────────────────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Products detected">
          <FT2Stat value={context.productsObserved} />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Structural integrity">
          <div>
            Integrity:{' '}
            {productDataIntegrity
              ? productDataIntegrity.integrity
              : '—'}
          </div>
          <div>
            Duplication:{' '}
            {productDataIntegrity
              ? productDataIntegrity.duplication
              : '—'}
          </div>
        </FT2Surface>

        <FT2Surface variant="kpi" title="Inventory visibility">
          <FT2Stat value={operational?.inventory ?? null} />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Fulfillment visibility">
          <FT2Stat value={operational?.fulfillment ?? null} />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Operational stability">
          <FT2Stat value={operational?.stability ?? null} />
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
      * Layer A.5 — Supply & Replenishment Observability
      * ───────────────────────────────────────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Replenishment signals">
          <FT2Stat value={supply?.replenishment ?? null} />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Supply signal coverage">
          <FT2Stat value={supply?.coverage ?? null} />
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
      * Layer B — Data Consistency & Gaps
      * ───────────────────────────────────────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Consistent product data">
          {dataGaps?.totalProductsChecked === 0 ? (
            '—'
          ) : (
            <FT2Ratio
              numerator={dataGaps?.productsWithConflictingDataCount ?? null}
              denominator={dataGaps?.totalProductsChecked ?? null}
            />
          )}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Duplicate SKU representations">
          <div>
            Products:{' '}
            {dataGaps?.productsWithMultipleSkusCount ?? '—'}
          </div>
          <div>
            Max SKUs:{' '}
            {dataGaps?.maxSkusPerProduct ?? '—'}
          </div>
        </FT2Surface>

        <FT2Surface variant="kpi" title="Variant growth">
          {dataGaps?.variantGrowth
            ? `Points: ${dataGaps.variantGrowth.length}`
            : '—'}
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
      * Layer C — Operational Observability (Counts only)
      * ───────────────────────────────────────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Stock confirmation coverage">
          {operationalRisk?.totalProducts === 0 ? (
            '—'
          ) : (
            <FT2Ratio
              numerator={
                operationalRisk?.productsWithConfirmedStockCount ?? null
              }
              denominator={operationalRisk?.totalProducts ?? null}
            />
          )}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Oversold products detected">
          <FT2Stat
            value={
              operationalRisk?.productsWhereSalesExceedStockCount ?? null
            }
          />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Systems touched (avg)">
          <FT2Stat
            value={
              operationalRisk?.averageSystemsTouchedPerProduct ?? null
            }
          />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Multi-system products">
          <FT2Stat
            value={
              operationalRisk?.productsTouchingMultipleSystemsCount ?? null
            }
          />
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
      * Layer D — Economic Observability (No optimization)
      * ───────────────────────────────────────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Cost coverage">
          {economicBlindSpots &&
          (economicBlindSpots.productsWithCostCount ?? 0) +
            (economicBlindSpots.productsWithoutCostCount ?? 0) === 0 ? (
            '—'
          ) : (
            <FT2Ratio
              numerator={
                economicBlindSpots?.productsWithCostCount ?? null
              }
              denominator={
                economicBlindSpots
                  ? (economicBlindSpots.productsWithCostCount ?? 0) +
                    (economicBlindSpots.productsWithoutCostCount ?? 0)
                  : null
              }
            />
          )}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Price vs cost signals">
          <FT2DualTimeSeries
            left={
              economicBlindSpots?.priceVsCostTrend
                ? economicBlindSpots.priceVsCostTrend.map(p => ({
                    date: p.date,
                    value: p.averagePrice,
                  }))
                : null
            }
            right={
              economicBlindSpots?.priceVsCostTrend
                ? economicBlindSpots.priceVsCostTrend.map(p => ({
                    date: p.date,
                    value: p.averageCost,
                  }))
                : null
            }
          />
        </FT2Surface>

        <FT2Surface variant="kpi" title="Revenue vs profit spread">
          <FT2Distribution
            buckets={
              economicBlindSpots?.revenueVsProfit
                ? economicBlindSpots.revenueVsProfit.map(p => ({
                    key: p.productId,
                    value: p.profit,
                  }))
                : null
            }
          />
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}
// modules/products/src/ui/pages/ProductsModuleFT2.tsx
//
// ─────────────────────────────────────────────────────────────────────────────
// ProductsModuleFT2
// ─────────────────────────────────────────────────────────────────────────────
//
// WHAT (Offering)
// ---------------
// Products FT2 is a **pre-intelligence observability surface**.
// It renders *raw, non-interpretive product facts* for a given period.
//
// It answers ONE question only:
//   → “What product data exists, and is it changing over time?”
//
//
// WHAT IT IS NOT
// --------------
// - ❌ NOT product health
// - ❌ NOT SKU prioritization
// - ❌ NOT risk, pressure, dominance, or confidence reasoning
// - ❌ NOT recommendations or actions
//
// All intelligence, “why”, and prioritization belongs to **SKU-OS / FT3+**
// (see docs/blueprints-and-contracts/skuOs-contract).
//
//
// WHY THIS EXISTS (Doctrine)
// --------------------------
// FT2 must remain:
// - Read-only
// - Shape-stable
// - Boring
// - Deterministic
//
// This module is intentionally underpowered to prevent intelligence leakage
// and long-term semantic drift.
//
//
// WHO OWNS WHAT
// -------------
// - Backend: decides meaning (later, in SKU-OS / FT3+)
// - Adapter: dumb pipe (undefined → null)
// - This module: render facts only
//
//
// WHEN THIS CHANGES
// -----------------
// Any addition that explains *why*, *risk*, or *what to do*:
// → ❌ Illegal in FT2
// → Must be deferred to SKU-OS or a higher phase
//
// ─────────────────────────────────────────────────────────────────────────────

import React from 'react';

/**
 * ProductsModuleFT2Props
 * ---------------------
 * Canonical FT2 contract for Products.
 *
 * Design rules:
 * - All top-level props are mandatory
 * - Uncertainty is expressed as `null`
 * - No field may imply intelligence or prioritization
 */
export interface ProductsModuleFT2Props {
  /**
   * Context = scope only
   */
  context: {
    period: {
      from: string;
      to: string;
    };

    /**
     * Number of products observed in this period.
     * Renamed from `productsAnalyzed` to avoid inference.
     */
    productsObserved: number | null;
  };

  /**
   * Raw, observed aggregates.
   * No evaluation, no judgment.
   */
  productSummary: {
    totalRevenue: number | null;
    totalCost: number | null;

    /**
     * Net value as reported (not “contribution”).
     * Renamed to avoid implying goodness or performance.
     */
    netValue: number | null;

    currency: string | null;
  };

  /**
   * Optional raw per-SKU exposure.
   * No ranking, no highlighting, no importance implied.
   */
  productBreakdown:
    | Array<{
        sku: string;
        revenue: number | null;
        cost: number | null;

        /**
         * Margin percentage as reported upstream.
         * Explicitly *reported*, not evaluated.
         */
        marginReportedPct: number | null;
      }>
    | null;

  /**
   * Direction-only trend signal.
   * No magnitude, no cause, no explanation.
   */
  trendSignal: {
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
}

export default function ProductsModuleFT2(
  props: ProductsModuleFT2Props
) {
  const {
    context,
    productSummary,
    productBreakdown,
    trendSignal,
  } = props;

  // Instrumentation: FT2 observability only
  console.debug(
    '[FT2][Products][ProductsModuleFT2] props',
    props
  );

  return (
    <section data-testid="products-ft2-root">
      {/* ───────────────── Context ───────────────── */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} →{' '}
          {context.period.to}
        </div>
        <div>
          <strong>Products observed</strong>:{' '}
          {context.productsObserved === null
            ? '—'
            : context.productsObserved}
        </div>
      </section>

      {/* ──────────────── Product Summary ──────────────── */}
      <section>
        <div>
          <strong>Total revenue</strong>:{' '}
          {productSummary.totalRevenue === null
            ? '—'
            : `${productSummary.totalRevenue} ${
                productSummary.currency ?? ''
              }`}
        </div>
        <div>
          <strong>Total cost</strong>:{' '}
          {productSummary.totalCost === null
            ? '—'
            : `${productSummary.totalCost} ${
                productSummary.currency ?? ''
              }`}
        </div>
        <div>
          <strong>Net value</strong>:{' '}
          {productSummary.netValue === null
            ? '—'
            : `${productSummary.netValue} ${
                productSummary.currency ?? ''
              }`}
        </div>
      </section>

      {/* ──────────────── Product Breakdown ──────────────── */}
      <section>
        <strong>Product breakdown</strong>
        {productBreakdown === null ||
        productBreakdown.length === 0 ? (
          <div>—</div>
        ) : (
          <ul>
            {productBreakdown.map((p, idx) => (
              <li key={idx}>
                {p.sku} ·{' '}
                {p.revenue === null ? '—' : p.revenue} /{' '}
                {p.cost === null ? '—' : p.cost} ·{' '}
                {p.marginReportedPct === null
                  ? '—'
                  : `${p.marginReportedPct}%`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ───────────────── Trend Signal ───────────────── */}
      <section>
        <strong>Trend</strong>:{' '}
        {trendSignal === null ? '—' : trendSignal.trend}
      </section>
    </section>
  );
}
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
// All intelligence, “why”, and prioritization belongs to **SKU-OS+**
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
// - Backend: decides meaning (later, in SKU-OS)
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
  context: {
    period: {
      from: string;
      to: string;
    };
    productsObserved: number | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;
}

export default function ProductsModuleFT2(
  props: ProductsModuleFT2Props
) {
  const { context, outcome, trend } = props;

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

      <section>
        <strong>Outcome</strong>:{' '}
        {outcome === null ? '—' : outcome.status}
      </section>

      <section>
        <strong>Trend</strong>:{' '}
        {trend === null ? '—' : trend.direction}
      </section>
    </section>
  );
}
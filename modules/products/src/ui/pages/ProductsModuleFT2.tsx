// modules/products/src/ui/pages/ProductsModuleFT2.tsx

import React from 'react';

export interface ProductsModuleFT2Props {
  context: {
    period: {
      from: string;
      to: string;
    };
    productsAnalyzed: number | null;
  };

  productSummary: {
    totalRevenue: number | null;
    totalCost: number | null;
    netContribution: number | null;
    currency: string | null;
  };

  productBreakdown: Array<{
    sku: string;
    revenue: number | null;
    cost: number | null;
    marginPct: number | null;
  }> | null;

  dominantProductPressure: {
    sku: string;
    pressureType:
      | 'loss'
      | 'low-margin'
      | 'overhead-heavy'
      | 'unknown';
    confidence: 'high' | 'medium' | 'low';
  } | null;

  timeSignal: {
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
    dominantProductPressure,
    timeSignal,
  } = props;

  console.debug(
    '[FT2][Products][ProductsModuleFT2] props',
    props
  );

  return (
    <section data-testid="products-ft2-root">
      {/* Context */}
      <section>
        <div>
          <strong>Period</strong>: {context.period.from} →{' '}
          {context.period.to}
        </div>
        <div>
          <strong>Products analyzed</strong>:{' '}
          {context.productsAnalyzed === null
            ? '—'
            : context.productsAnalyzed}
        </div>
      </section>

      {/* Product Summary */}
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
          <strong>Net contribution</strong>:{' '}
          {productSummary.netContribution === null
            ? '—'
            : `${productSummary.netContribution} ${
                productSummary.currency ?? ''
              }`}
        </div>
      </section>

      {/* Product Breakdown */}
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
                {p.marginPct === null
                  ? '—'
                  : `${p.marginPct}%`}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Dominant Product Pressure */}
      <section>
        <strong>Dominant product pressure</strong>
        {dominantProductPressure === null ? (
          <div>—</div>
        ) : (
          <div>
            {dominantProductPressure.sku} ·{' '}
            {dominantProductPressure.pressureType} ·{' '}
            {dominantProductPressure.confidence}
          </div>
        )}
      </section>

      {/* Time Signal */}
      <section>
        <strong>Trend</strong>:{' '}
        {timeSignal === null ? '—' : timeSignal.trend}
      </section>
    </section>
  );
}
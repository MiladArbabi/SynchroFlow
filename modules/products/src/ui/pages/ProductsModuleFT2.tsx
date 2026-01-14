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
 * - Raw product observability facts only
 * - No inference
 * - No prioritization
 */
export interface ProductsModuleFT2DataProps {
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

  signals: {
    catalog: 'ok' | 'attention' | 'unknown';
    skuCoverage: 'ok' | 'gaps' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';
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
    signals,
  } = props;

  return (
    <FT2Layout>
      {/* ───────── Layer 1 — Snapshot / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Period">
          {context.period.from} → {context.period.to}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Products observed">
          {context.productsObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Outcome">
          {outcome?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Trend">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Catalog">
          {signals?.catalog ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="SKU coverage">
          {signals?.skuCoverage ?? '—'}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 2 — Analytical ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Product activity over time">
          {/* TODO CHART/GRAPH*/}
        </FT2Surface>

        <FT2Surface title="Product distribution">
          {/* TODO CHART/GRAPH */}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 3 — Support ───────── */}
      <FT2Row intent="support">
        <FT2Surface title="Trend summary">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Outcome">
          {outcome?.status ?? '—'}
        </FT2Surface>
    
        <FT2Surface variant="kpi" title="Data status">
          —
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}
// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx

import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
  FT2_TOKENS,
} from '@lasyncro/ui-ft2';

/**
 * OrdersModuleFT2DataProps
 * -----------------------
 * DATA-ONLY FT2 contract.
 *
 * - Used by frontend adapters
 * - No React nodes
 * - No UI composition
 */

export interface OrdersModuleFT2DataProps {
  context: {
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: { status: 'positive' | 'negative' } | null;
  trend: { direction: 'up' | 'down' | 'flat' } | null;

  dataCoverage: {
    completenessPct: number | null;
  };

  visibility: {
    status: 'sufficient' | 'insufficient';
  } | null;

  alignment: {
    demandReality?: 'aligned' | 'divergent' | 'unknown';
    engagementRevenue?: 'aligned' | 'divergent' | 'unknown';
    operationalEconomic?: 'aligned' | 'divergent' | 'unknown';
  } | null;
}

/**
 * OrdersModuleFT2Props
 * -------------------
 * FULL render contract.
 *
 * - Used ONLY by OrdersModuleFT2 component
 * - Extends data props
 * - Adds visual slots
 */
export interface OrdersModuleFT2Props extends OrdersModuleFT2DataProps {
  timeseries: ReactNode;
  distribution: ReactNode;
}

export default function OrdersModuleFT2(props: OrdersModuleFT2Props) {
  const {
    context,
    totals,
    outcome,
    trend,
    dataCoverage,
    timeseries,
    distribution,
    visibility,
    alignment,
  } = props;

  return (
    <FT2Layout>
      {/* ───────── Layer 1 — Snapshot / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Orders received">
          {context.ordersObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Cost visibility">
          {dataCoverage.completenessPct === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </FT2Surface>
         <FT2Surface variant="kpi" title="Sales value">
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal} ${totals.currency ?? ''}`}
        </FT2Surface>

        <FT2Surface title="Economic visibility">
          {visibility?.status ?? '—'}
        </FT2Surface>

         {/* ─── Insights / Ops / Attention ─── */}
          <FT2Surface
            title="Insights"
            span={2}
          >
            {/* TODO placeholder – will evolve */}
            <div>• Revenue volatility detected</div>
            <div>• Data coverage below 90%</div>
            <div>• Cost signal delayed</div>
          </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 2 — Analytical ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Orders over time">
          {timeseries}
        </FT2Surface>

        <FT2Surface title="Typical order sizes">
          {distribution}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 3 — Support ───────── */}
      <FT2Row intent="support">

        <FT2Surface title="Direction">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Order costs">
          {totals.costTotal === null
            ? '—'
            : `${totals.costTotal} ${totals.currency ?? ''}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Overall result">
          {outcome?.status ?? '—'}
        </FT2Surface>

        <FT2Surface title="Cross-domain alignment">
          <div>Demand ↔ Orders: {alignment?.demandReality ?? '—'}</div>
          <div>Engagement ↔ Revenue: {alignment?.engagementRevenue ?? '—'}</div>
          <div>Operations ↔ Economics: {alignment?.operationalEconomic ?? '—'}</div>
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}

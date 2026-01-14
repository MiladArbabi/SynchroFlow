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
    period: {
      from: string;
      to: string;
    };
    ordersObserved: number | null;
  };

  totals: {
    revenueTotal: number | null;
    costTotal: number | null;
    currency: string | null;
  };

  outcome: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage: {
    completenessPct: number | null;
  };
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
  } = props;

  return (
    <FT2Layout>
      {/* ───────── Layer 1 — Snapshot / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Period">
          {context.period.from} → {context.period.to}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Orders observed">
          {context.ordersObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Data coverage">
          {dataCoverage.completenessPct === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </FT2Surface>
         <FT2Surface variant="kpi" title="Revenue">
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal} ${totals.currency ?? ''}`}
        </FT2Surface>

         <FT2Surface variant="kpi" title="TODO">
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal} ${totals.currency ?? ''}`}
        </FT2Surface>
        <FT2Surface variant="kpi" title="TODO">
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal} ${totals.currency ?? ''}`}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 2 — Analytical ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface
          title="Order activity over time"
        >
          {timeseries}
        </FT2Surface>

        <FT2Surface title="Order value distribution">
          {distribution}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 3 — Support ───────── */}
      <FT2Row intent="support">

        <FT2Surface title="Trend">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Cost">
          {totals.costTotal === null
            ? '—'
            : `${totals.costTotal} ${totals.currency ?? ''}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Outcome">
          {outcome?.status ?? '—'}
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}

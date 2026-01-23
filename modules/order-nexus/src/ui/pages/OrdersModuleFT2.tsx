// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

/**
 * OrdersModuleFT2DataProps
 * -----------------------
 * DATA-ONLY FT2 contract.
 * No semantics. No inference.
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
};

/**
 * OrdersModuleFT2Props
 * -------------------
 * Rendering contract.
 * Slots only. No logic.
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
    visibility,
    alignment,
    timeseries,
    distribution,
  } = props;

  return (
    <FT2Layout>

      {/* ─────────────────────────────────────────
         Layer 1 — Domain Snapshot (L1)
         Presence & magnitude only
      ───────────────────────────────────────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Orders observed">
          {context.ordersObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Revenue total">
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal} ${totals.currency ?? ''}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Cost total">
          {totals.costTotal === null
            ? '—'
            : `${totals.costTotal} ${totals.currency ?? ''}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Data coverage">
          {dataCoverage.completenessPct === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </FT2Surface>

        <FT2Surface title="Economic visibility">
          {visibility?.status ?? '—'}
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
         Layer 2 — Domain Shape (L1½)
         No interpretation
      ───────────────────────────────────────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Orders over time">
          {timeseries}
        </FT2Surface>

        <FT2Surface title="Order size distribution">
          {distribution}
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
         Layer 3 — Directional Reality (Support)
         Still factual, no semantics
      ───────────────────────────────────────── */}
      <FT2Row intent="support">
        <FT2Surface title="Trend direction">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface title="Outcome">
          {outcome?.status ?? '—'}
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
         Layer 4 — Cross-Domain Alignment
         Structural agreement only
      ───────────────────────────────────────── */}
      <FT2Row intent="support">
        <FT2Surface title="Demand ↔ Orders">
          {alignment?.demandReality ?? '—'}
        </FT2Surface>

        <FT2Surface title="Engagement ↔ Revenue">
          {alignment?.engagementRevenue ?? '—'}
        </FT2Surface>

        <FT2Surface title="Operations ↔ Economics">
          {alignment?.operationalEconomic ?? '—'}
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
         Layer 5 — Ops / Insights Placeholder
         Reserved. Non-authoritative.
      ───────────────────────────────────────── */}
      <FT2Row intent="support">
        <FT2Surface title="Operational notices">
          —
        </FT2Surface>
      </FT2Row>

    </FT2Layout>
  );
}

// modules/order-nexus/src/ui/pages/OrdersModuleFT2.tsx
import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';
/**
 * UI INVARIANTS (FT2)
 * ------------------
 * - All values render with equal visual weight
 * - No colors, icons, or emphasis convey meaning
 * - `—` represents epistemic absence everywhere
 * - Rows do not collapse when data is missing
 * - This module reveals truth; it does not guide
 */

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
        <FT2Surface variant="kpi" title="Orders">
          {context.ordersObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Revenue">
          {totals.revenueTotal === null
            ? '—'
            : `${totals.revenueTotal.toLocaleString()}${totals.currency ? ` ${totals.currency}` : ''}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Costs">
          {totals.costTotal === null
            ? '—'
            : `${totals.costTotal.toLocaleString()} ${totals.currency ?? ''}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Data coverage">
          {dataCoverage.completenessPct === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Data visibility">
          {visibility?.status ?? '—'}
        </FT2Surface>

        <FT2Surface title="Order trend">
          {trend?.direction ?? '—'}
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

        <FT2Surface title="Order sizes">
          {distribution}
        </FT2Surface>
      </FT2Row>

      {/* ─────────────────────────────────────────
         Layer 4 — Cross-Domain Alignment
         Structural agreement only
      ───────────────────────────────────────── */}
      <FT2Row intent="support">
        <FT2Surface title="Demand vs orders">
          {alignment?.demandReality ?? '—'}
        </FT2Surface>

        <FT2Surface title="Engagement vs revenue">
          {alignment?.engagementRevenue ?? '—'}
        </FT2Surface>

        <FT2Surface title="Operations vs revenue">
          {alignment?.operationalEconomic ?? '—'}
        </FT2Surface>
      </FT2Row>

    </FT2Layout>
  );
}

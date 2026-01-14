// modules/finances/src/ui/pages/FinancesModuleFT2.tsx

import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

/**
 * FinancesModuleFT2DataProps
 * -------------------------
 * DATA-ONLY FT2 contract.
 *
 * - Observability only
 * - No inference
 * - Uncertainty expressed via null
 */
export interface FinancesModuleFT2DataProps {
  context: {
    period:
      | {
          from: string;
          to: string;
        }
      | null;
    revenueObserved: number | null;
    netObserved: number | null;
  };

  outcome:
    | {
        status: 'positive' | 'negative' | 'unknown';
      }
    | null;

  trend:
    | {
        direction: 'up' | 'down' | 'flat' | 'unknown';
      }
    | null;

  dataCoverage:
    | {
        completenessPct: number | null;
      }
    | null;
}

/**
 * FinancesModuleFT2Props
 * ---------------------
 * FULL render contract.
 *
 * - Extends data props
 * - Visuals injected
 */
export type FinancesModuleFT2Props =
  FinancesModuleFT2DataProps;

export default function FinancesModuleFT2(
  props: FinancesModuleFT2Props
) {
  const {
    context,
    outcome,
    trend,
    dataCoverage,
  } = props;

  return (
    <FT2Layout>
      {/* ───────── Layer 1 — Snapshot / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Period">
          {context.period === null
            ? '—'
            : `${context.period.from} → ${context.period.to}`}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Revenue observed">
          {context.revenueObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Net observed">
          {context.netObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Outcome">
          {outcome?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Trend">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Data coverage">
          {dataCoverage?.completenessPct === null ||
          dataCoverage === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 2 — Analytical ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Financial activity over time">
          {/* TODO CHART */}
        </FT2Surface>

        <FT2Surface title="Financial distribution">
         {/* TODO CHART */}
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

        <FT2Surface variant="kpi" title="Coverage status">
          {dataCoverage?.completenessPct === null ||
          dataCoverage === null
            ? '—'
            : `${dataCoverage.completenessPct}%`}
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}

// modules/customers/src/ui/pages/CustomersModuleFT2.tsx

import React, { ReactNode } from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

/**
 * CustomersModuleFT2DataProps
 * ---------------------------
 * DATA-ONLY FT2 contract.
 *
 * - Observability facts only
 * - No inference
 * - No React nodes
 */
export interface CustomersModuleFT2DataProps {
  context: {
    period: {
      from: string;
      to: string;
    };
    sessionsObserved: number | null;
  };

  systemState: {
    status: 'healthy' | 'degraded' | 'partial' | 'unknown';
    confidence: 'high' | 'medium' | 'low';
    reason?: string;
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

/**
 * CustomersModuleFT2Props
 * -----------------------
 * FULL render contract.
 *
 * - Extends data props
 * - Visuals are injected
 */
export interface CustomersModuleFT2Props
  extends CustomersModuleFT2DataProps {
  timeline: ReactNode;
  distribution: ReactNode;
}

export default function CustomersModuleFT2(
  props: CustomersModuleFT2Props
) {
  const {
    context,
    systemState,
    timeSignal,
    timeline,
    distribution,
  } = props;

  return (
    <FT2Layout>
      {/* ───────── Layer 1 — Snapshot / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Period">
          {context.period.from} → {context.period.to}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Sessions observed">
          {context.sessionsObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="System status">
          {systemState?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Confidence">
          {systemState?.confidence ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Trend">
          {timeSignal?.trend ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Compared period">
          {timeSignal?.comparedPeriod
            ? `${timeSignal.comparedPeriod.from} → ${timeSignal.comparedPeriod.to}`
            : '—'}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 2 — Analytical ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Session activity over time">
          {timeline}
        </FT2Surface>

        <FT2Surface title="Session distribution">
          {distribution}
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 3 — Support ───────── */}
      <FT2Row intent="support">
        <FT2Surface title="System state reason">
          {systemState?.reason ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="State">
          {systemState?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Confidence level">
          {systemState?.confidence ?? '—'}
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
}
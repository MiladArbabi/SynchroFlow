import React from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

import type {
  AnalyticsModuleFT2Props,
} from './AnalyticsModuleFT2.types';

export default function AnalyticsModuleFT2(
  props: AnalyticsModuleFT2Props
) {
  const {
    context,
    outcome,
    trend,
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

        <FT2Surface variant="kpi" title="Outcome">
          {outcome?.status ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Trend">
          {trend?.direction ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="TODO" />
        <FT2Surface variant="kpi" title="TODO" />
        <FT2Surface variant="kpi" title="TODO" />
      </FT2Row>

      {/* ───────── Layer 2 — Analytical ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="Analytics activity over time">
          {timeline}
        </FT2Surface>

        <FT2Surface title="Analytics distribution">
          {distribution}
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
// apps/frontend/src/pages/DashboardFT2Page.tsx

import React from 'react';
import {
  FT2Layout,
  FT2Row,
  FT2Surface,
} from '@lasyncro/ui-ft2';

import { useDashboardFt2Snapshot } from 'pages/dashboard-ft2/useDashboardFt2Snapshot';
import { mapDashboardFt2Snapshot } from 'pages/dashboard-ft2/useDashboardFt2Adapter';

const DashboardFT2Page: React.FC = () => {
  const { data, isLoading } = useDashboardFt2Snapshot();

  if (isLoading) {
    return <div>Loading</div>;
  }

  // 🔒 HARD RULE: snapshot must always pass through adapter
  const mapped = mapDashboardFt2Snapshot(data);

  return (
    <FT2Layout>
      {/* ───────── Layer 1 — Snapshot / KPIs ───────── */}
      <FT2Row intent="kpi">
        <FT2Surface variant="kpi" title="Observation from">
          {mapped.observationWindow?.from ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Observation to">
          {mapped.observationWindow?.to ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Orders outcome">
          {mapped.systemHealth?.ordersOutcome ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Products outcome">
          {mapped.systemHealth?.productsOutcome ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="TODO" />
        <FT2Surface variant="kpi" title="TODO" />
      </FT2Row>

      {/* ───────── Layer 2 — Analytical (reserved) ───────── */}
      <FT2Row intent="analysis">
        <FT2Surface title="System activity over time">
          —
        </FT2Surface>

        <FT2Surface title="System distribution">
          —
        </FT2Surface>
      </FT2Row>

      {/* ───────── Layer 3 — Support ───────── */}
      <FT2Row intent="support">
        <FT2Surface title="Orders observed">
          {mapped.coverage?.ordersObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Products observed">
          {mapped.coverage?.productsObserved ?? '—'}
        </FT2Surface>

        <FT2Surface variant="kpi" title="Sessions observed">
          {mapped.coverage?.sessionsObserved ?? '—'}
        </FT2Surface>
      </FT2Row>
    </FT2Layout>
  );
};

export default DashboardFT2Page;

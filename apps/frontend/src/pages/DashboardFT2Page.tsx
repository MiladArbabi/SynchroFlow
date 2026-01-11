// apps/frontend/src/pages/DashboardFT2Page.tsx
//
// DashboardFT2Page
// ----------------
// FT2-only dashboard surface.
//
// HARD CONTRACT:
// - MUST render FT2 observability surfaces only
// - MUST NOT render FT1 modules or onboarding CTAs
// - MUST NOT read lifecycle state
// - MUST assume FT2 routing is authoritative
//
// NOTE:
// This is intentionally a skeleton.
// FT2 dashboard composition will be added later.

import React from 'react';
import { useDashboardFt2Snapshot } from 'pages/dashboard-ft2/useDashboardFt2Snapshot';
import { mapDashboardFt2Snapshot } from 'pages/dashboard-ft2/useDashboardFt2Adapter';

const __DEV__ = import.meta.env.DEV;

const DashboardFT2Page: React.FC = () => {
  if (__DEV__) {
    console.debug('[MOUNT] DashboardFT2Page');
  }

  const { data, isLoading } = useDashboardFt2Snapshot();

  if (isLoading) {
    return <div>Loading</div>;
  }

  // 🔒 HARD RULE: snapshot must always pass through adapter
  const mapped = mapDashboardFt2Snapshot(data);

    return (
    <div>
      <h2>System Overview</h2>

      <div>
        <strong>Observation window</strong>
        <div>{mapped.observationWindow?.from ?? '—'}</div>
        <div>{mapped.observationWindow?.to ?? '—'}</div>
      </div>

     {/* ───────────────────────────────────────────── */}
      <h2>System Health</h2>

      <div>
        <strong>Orders outcome</strong>
        <div>{mapped.systemHealth?.ordersOutcome ?? '—'}</div>
      </div>

      <div>
        <strong>Products outcome</strong>
        <div>{mapped.systemHealth?.productsOutcome ?? '—'}</div>
      </div>

      {/* ───────────────────────────────────────────── */}
      <h2>Coverage</h2>

      <div>
        <strong>Orders observed</strong>
        <div>{mapped.coverage?.ordersObserved ?? '—'}</div>
      </div>

      <div>
        <strong>Products observed</strong>
        <div>{mapped.coverage?.productsObserved ?? '—'}</div>
      </div>

      <div>
        <strong>Sessions observed</strong>
        <div>{mapped.coverage?.sessionsObserved ?? '—'}</div>
      </div>
    </div>
  );
};

export default DashboardFT2Page;
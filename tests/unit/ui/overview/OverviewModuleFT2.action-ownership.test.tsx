// tests/unit/ui/overview/OverviewModuleFT2.action-ownership.test.tsx
//
// UX-OWNERSHIP-01 — status-only ownership contract.
//
// Ratified UX ownership: Ops Console is the cross-domain ACTION owner.
// Overview is STATUS / situational awareness only.
//   - Morning Brief signals supplied to the module never surface as
//     per-signal remediation CTAs or remediation navigation;
//   - Overview renders no "Open Ops Console" controls; global top-nav
//     Ops Console is the sole entry point.
//
// OVERVIEW-SCREEN-OPT-01 (Slice A): the retired fallback-triage and
// Business Pulse renderers are gone; retired-surface absence is owned by
// OverviewModuleFT2.ov-v1-operations-pulse.test.tsx (A). Both remaining
// states — map layout and pulse-only (no mapContent) — are covered here.
//
// Imports the module directly from source (as OverviewModuleFT2.test.tsx
// already does) rather than through the @lasyncro/overview package alias, to
// avoid unrelated shared-ui ESM resolution debt.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import OverviewModuleFT2, {
  type OverviewModuleFT2Props,
} from '../../../../modules/overview/src/ui/pages/OverviewModuleFT2';

const FORBIDDEN_ROUTES = [
  '/overview?resolution=address',
  '/orders/flow?urgency=sla_breach',
  '/demand?filter=critical',
];

function baseProps(): OverviewModuleFT2Props {
  return {
    trust: null,
    context: { ordersObserved: 10, productsObserved: 5, customersObserved: 3 },
    snapshot: { orders: null, products: null, customers: null },
    alignment: null,
    operationalWarningState: 'warning',
    pulse: {
      revenueToday: 1000,
      revenueDeltaVsYesterday: 0,
      atRiskRevenue: 200,
      blockedRevenue: 100,
      topBlockingType: null,
    },
    morningBrief: {
      signals: [
        {
          id: 'address',
          priority: 1,
          title: '2 orders with address issues',
          detail: 'Address problems are blocking fulfillment.',
          module: 'overview',
          deepLink: FORBIDDEN_ROUTES[0],
          revenueImpact: 900,
          alertType: 'customer',
          ageLabel: '14d oldest',
          actionLabel: 'Fix addresses',
        },
        {
          id: 'sla',
          priority: 1,
          title: 'SLA breaches',
          detail: 'Orders are past SLA.',
          module: 'order-nexus',
          deepLink: FORBIDDEN_ROUTES[1],
          revenueImpact: 200,
          alertType: 'sla_breach',
          actionLabel: 'Fulfil orders',
        },
        {
          id: 'reorder',
          priority: 3,
          title: '3 SKUs below reorder point',
          detail: 'Demand is outpacing stock.',
          module: 'demand',
          deepLink: FORBIDDEN_ROUTES[2],
          revenueImpact: 300,
          alertType: 'revenue_at_risk',
          ageLabel: '6 orders',
          actionLabel: 'Reorder now',
        },
      ],
      hasUrgentIssues: true,
      generatedAt: '2026-09-10T00:00:00.000Z',
      trustWarning: false,
      greeting: null,
      summaryLine: null,
    },
    operationsPulse: {
      orders: { readyCount: 8, blockedCount: 9, blockedRevenue: 1250, pastSlaCount: 27, pastSlaRevenue: 5400 },
      fulfillment: { activeBatchCount: 3, pickingBatchCount: 2, packingBatchCount: 1 },
      inventory: { awaitingInventoryCount: 2, awaitingInventoryRevenue: 600 },
      inbound: { receiveAtDockUnits: 5, awaitingStowUnits: 12 },
    },
  };
}

const LAYOUTS = [
  ['map layout', true],
  ['pulse-only state (no mapContent)', false],
] as const;

function renderOverview(map: boolean, onNavigate = jest.fn()) {
  render(
    <OverviewModuleFT2
      {...baseProps()}
      onNavigate={onNavigate}
      mapContent={map ? <div data-testid="map-slot" /> : undefined}
    />
  );
  return { onNavigate };
}

// ─── 1 — SIGNALS OWN NO REMEDIATION ─────────────────────────────────────────

describe('UX-OWNERSHIP-01 (1): Morning Brief signals never become remediation CTAs or navigation', () => {
  it.each(LAYOUTS)('%s: renders no per-signal CTA and no control reaches a remediation route', (_label, map) => {
    const { onNavigate } = renderOverview(map);

    expect(screen.queryByRole('button', { name: 'Fix addresses' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fulfil orders' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reorder now' })).not.toBeInTheDocument();

    for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
      fireEvent.click(control);
    }

    for (const route of FORBIDDEN_ROUTES) {
      expect(onNavigate).not.toHaveBeenCalledWith(route);
    }
  });
});

// ─── 2 — NO OVERVIEW OPS CONSOLE CTA ────────────────────────────────────────

describe('UX-OWNERSHIP-01 (2): Overview owns no Ops Console entry point', () => {
  it.each(LAYOUTS)('%s: renders zero Open Ops Console controls', (_label, map) => {
    renderOverview(map);

    if (map) expect(screen.getByTestId('map-slot')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /operations pulse/i })).toBeInTheDocument();
    expect(screen.queryAllByText(/Open Ops Console/i)).toHaveLength(0);
  });
});

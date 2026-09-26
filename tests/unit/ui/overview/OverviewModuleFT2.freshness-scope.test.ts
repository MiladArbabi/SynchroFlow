// tests/unit/ui/overview/OverviewModuleFT2.freshness-scope.test.ts
//
// OV-DATA-02B → OV-V1-0 — Morning Brief freshness scope (behavioural).
//
// Overview is composed from independently evaluated sources.
// morningBrief.generatedAt describes ONLY the Morning Brief. It must never
// masquerade as freshness of the Operations Pulse, whose values come from
// live/structured sources with their own cadence.
//
// OV-V1-0 supersession: the former contract source-scanned the retired
// MergedPulseCard / Needs-a-Decision / Business Pulse structure. Those
// surfaces no longer exist in v1, so the invariant is now proven by
// rendering, scoped to the Operations pulse region:
//   - no "Brief updated" freshness line inside the region;
//   - no "Refresh morning brief" control inside the region;
//   - the brief's generatedAt time is not shown inside the region.
//
// Kept as .ts (its established path) — elements are built with
// React.createElement instead of JSX.

import React from 'react';
import { render, screen, within } from '@testing-library/react';
import OverviewModuleFT2, {
  type OverviewModuleFT2Props,
} from '../../../../modules/overview/src/ui/pages/OverviewModuleFT2';

const GENERATED_AT = '2026-09-10T07:43:00.000Z';

// Same structured shape as OverviewModuleFT2.ov-v1-operations-pulse.test.tsx.
const OPERATIONS_PULSE = {
  orders: { readyCount: 8, blockedCount: 9, blockedRevenue: 1250, pastSlaCount: 27, pastSlaRevenue: 5400 },
  fulfillment: { activeBatchCount: 3, pickingBatchCount: 2, packingBatchCount: 1 },
  inventory: { awaitingInventoryCount: 2, awaitingInventoryRevenue: 600 },
  inbound: { receiveAtDockUnits: 5, awaitingStowUnits: 12 },
};

function props(): OverviewModuleFT2Props {
  return {
    trust: null,
    context: { ordersObserved: 10, productsObserved: 5, customersObserved: 3 },
    snapshot: { orders: null, products: null, customers: null },
    alignment: null,
    operationalWarningState: 'clear',
    currency: 'USD',
    pulse: null,
    morningBrief: {
      signals: [],
      hasUrgentIssues: false,
      generatedAt: GENERATED_AT,
      trustWarning: false,
      greeting: null,
      summaryLine: null,
    },
    onRefreshBrief: jest.fn(),
    operationsPulse: OPERATIONS_PULSE,
  };
}

const LAYOUTS = [
  ['map layout', true],
  ['pulse-only state (no mapContent)', false],
] as const;

describe('OV-V1-0: Morning Brief freshness does not masquerade as Operations Pulse freshness', () => {
  it.each(LAYOUTS)('%s: Operations pulse carries no brief freshness line, refresh control or brief timestamp', (_label, map) => {
    render(
      React.createElement(OverviewModuleFT2, {
        ...props(),
        mapContent: map ? React.createElement('div', { 'data-testid': 'map-slot' }) : undefined,
      })
    );

    const pulse = screen.getByRole('region', { name: /operations pulse/i });

    expect(within(pulse).queryByText(/Brief updated/i)).not.toBeInTheDocument();
    expect(within(pulse).queryByText(/Updating brief/i)).not.toBeInTheDocument();
    expect(
      within(pulse).queryByRole('button', { name: /Refresh morning brief/i })
    ).not.toBeInTheDocument();

    // The brief's generatedAt, formatted the way the module formats it today,
    // must not appear as a Pulse timestamp.
    const briefTime = new Date(GENERATED_AT).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(pulse.textContent ?? '').not.toContain(briefTime);
  });
});

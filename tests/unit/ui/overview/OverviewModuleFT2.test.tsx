// Overview Live Intelligence teaser parity.
//
// Retained invariant: the shared synthetic LiveMapTeaser (the real component
// used for gated tenants) still renders in Overview's map slot.
//
// OV-V1-0: the retired-surface absence checks formerly here ("Needs a
// decision", Business pulse, "Revenue today", "Ranked by commercial
// consequence") are owned canonically, in both layouts, by
// OverviewModuleFT2.ov-v1-operations-pulse.test.tsx (A), and were removed
// here as duplicates.
import React from 'react';
import { render, screen } from '@testing-library/react';
import OverviewModuleFT2, { type OverviewModuleFT2Props } from '../../../../modules/overview/src/ui/pages/OverviewModuleFT2';
import { LiveMapTeaser } from '../../../../apps/frontend/src/components/LiveMapTeaser';

const props: OverviewModuleFT2Props = {
  trust: null,
  context: { ordersObserved: 10, productsObserved: 5, customersObserved: 3 },
  snapshot: { orders: null, products: null, customers: null },
  alignment: null,
  operationalWarningState: 'warning',
  pulse: { revenueToday: 1000, revenueDeltaVsYesterday: 0, atRiskRevenue: 200, blockedRevenue: 100, topBlockingType: null },
  morningBrief: {
    signals: [{ id: 'blocked', priority: 2, title: '10 orders blocked', detail: 'Resolve each blocker.', module: 'orders', deepLink: '/orders/flow', revenueImpact: 100 }],
    hasUrgentIssues: true,
    generatedAt: '2026-09-10T00:00:00.000Z',
    trustWarning: false,
    greeting: null,
    summaryLine: null,
  },
};

describe('Overview Live Intelligence teaser parity', () => {
  it('renders the shared synthetic map teaser in the map slot', () => {
    render(<OverviewModuleFT2 {...props} mapContent={<LiveMapTeaser title="Overview live map" description="Preview" requiredTier="growth" onUpgrade={() => {}} />} />);

    expect(screen.getByText('Overview live map')).toBeInTheDocument();
  });
});

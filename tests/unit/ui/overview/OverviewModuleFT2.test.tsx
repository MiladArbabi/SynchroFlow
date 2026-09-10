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
  it('keeps real decisions and Business pulse beside the shared synthetic map teaser', () => {
    render(<OverviewModuleFT2 {...props} mapContent={<LiveMapTeaser title="Overview live map" description="Preview" requiredTier="growth" onUpgrade={() => {}} />} />);

    expect(screen.getByText('Overview live map')).toBeInTheDocument();
    expect(screen.getByText('Needs a decision')).toBeInTheDocument();
    expect(screen.getByText('10 orders blocked')).toBeInTheDocument();
    expect(screen.getByText('Business pulse')).toBeInTheDocument();
    expect(screen.getByText('Revenue today')).toBeInTheDocument();
    expect(screen.queryByText('Ranked by commercial consequence')).toBeNull();
  });

  it('preserves triage-first compatibility when mapContent is absent', () => {
    render(<OverviewModuleFT2 {...props} />);

    expect(screen.getByText('Ranked by commercial consequence')).toBeInTheDocument();
    expect(screen.getByText('10 orders blocked')).toBeInTheDocument();
    expect(screen.getByText('Business pulse')).toBeInTheDocument();
  });
});

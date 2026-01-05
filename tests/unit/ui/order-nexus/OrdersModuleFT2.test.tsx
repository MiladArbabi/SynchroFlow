// tests/unit/ui/order-nexus/OrdersModuleFT2.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

describe('OrdersModuleFT2 (FT2)', () => {
  const fullProps = {
    context: {
      period: {
        from: '2025-01-01',
        to: '2025-01-31',
      },
      ordersAnalyzed: 120,
    },
    marginSummary: {
      avgMarginPct: 18.4,
      lossRatePct: 22.1,
      totalLossAmount: 4200,
      currency: 'USD',
    },
    lossDrivers: [
      {
        type: 'shipping',
        contributionPct: 46,
        confidence: 'high',
      },
    ],
    patterns: [
      {
        description: 'International orders with expedited shipping',
        affectedOrdersPct: 31,
        estimatedImpact: 1800,
        currency: 'USD',
      },
    ],
    timeSignal: {
      trend: 'deteriorating',
      comparedPeriod: {
        from: '2024-12-01',
        to: '2024-12-31',
      },
    },
  };

  it('renders deterministically with full FT2 props', () => {
    render(<OrdersModuleFT2 {...fullProps} />);
    expect(screen.getByTestId('orders-ft2-root')).toBeInTheDocument();
  });

  it('renders safely when optional blocks are null', () => {
    render(
      <OrdersModuleFT2
        context={{
          period: { from: '2025-01-01', to: '2025-01-31' },
          ordersAnalyzed: null,
        }}
        marginSummary={{
          avgMarginPct: null,
          lossRatePct: null,
          totalLossAmount: null,
          currency: null,
        }}
        lossDrivers={null}
        patterns={null}
        timeSignal={null}
      />
    );

    expect(screen.getByTestId('orders-ft2-root')).toBeInTheDocument();
  });

  it('does not render any CTAs or action language', () => {
    render(<OrdersModuleFT2 {...fullProps} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/fix|review|optimize|improve/i)).toBeNull();
  });

  it('does not leak FT1 scenario language', () => {
    render(<OrdersModuleFT2 {...fullProps} />);
    expect(
      screen.queryByText(/healthy|uncertain|no orders|loss detected/i)
    ).toBeNull();
  });

  it('matches snapshot (structure only)', () => {
    const { container } = render(<OrdersModuleFT2 {...fullProps} />);
    expect(container).toMatchSnapshot();
  });
});

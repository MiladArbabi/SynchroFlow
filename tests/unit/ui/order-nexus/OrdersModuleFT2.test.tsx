// tests/unit/ui/order-nexus/OrdersModuleFT2.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import { OrdersModuleFT2 } from '@lasyncro/order-nexus';

describe('OrdersModuleFT2 (FT2 — observability only)', () => {
  const fullProps = {
    context: {
      period: {
        from: '2025-01-01',
        to: '2025-01-31',
      },
      ordersObserved: 120,
    },

    totals: {
      revenueTotal: 18500,
      costTotal: 14300,
      currency: 'USD',
    },

    outcome: {
      status: 'negative',
    },

    trend: {
      direction: 'down',
    },

    dataCoverage: {
      completenessPct: 82,
    },
  } as const satisfies React.ComponentProps<typeof OrdersModuleFT2>;

  it('renders deterministically with full FT2 observability props', () => {
    render(<OrdersModuleFT2 {...fullProps} />);
    expect(screen.getByTestId('orders-ft2-root')).toBeInTheDocument();
  });

  it('renders safely when nullable blocks are null', () => {
    render(
      <OrdersModuleFT2
        context={{
          period: { from: '2025-01-01', to: '2025-01-31' },
          ordersObserved: null,
        }}
        totals={{
          revenueTotal: null,
          costTotal: null,
          currency: null,
        }}
        outcome={null}
        trend={null}
        dataCoverage={{
          completenessPct: null,
        }}
      />
    );

    expect(screen.getByTestId('orders-ft2-root')).toBeInTheDocument();
    expect(
      screen.getByTestId('orders-ft2-root').textContent
    ).toContain('—');
  });

  it('does not render intelligence, causation, or explanation language', () => {
    render(<OrdersModuleFT2 {...fullProps} />);

    expect(
      screen.queryByText(
        /margin|loss rate|drivers|patterns|why|cause|optimi|improv/i
      )
    ).toBeNull();
  });

  it('does not render CTAs or action affordances', () => {
    render(<OrdersModuleFT2 {...fullProps} />);

    expect(screen.queryByRole('button')).toBeNull();
    expect(
      screen.queryByText(/fix|review|optimize|improve|act/i)
    ).toBeNull();
  });

  it('matches snapshot (structure only, no intelligence)', () => {
    const { container } = render(<OrdersModuleFT2 {...fullProps} />);
    expect(container).toMatchSnapshot();
  });
});
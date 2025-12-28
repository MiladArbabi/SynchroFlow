// tests/unit/ui/order-nexus/OrderNexusAhaPanel.test.tsx

import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { OrderNexusAhaPanel } from '@lasyncro/order-nexus';

describe('OrderNexusAhaPanel — FT1 Aha Moment', () => {
  it('renders the diagnostic headline and summary', () => {
    renderWithTheme(
      <OrderNexusAhaPanel
        summary={{
          hasRisk: true,
          riskCount: 2,
          severity: 'high',
        }}
        onIntent={jest.fn()}
      />
    );

    expect(
      screen.getByRole('heading', { name: /order profitability risk/i })
    ).toBeInTheDocument();

    expect(
      screen.getByText(/2 orders may be losing money/i)
    ).toBeInTheDocument();
  });

  it('renders a primary CTA to fix the issue', () => {
    renderWithTheme(
      <OrderNexusAhaPanel
        summary={{
          hasRisk: true,
          riskCount: 1,
          severity: 'medium',
        }}
        onIntent={jest.fn()}
      />
    );

    expect(
      screen.getByRole('button', { name: /fix this/i })
    ).toBeInTheDocument();
  });

  it('emits START_ONBOARDING intent when CTA is clicked', () => {
    const onIntent = jest.fn();

    renderWithTheme(
      <OrderNexusAhaPanel
        summary={{
          hasRisk: true,
          riskCount: 3,
          severity: 'high',
        }}
        onIntent={onIntent}
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: /fix this/i })
    );

    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith({
      type: 'START_ONBOARDING',
    });
  });

  it('renders nothing when there is no risk', () => {
    renderWithTheme(
      <OrderNexusAhaPanel
        summary={{
          hasRisk: false,
          riskCount: 0,
          severity: 'low',
        }}
        onIntent={jest.fn()}
      />
    );

    expect(
      screen.queryByTestId('order-nexus-aha-panel')
    ).not.toBeInTheDocument();
  });
});

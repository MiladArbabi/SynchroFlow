// tests/unit/ui/ft2/OrdersFT2Page.dateRange.presetAuthority.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';
import OrdersFT2Page from 'pages/OrdersFT2Page';

// ─────────────────────────────────────────────
// Global spies (jest-safe, no closure leaks)
// ─────────────────────────────────────────────

beforeEach(() => {
  (globalThis as any).__snapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__snapshotSpy;
});

// ─────────────────────────────────────────────
// Snapshot hook mock
// ─────────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

jest.mock('pages/orders/useOrdersFt2Snapshot', () => ({
  useOrdersFt2Snapshot: (range: any) => {
    (globalThis as any).__snapshotSpy(range);

    return {
      isSuccess: true,
      data: {
        context: {
          period: { from: '', to: '' },
          ordersObserved: 10,
        },
        totals: {
          revenueTotal: 100,
          costTotal: 50,
          currency: 'USD',
        },
        outcome: { status: 'positive' },
        trend: { direction: 'up' },
        dataCoverage: { completenessPct: 95 },
      },
    };
  },
}));

// Silence non-relevant hooks
jest.mock('pages/orders/useOrdersFt2Timeseries', () => ({
  useOrdersFt2Timeseries: () => ({ data: null }),
}));

jest.mock('pages/orders/useOrdersFt2Distribution', () => ({
  useOrdersFt2Distribution: () => ({ data: null }),
}));

jest.mock('widgets/orders/OrdersTimeseriesWidget', () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock('widgets/orders/OrdersDistributionWidget', () => ({
  __esModule: true,
  default: () => <div />,
}));

// ─────────────────────────────────────────────
// TEST
// ─────────────────────────────────────────────

describe('OrdersFT2Page — preset authority (RED)', () => {
  it('emits semantic preset only (from/to must be null)', async () => {
    const user = userEvent.setup();

    renderWithProviders(<OrdersFT2Page />);

    // Initial render
    expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(1);

    const initialRange =
      (globalThis as any).__snapshotSpy.mock.calls[0][0];

    // 🔴 CRITICAL INVARIANT
    expect(initialRange).toEqual(
      expect.objectContaining({
        preset: 'past_7_days',
        from: null,
        to: null,
      })
    );

    // Change preset
    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Today'));

    expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(2);

    const nextRange =
      (globalThis as any).__snapshotSpy.mock.calls[1][0];

    // 🔴 MUST remain semantic
    expect(nextRange).toEqual(
      expect.objectContaining({
        preset: 'today',
        from: null,
        to: null,
      })
    );
  });
});
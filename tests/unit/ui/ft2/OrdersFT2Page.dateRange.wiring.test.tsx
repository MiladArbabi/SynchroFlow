// tests/unit/ui/ft2/OrdersFT2Page.dateRange.wiring.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';

import OrdersFT2Page from 'pages/OrdersFT2Page';

// ─────────────────────────────────────────────
// Hook spies (frontend adapter boundary)
// ─────────────────────────────────────────────

const snapshotSpy = jest.fn();
const timeseriesSpy = jest.fn();
const distributionSpy = jest.fn();

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
          period: { from: range.from, to: range.to },
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

jest.mock('pages/orders/useOrdersFt2Timeseries', () => ({
  useOrdersFt2Timeseries: (range: any) => {
    (globalThis as any).__timeseriesSpy(range);
    return { data: [] };
  },
}));

jest.mock('pages/orders/useOrdersFt2Distribution', () => ({
  useOrdersFt2Distribution: (range: any) => {
    (globalThis as any).__distributionSpy(range);
    return { data: [] };
  },
}));

jest.mock('widgets/orders/OrdersDistributionWidget', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-orders-distribution" />,
}));

jest.mock('widgets/orders/OrdersTimeseriesWidget', () => ({
  __esModule: true,
  default: () => <div data-testid="mock-orders-timeseries" />,
}));

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────

describe('OrdersFT2Page — FT2DateRange wiring (RED)', () => {
  // ─────────────────────────────────────────────
// Global spies (Jest-safe)
// ─────────────────────────────────────────────

beforeEach(() => {
  (globalThis as any).__snapshotSpy = jest.fn();
  (globalThis as any).__timeseriesSpy = jest.fn();
  (globalThis as any).__distributionSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__snapshotSpy;
  delete (globalThis as any).__timeseriesSpy;
  delete (globalThis as any).__distributionSpy;
});

  it('wires FT2DateRangeBar to all FT2 hooks and re-fetches on change', async () => {
    const user = userEvent.setup();

    renderWithProviders(<OrdersFT2Page />);

    // ── 1. Date range bar must exist ──
    expect(
      screen.getByText('Past 7 days')
    ).toBeInTheDocument();

    // ── 2. Initial render wires range into all hooks ──
    expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(1);
    expect((globalThis as any).__timeseriesSpy).toHaveBeenCalledTimes(1);
    expect((globalThis as any).__distributionSpy).toHaveBeenCalledTimes(1);

    const initialRange =
        (globalThis as any).__snapshotSpy.mock.calls[0][0];

    expect(initialRange).toMatchObject({
      preset: 'past_7_days',
      from: expect.any(String),
      to: expect.any(String),
    });

    // ── 3. Change the date range ──
    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Today'));

    // ── 4. Hooks must re-run with a NEW range ──
    expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(2);
    expect((globalThis as any).__timeseriesSpy).toHaveBeenCalledTimes(2);
    expect((globalThis as any).__distributionSpy).toHaveBeenCalledTimes(2);

    const nextRange = (globalThis as any).__snapshotSpy.mock.calls[1][0];

    expect(nextRange).toMatchObject({
      preset: 'today',
      from: expect.any(String),
      to: expect.any(String),
    });

    // ── 5. Guardrail: range must actually change ──
    expect(nextRange.preset).not.toEqual(initialRange.preset);
  });
});
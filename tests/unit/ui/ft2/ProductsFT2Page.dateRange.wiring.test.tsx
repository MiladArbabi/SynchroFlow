// tests/unit/ui/ft2/ProductsFT2Page.dateRange.wiring.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';
import ProductsFT2Page from 'pages/ProductsFT2Page';

// ─────────────────────────────────────────────
// Global spies (Jest-safe, no closure leakage)
// ─────────────────────────────────────────────

beforeEach(() => {
  (globalThis as any).__productsSnapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__productsSnapshotSpy;
});

// ─────────────────────────────────────────────
// Hook mock (FT2 adapter boundary)
// ─────────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

jest.mock('pages/products/useProductsFt2Snapshot', () => ({
  useProductsFt2Snapshot: (range: any) => {
    (globalThis as any).__productsSnapshotSpy(range);
    return {
      isSuccess: true,
      data: {
        context: {
          period: {
            from: range?.from ?? '',
            to: range?.to ?? '',
          },
          productsObserved: 42,
        },
        outcome: { status: 'positive' },
        trend: { direction: 'up' },
        signals: {
          catalog: 'ok',
          skuCoverage: 'ok',
          variantComplexity: 'simple',
        },
      },
    };
  },
}));


// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────

describe('ProductsFT2Page — FT2DateRange wiring (RED)', () => {
  it('wires FT2DateRangeBar to snapshot hook and refetches on change', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProductsFT2Page />);

    // ── 1. Date range bar must exist ──
    expect(
      screen.getByText('Past 7 days')
    ).toBeInTheDocument();

    // ── 2. Initial render wires range into snapshot hook ──
    expect(
      (globalThis as any).__productsSnapshotSpy
    ).toHaveBeenCalledTimes(1);

    const initialRange =
      (globalThis as any).__productsSnapshotSpy.mock.calls[0][0];

    expect(initialRange).toMatchObject({
      preset: 'past_7_days',
      from: null,
      to: null,
    });

    // ── 3. Change the date range ──
    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Today'));

    // ── 4. Snapshot hook must re-run with new range ──
    expect(
      (globalThis as any).__productsSnapshotSpy
    ).toHaveBeenCalledTimes(2);

    const nextRange =
      (globalThis as any).__productsSnapshotSpy.mock.calls[1][0];

    expect(nextRange).toMatchObject({
      preset: 'today',
      from: null,
      to: null,
    });

    // ── 5. Guardrail: range must actually change ──
    expect(nextRange.preset).not.toEqual(initialRange.preset);
  });
});
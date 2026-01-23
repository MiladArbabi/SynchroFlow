// tests/unit/ui/ft2/ProductsFT2Page.dateRange.presetAuthority.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';
import ProductsFT2Page from 'pages/ProductsFT2Page';

// ─────────────────────────────────────────────
// Global spy (explicit, no jest hoisting traps)
// ─────────────────────────────────────────────
beforeEach(() => {
  (globalThis as any).__productsSnapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__productsSnapshotSpy;
});

// ─────────────────────────────────────────────
// Auth mock (FT2 requires auth boundary)
// ─────────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

// ─────────────────────────────────────────────
// Snapshot hook mock — authority inspection point
// ─────────────────────────────────────────────
jest.mock('pages/products/useProductsFt2Snapshot', () => ({
  useProductsFt2Snapshot: (range: any) => {
    (globalThis as any).__productsSnapshotSpy(range);

    return {
      isSuccess: true,
      data: {
        context: {
          period: {
            from: 'BACKEND_FROM',
            to: 'BACKEND_TO',
          },
          productsObserved: 10,
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

describe('ProductsFT2Page — FT2DateRange preset authority (RED)', () => {
  it('never leaks concrete dates into snapshot hook (preset-only authority)', async () => {
    const user = userEvent.setup();

    renderWithProviders(<ProductsFT2Page />);

    // ── 1. Initial render ──
    expect(
      (globalThis as any).__productsSnapshotSpy
    ).toHaveBeenCalledTimes(1);

    const initialRange =
      (globalThis as any).__productsSnapshotSpy.mock.calls[0][0];

    // ❌ This MUST FAIL until frontend is fixed
    expect(initialRange).toMatchObject({
      preset: 'past_30_days',
      from: null,
      to: null,
    });

    // ── 2. Change preset ──
    await user.click(screen.getByText('Past 7 days'));
    await user.click(screen.getByText('Today'));

    expect(
      (globalThis as any).__productsSnapshotSpy
    ).toHaveBeenCalledTimes(2);

    const nextRange =
      (globalThis as any).__productsSnapshotSpy.mock.calls[1][0];

    // ❌ Still must be preset-only
    expect(nextRange).toMatchObject({
      preset: 'today',
      from: null,
      to: null,
    });
  });
});
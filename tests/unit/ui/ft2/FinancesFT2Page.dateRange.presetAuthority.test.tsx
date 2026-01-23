// tests/unit/ui/ft2/FinancesFT2Page.dateRange.presetAuthority.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';
import FinancesFT2Page from 'pages/FinancesFT2Page';

// ─────────────────────────────────────────────
// Global spy (authority inspection point)
// ─────────────────────────────────────────────
beforeEach(() => {
  (globalThis as any).__financesSnapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__financesSnapshotSpy;
});

// ─────────────────────────────────────────────
// Auth mock
// ─────────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

// ─────────────────────────────────────────────
// Snapshot hook mock
// ─────────────────────────────────────────────
jest.mock('pages/finances/useFinancesFt2Snapshot', () => ({
  useFinancesFt2Snapshot: (range: any) => {
    (globalThis as any).__financesSnapshotSpy(range);

    return {
      isSuccess: true,
      data: {
        context: {
          period: {
            from: 'BACKEND_FROM',
            to: 'BACKEND_TO',
          },
          revenueObserved: 1200,
          netObserved: 800,
        },
        outcome: { status: 'positive' },
        trend: { direction: 'up' },
        dataCoverage: { completenessPct: 97 },
      },
    };
  },
}));

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
describe(
  'FinancesFT2Page — FT2DateRange preset authority (RED)',
  () => {
    it(
      'never leaks concrete dates into snapshot hook (preset-only authority)',
      async () => {
        const user = userEvent.setup();

        renderWithProviders(<FinancesFT2Page />);

        // ── 1. Initial render ──
        expect(
          (globalThis as any).__financesSnapshotSpy
        ).toHaveBeenCalledTimes(1);

        const initialRange =
          (globalThis as any).__financesSnapshotSpy
            .mock.calls[0][0];

        // ❌ MUST FAIL until frontend is fixed
        expect(initialRange).toMatchObject({
          preset: 'past_30_days',
          from: null,
          to: null,
        });

        // ── 2. Change preset ──
        await user.click(screen.getByText('Past 7 days'));
        await user.click(screen.getByText('Today'));

        expect(
          (globalThis as any).__financesSnapshotSpy
        ).toHaveBeenCalledTimes(2);

        const nextRange =
          (globalThis as any).__financesSnapshotSpy
            .mock.calls[1][0];

        // ❌ Still must be preset-only
        expect(nextRange).toMatchObject({
          preset: 'today',
          from: null,
          to: null,
        });
      }
    );
  }
);
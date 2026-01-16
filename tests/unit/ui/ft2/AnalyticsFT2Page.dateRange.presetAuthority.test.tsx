// tests/unit/ui/ft2/AnalyticsFT2Page.dateRange.presetAuthority.test.tsx

import React from 'react';
import { renderWithProviders } from 'test-utils';
import AnalyticsFT2Page from 'pages/AnalyticsFT2Page';

// ─────────────────────────────────────────────
// Global spies (Jest-safe)
// ─────────────────────────────────────────────
beforeEach(() => {
  (globalThis as any).__snapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__snapshotSpy;
});

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

jest.mock('pages/analytics/useAnalyticsFt2Snapshot', () => ({
  useAnalyticsFt2Snapshot: (range: any) => {
    (globalThis as any).__snapshotSpy(range);
    return {
      isSuccess: true,
      data: {
        context: {
          period: {
            from: 'BACKEND_FROM',
            to: 'BACKEND_TO',
          },
        },
        outcome: { status: 'positive' },
        trend: { direction: 'unknown' },
      },
    };
  },
}));

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
describe(
  'AnalyticsFT2Page — FT2DateRange preset authority',
  () => {
    it(
      'never leaks concrete dates into snapshot hook',
      () => {
        renderWithProviders(<AnalyticsFT2Page />);

        expect(
          (globalThis as any).__snapshotSpy
        ).toHaveBeenCalledTimes(1);

        const initialRange =
          (globalThis as any).__snapshotSpy
            .mock.calls[0][0];

        // 🔒 Hard authority lock
        expect(initialRange).toMatchObject({
          preset: 'past_7_days',
          from: null,
          to: null,
        });
      }
    );
  }
);
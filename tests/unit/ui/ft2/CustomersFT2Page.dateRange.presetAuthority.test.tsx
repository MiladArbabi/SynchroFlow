// tests/unit/ui/ft2/CustomersFT2Page.dateRange.presetAuthority.test.tsx
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';
import CustomersFT2Page from 'pages/CustomersFT2Page';

// ─────────────────────────────────────────────
// Global spy (authority inspection point)
// ─────────────────────────────────────────────
beforeEach(() => {
  (globalThis as any).__snapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__snapshotSpy;
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
jest.mock('pages/customers/useCustomersFt2Snapshot', () => ({
  useCustomersFt2Snapshot: (range: any) => {
    (globalThis as any).__snapshotSpy(range);

    return {
      isSuccess: true,
      data: {
        period: {
          from: 'BACKEND_FROM',
          to: 'BACKEND_TO',
        },
        sessionsObserved: 10,
        systemState: {
          status: 'healthy',
          confidence: 'high',
        },
        timeSignal: {
          trend: 'stable',
        },
      },
    };
  },
}));

// ─────────────────────────────────────────────
// Test
// ─────────────────────────────────────────────
describe(
  'CustomersFT2Page — FT2DateRange preset authority (RED)',
  () => {
    it('never leaks concrete dates into snapshot hook (preset-only authority)', async () => {
      const user = userEvent.setup();

      renderWithProviders(<CustomersFT2Page />);

      // ── 1. Initial render ──
      expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(1);

      const initialRange =
        (globalThis as any).__snapshotSpy.mock.calls[0][0];

      // ❌ MUST FAIL until frontend is fixed
      expect(initialRange).toMatchObject({
        preset: 'past_7_days',
        from: null,
        to: null,
      });

      // ── 2. Change preset ──
      await user.click(screen.getByText('Past 7 days'));
      await user.click(screen.getByText('Today'));

      expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(2);

      const nextRange =
        (globalThis as any).__snapshotSpy.mock.calls[1][0];

      // ❌ Still must be preset-only
      expect(nextRange).toMatchObject({
        preset: 'today',
        from: null,
        to: null,
      });
    });
  }
);
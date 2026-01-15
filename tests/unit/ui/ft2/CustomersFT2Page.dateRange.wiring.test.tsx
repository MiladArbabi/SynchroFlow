// tests/unit/ui/ft2/CustomersFT2Page.dateRange.wiring.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from 'test-utils';

import CustomersFT2Page from 'pages/CustomersFT2Page';

// ─────────────────────────────────────────────
// Global spies (Jest-safe, no closure leaks)
// ─────────────────────────────────────────────

beforeEach(() => {
  (globalThis as any).__snapshotSpy = jest.fn();
});

afterEach(() => {
  delete (globalThis as any).__snapshotSpy;
});

// ─────────────────────────────────────────────
// Hook mock (frontend adapter boundary)
// ─────────────────────────────────────────────
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 'test-user' },
    isAuthenticated: true,
    logout: jest.fn(),
  }),
}));

jest.mock('pages/customers/useCustomersFt2Snapshot', () => ({
  useCustomersFt2Snapshot: (range: any) => {
    (globalThis as any).__snapshotSpy(range);
    return {
      isSuccess: true,
      data: {
        context: {
          period: {
            from: range.from,
            to: range.to,
          },
          sessionsObserved: 42,
        },
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

describe('CustomersFT2Page — FT2DateRange wiring (RED)', () => {
  it('wires FT2DateRangeBar to snapshot hook and refetches on change', async () => {
    const user = userEvent.setup();

    renderWithProviders(<CustomersFT2Page />);

    // ── 1. Date range bar must exist ──
    expect(
      screen.getByText('Past 7 days')
    ).toBeInTheDocument();

    // ── 2. Initial render wires range into snapshot hook ──
    expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(1);

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

    // ── 4. Snapshot hook must re-run with new range ──
    expect((globalThis as any).__snapshotSpy).toHaveBeenCalledTimes(2);

    const nextRange =
      (globalThis as any).__snapshotSpy.mock.calls[1][0];

    expect(nextRange).toMatchObject({
      preset: 'today',
      from: expect.any(String),
      to: expect.any(String),
    });

    // ── 5. Guardrail: range must actually change ──
    expect(nextRange.preset).not.toEqual(initialRange.preset);
  });
});

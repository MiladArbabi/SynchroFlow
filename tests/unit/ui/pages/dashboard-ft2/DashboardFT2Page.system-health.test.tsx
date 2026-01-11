/**
 * @jest-environment jsdom
 */

import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import DashboardFT2Page from 'pages/DashboardFT2Page';

// ─────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────
jest.mock('pages/dashboard-ft2/useDashboardFt2Snapshot', () => ({
  useDashboardFt2Snapshot: () => ({
    isLoading: false,
    data: {
      observationWindow: {
        from: '2026-01-01T00:00:00.000Z',
        to: '2026-01-31T00:00:00.000Z',
      },
      coverage: {
        ordersObserved: 1,
        productsObserved: 17,
        sessionsObserved: null,
      },
      orders: {
        outcome: { status: 'positive' },
      },
      products: {
        outcome: { status: 'negative' },
      },
    },
  }),
}));

jest.mock('contexts/DashboardStateContext', () => ({
  DashboardStateProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe('DashboardFT2Page — System Health section', () => {
  it('renders orders and products outcomes verbatim', () => {
    renderWithProviders(<DashboardFT2Page />);

    // Section header
    expect(screen.getByText('System Health')).toBeInTheDocument();

    // Orders outcome
    expect(screen.getByText('Orders outcome')).toBeInTheDocument();
    expect(screen.getByText('positive')).toBeInTheDocument();

    // Products outcome
    expect(screen.getByText('Products outcome')).toBeInTheDocument();
    expect(screen.getByText('negative')).toBeInTheDocument();
  });
});
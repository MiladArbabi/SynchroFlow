import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';
import DashboardFT2Page from 'pages/DashboardFT2Page';

// HARD RULE TEST:
// FT2 Dashboard must render a loading state
// driven by a single snapshot hook.
// No FT1 UI, no modules, no inference.

jest.mock('pages/dashboard-ft2/useDashboardFt2Snapshot', () => ({
  useDashboardFt2Snapshot: () => ({
    data: null,
    isLoading: true,
    error: null,
  }),
}));

describe('DashboardFT2Page — loading state', () => {
  it('renders loading state when snapshot is loading', () => {
    renderWithTheme(<DashboardFT2Page />);

    // EXPECTATION:
    // This will FAIL until a loading surface exists.
    expect(
      screen.getByText(/loading/i)
    ).toBeInTheDocument();
  });
});
/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardFT2Page from 'pages/DashboardFT2Page';
import * as snapshotHook from 'pages/dashboard-ft2/useDashboardFt2Snapshot';
import * as adapter from 'pages/dashboard-ft2/useDashboardFt2Adapter';

jest.mock('pages/dashboard-ft2/useDashboardFt2Snapshot');
jest.mock('pages/dashboard-ft2/useDashboardFt2Adapter');

describe('DashboardFT2Page — wiring contract', () => {
  it('fetches snapshot and passes it through the adapter exactly once', () => {
    (snapshotHook.useDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      data: { raw: 'snapshot' },
      isLoading: false,
      error: null,
    });

    (adapter.mapDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      observationWindow: { from: null, to: null },
      coverage: {
        ordersObserved: null,
        productsObserved: null,
        sessionsObserved: null,
      },
      systemHealth: { ingestion: null, confidence: null },
    });

    render(<DashboardFT2Page />);

    expect(snapshotHook.useDashboardFt2Snapshot).toHaveBeenCalledTimes(1);
    expect(adapter.mapDashboardFt2Snapshot).toHaveBeenCalledTimes(1);
    expect(adapter.mapDashboardFt2Snapshot).toHaveBeenCalledWith({ raw: 'snapshot' });

    // Placeholder assertion — will evolve with UI
    expect(
      screen.queryByText(/unlock|setup|should/i)
    ).not.toBeInTheDocument();
  });
});
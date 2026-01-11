/**
 * @jest-environment jsdom
 */
import React from 'react';
import { render } from '@testing-library/react';
import DashboardFT2Page from 'pages/DashboardFT2Page';
import * as snapshotHook from 'pages/dashboard-ft2/useDashboardFt2Snapshot';
import * as adapter from 'pages/dashboard-ft2/useDashboardFt2Adapter';

jest.mock('pages/dashboard-ft2/useDashboardFt2Snapshot');
jest.mock('pages/dashboard-ft2/useDashboardFt2Adapter');

describe('DashboardFT2Page — null safety', () => {
  it('passes null snapshot through adapter without crashing', () => {
    (snapshotHook.useDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      data: null,
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

    expect(() => {
      render(<DashboardFT2Page />);
    }).not.toThrow();

    expect(adapter.mapDashboardFt2Snapshot).toHaveBeenCalledTimes(1);
    expect(adapter.mapDashboardFt2Snapshot).toHaveBeenCalledWith(null);
  });
});
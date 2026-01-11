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

describe('DashboardFT2Page — Coverage section', () => {
  it('renders coverage indicators from mapped snapshot', () => {
    (snapshotHook.useDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      data: { raw: 'snapshot' },
      isLoading: false,
      error: null,
    });

    (adapter.mapDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      observationWindow: null,
      systemHealth: null,
      coverage: {
        ordersObserved: 120,
        productsObserved: 45,
        sessionsObserved: null,
      },
    });

    render(<DashboardFT2Page />);

    // Section header
    expect(screen.getByText('Coverage')).toBeInTheDocument();

    // Orders
    expect(screen.getByText('Orders observed')).toBeInTheDocument();
    expect(screen.getByText('120')).toBeInTheDocument();

    // Products
    expect(screen.getByText('Products observed')).toBeInTheDocument();
    expect(screen.getByText('45')).toBeInTheDocument();

    // Sessions (null → —)
    expect(screen.getByText('Sessions observed')).toBeInTheDocument();
    const sessionsRow = screen
        .getByText('Sessions observed')
        .closest('div');

        expect(sessionsRow).toHaveTextContent('—');
  });
});
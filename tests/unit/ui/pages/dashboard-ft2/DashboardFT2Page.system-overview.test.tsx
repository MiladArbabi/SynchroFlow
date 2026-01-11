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

describe('DashboardFT2Page — System Overview section', () => {
  it('renders observation window and system health from mapped snapshot', () => {
    (snapshotHook.useDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      data: { raw: 'snapshot' },
      isLoading: false,
      error: null,
    });

    (adapter.mapDashboardFt2Snapshot as jest.Mock).mockReturnValue({
      observationWindow: {
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      },
      coverage: null,
      systemHealth: {
        ingestion: 'healthy',
        confidence: 'high',
      },
    });

    render(<DashboardFT2Page />);

    // Section header
    expect(screen.getByText('System Overview')).toBeInTheDocument();

    // Observation window
    expect(screen.getByText('Observation window')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01T00:00:00Z')).toBeInTheDocument();
    expect(screen.getByText('2026-01-31T23:59:59Z')).toBeInTheDocument();

    // System health
    expect(screen.getByText('Ingestion')).toBeInTheDocument();
    expect(screen.getByText('healthy')).toBeInTheDocument();

    expect(screen.getByText('Confidence')).toBeInTheDocument();
    expect(screen.getByText('high')).toBeInTheDocument();
  });
});
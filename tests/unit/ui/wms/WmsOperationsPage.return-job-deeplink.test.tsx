import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'owner' } }),
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
    refetch: jest.fn(),
    stowTasks: [],
    settings: null,
    openReceiveJobs: [],
    recountTasks: [],
    recountLocked: false,
  }),
}));

jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({ data: { locations: [] } }),
}));

jest.mock('@lasyncro/wms', () => {
  const React = require('react');

  function WmsModuleFT2Stub({
    pendingReturnJobId,
    pendingReceiveSession,
  }: {
    pendingReturnJobId?: string | null;
    pendingReceiveSession?: Record<string, unknown> | null;
  }) {
    return (
      <>
        <div data-testid="wms-return-job">
          {pendingReturnJobId ?? 'none'}
        </div>
        <div data-testid="wms-receive-session">
          {pendingReceiveSession ? JSON.stringify(pendingReceiveSession) : 'none'}
        </div>
      </>
    );
  }

  return {
    WmsModuleFT2: WmsModuleFT2Stub,
    useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
    useWebPush: jest.fn(),
    WmsConnectionBadge: () => null,
  };
});

describe('WmsOperationsPage return-job deep link', () => {
  it('passes returnJobId from the URL into the existing WMS return-session seam', () => {
    render(
      <MemoryRouter initialEntries={['/wms?returnJobId=return-job-1']}>
        <Routes>
          <Route path="/wms" element={<WmsOperationsPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('wms-return-job')).toHaveTextContent('return-job-1');
  });
});

describe('WmsOperationsPage receive-job deep link', () => {
  it('maps canonical receive completion evidence into the pending session seam', async () => {
    const getMock = axiosInstance.get as jest.Mock;

    getMock.mockResolvedValueOnce({
      data: {
        job: {
          po_id: 'po-close-evidence',
          supplier_name: 'QA Supplier',
          closed_at: '2026-09-14T13:37:00.000Z',
          actual_delivery_date: '2026-09-14',
        },
        lines: [],
      },
    });

    render(
      <MemoryRouter initialEntries={['/wms?receiveJobId=receive-job-close-evidence']}>
        <Routes>
          <Route path="/wms" element={<WmsOperationsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('wms-receive-session')).toHaveTextContent(
        '"receiveJobId":"receive-job-close-evidence"'
      );
    });

    const session = screen.getByTestId('wms-receive-session');

    expect(session).toHaveTextContent('"closedAt":"2026-09-14T13:37:00.000Z"');
    expect(session).toHaveTextContent('"actualDeliveryDate":"2026-09-14"');

    expect(getMock).toHaveBeenCalledWith(
      '/api/v1/suppliers/receive-jobs/receive-job-close-evidence'
    );
  });
});

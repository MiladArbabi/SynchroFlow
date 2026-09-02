import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';

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

  function WmsModuleFT2Stub({ pendingReturnJobId }: { pendingReturnJobId?: string | null }) {
    return (
      <div data-testid="wms-return-job">
        {pendingReturnJobId ?? 'none'}
      </div>
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

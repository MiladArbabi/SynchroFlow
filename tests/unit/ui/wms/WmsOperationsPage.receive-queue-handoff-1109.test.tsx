import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';

const receiveJobs = [
  {
    receive_job_id: 'receive-self',
    status: 'pending',
    assigned_operator_id: 3,
    supplier_name: 'North Dock Supply',
    po_id: '550e8400-e29b-41d4-a716-446655440001',
    po_number: 1109,
    total_units: 8,
  },
];

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
    post: jest.fn(),
    patch: jest.fn(),
  },
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'operator' } }),
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
    openReceiveJobs: receiveJobs,
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
  function WmsModuleFT2Stub(props: {
    openReceiveJobs?: unknown[];
    openReceiveJobCount?: number;
  }) {
    return (
      <>
        <div data-testid="receive-array">
          {JSON.stringify(props.openReceiveJobs ?? null)}
        </div>
        <div data-testid="receive-count">
          {String(props.openReceiveJobCount ?? 'none')}
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

describe('GH-1109 — WmsOperationsPage Receive queue handoff', () => {
  it('passes the canonical openReceiveJobs array into WmsModuleFT2, not only its length', () => {
    render(
      <MemoryRouter initialEntries={['/wms']}>
        <Routes>
          <Route path="/wms" element={<WmsOperationsPage />} />
        </Routes>
      </MemoryRouter>
    );

    expect(screen.getByTestId('receive-array')).toHaveTextContent('receive-self');
    expect(screen.getByTestId('receive-array')).toHaveTextContent('North Dock Supply');
    expect(screen.getByTestId('receive-array')).toHaveTextContent('po_number');
    expect(screen.getByTestId('receive-array')).toHaveTextContent('1109');
    expect(screen.getByTestId('receive-count')).toHaveTextContent('1');
  });
});

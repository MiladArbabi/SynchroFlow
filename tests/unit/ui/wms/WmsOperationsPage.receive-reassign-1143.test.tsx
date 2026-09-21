// GH-1143 RECEIVE-REASSIGN-UI-01
//
// Adapter contract (explicitly given in the brief):
//   - Receive reassignment targets use GET /api/v1/operators/receive-assignees
//   - submit uses PATCH /api/v1/suppliers/receive-jobs/:jobId/assignment
//
// Prop names on WmsModuleFT2 (`onFetchReceiveAssignees`, `onReassignReceiveJob`)
// are this file's authoring assumption — see DEVIATIONS in the reporting
// brief — mirroring the existing onFetchStowAssignees/onAssignStowTask wiring
// pattern in this same adapter (WmsOperationsPage.tsx handleFetchStowAssignees /
// handleAssignStowTask, canAssignStow).
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

let capturedProps: any = null;

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

jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: true, isLoading: false, dismiss: jest.fn() }),
}));

jest.mock('@lasyncro/wms', () => {
  function WmsModuleFT2Stub(props: any) {
    capturedProps = props;
    return <div data-testid="wms-module-stub" />;
  }

  return {
    WmsModuleFT2: WmsModuleFT2Stub,
    useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
    useWebPush: jest.fn(),
    WmsConnectionBadge: () => null,
  };
});

const mockedAxios = axiosInstance as jest.Mocked<typeof axiosInstance>;

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/wms']}>
      <Routes>
        <Route path="/wms" element={<WmsOperationsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  capturedProps = null;
  mockedAxios.get.mockReset();
  mockedAxios.post.mockReset();
  mockedAxios.patch.mockReset();
});

describe('GH-1143 — WmsOperationsPage Receive reassignment adapter wiring', () => {
  it('wires a function prop for fetching Receive reassignment targets', () => {
    renderPage();
    expect(screen.getByTestId('wms-module-stub')).toBeInTheDocument();

    expect(typeof capturedProps.onFetchReceiveAssignees).toBe('function');
  });

  it('fetches Receive reassignment targets from GET /api/v1/operators/receive-assignees', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { operators: [{ user_id: 9, first_name: 'Sam', last_name: 'Rivera', role: 'operator' }] },
    } as any);

    renderPage();

    await capturedProps.onFetchReceiveAssignees();

    expect(mockedAxios.get).toHaveBeenCalledWith('/api/v1/operators/receive-assignees');
  });

  it('wires a function prop for submitting a Receive reassignment', () => {
    renderPage();
    expect(typeof capturedProps.onReassignReceiveJob).toBe('function');
  });

  it('submits reassignment via PATCH /api/v1/suppliers/receive-jobs/:jobId/assignment', async () => {
    mockedAxios.patch.mockResolvedValue({ data: {} } as any);

    renderPage();

    await capturedProps.onReassignReceiveJob('receive-job-123', 9);

    expect(mockedAxios.patch).toHaveBeenCalledWith(
      '/api/v1/suppliers/receive-jobs/receive-job-123/assignment',
      { assigned_operator_id: 9 }
    );
  });

  it('gates canReassignReceive to owner/admin the same way canAssignStow is gated', () => {
    renderPage();
    expect(capturedProps.canReassignReceive).toBe(true);
  });
});

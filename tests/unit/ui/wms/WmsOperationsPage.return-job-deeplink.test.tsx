import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// WMS-OPS-NEEDS-ATTENTION-01 — WmsOperationsPage passively reads the canonical
// alerts inbox (useAlerts); runtime owns QueryClientProvider. Each render gets a
// fresh, isolated client with the inbox seeded fresh, so no alerts request fires.
function alertsQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function AlertsQueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

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
  useSpotlight: () => ({ isDismissed: false, isLoading: false, dismiss: jest.fn() }),
}));

// GH-1245 — records every WmsModuleFT2 mount with the receive session it
// mounted with, so tests can prove the ordinary board never mounted first.
const mockModuleMounts: Array<{ pendingReceiveSession: Record<string, unknown> | null }> = [];

jest.mock('@lasyncro/wms', () => {
  const React = require('react');

  function WmsModuleFT2Stub({
    pendingReturnJobId,
    pendingReceiveSession,
    pendingCountTaskId,
    onSessionExit,
    onReceiveSessionEnter,
  }: {
    pendingReturnJobId?: string | null;
    pendingReceiveSession?: Record<string, unknown> | null;
    pendingCountTaskId?: string | null;
    onSessionExit?: () => void;
    onReceiveSessionEnter?: (id: string) => void;
  }) {
    React.useEffect(() => {
      mockModuleMounts.push({ pendingReceiveSession: pendingReceiveSession ?? null });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return (
      <div data-testid="wms-module">
        <div data-testid="wms-return-job">
          {pendingReturnJobId ?? 'none'}
        </div>
        <div data-testid="wms-count-task">
          {pendingCountTaskId ?? 'none'}
        </div>
        <div data-testid="wms-receive-session">
          {pendingReceiveSession ? JSON.stringify(pendingReceiveSession) : 'none'}
        </div>
        <button type="button" onClick={() => onSessionExit?.()}>stub exit session</button>
        <button type="button" onClick={() => onReceiveSessionEnter?.('receive-job-in-module')}>
          stub enter receive
        </button>
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
      </MemoryRouter>, { wrapper: alertsQueryWrapper() });

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
      </MemoryRouter>, { wrapper: alertsQueryWrapper() });

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

// ─── GH-1245 — Receive handoff must not paint the ordinary Operations board ───

type Deferred = { resolve: (value: unknown) => void; reject: (reason: unknown) => void };

const mockedGet = axiosInstance.get as jest.Mock;
const mockedPost = axiosInstance.post as jest.Mock;
const mockedPatch = axiosInstance.patch as jest.Mock;

function receiveJobResponse(poId: string) {
  return {
    data: {
      job: { po_id: poId, supplier_name: 'Nordic Textile Works', status: 'in_progress', assigned_operator_id: 3 },
      lines: [],
    },
  };
}

/** Routes receive-job GETs to per-job deferred promises; anything else resolves empty. */
function deferReceiveJobGets() {
  const pending: Record<string, Deferred[]> = {};
  mockedGet.mockImplementation((url: string) => {
    const match = /\/api\/v1\/suppliers\/receive-jobs\/([^/]+)$/.exec(url);
    if (!match) return Promise.resolve({ data: {} });
    return new Promise((resolve, reject) => {
      (pending[match[1]] ??= []).push({ resolve, reject });
    });
  });
  return {
    requests: (jobId: string) => pending[jobId]?.length ?? 0,
    settle: async (jobId: string, outcome: 'resolve' | 'reject', value?: unknown) => {
      const next = pending[jobId]?.shift();
      if (!next) throw new Error(`no pending receive-job request for ${jobId}`);
      await act(async () => {
        if (outcome === 'resolve') next.resolve(value);
        else next.reject(value ?? new Error('Network Error'));
      });
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location-search">{location.search}</div>
      <button type="button" onClick={() => navigate('/wms?receiveJobId=receive-job-B')}>
        probe go to job B
      </button>
    </>
  );
}

function renderWmsAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route
          path="/wms"
          element={
            <>
              <WmsOperationsPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
    { wrapper: alertsQueryWrapper() }
  );
}

function expectNoReceiveMutation() {
  expect(mockedPost).not.toHaveBeenCalled();
  expect(mockedPatch).not.toHaveBeenCalled();
}

describe('GH-1245 — Receive handoff hold at the WmsOperationsPage boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockModuleMounts.length = 0;
  });

  it('(H1) holds an unresolved receiveJobId: no Operations board, then mounts the requested session directly', async () => {
    const gets = deferReceiveJobGets();
    renderWmsAt('/wms?receiveJobId=receive-job-A');

    // First frame: neutral hold, ordinary board never mounted.
    expect(screen.queryByTestId('wms-module')).toBeNull();
    expect(mockModuleMounts).toHaveLength(0);
    expect(screen.getByText(/opening receive/i)).toBeInTheDocument();
    expect(gets.requests('receive-job-A')).toBe(1);

    await gets.settle('receive-job-A', 'resolve', receiveJobResponse('po-A'));

    await screen.findByTestId('wms-module');
    expect(mockModuleMounts).toHaveLength(1);
    expect(mockModuleMounts[0].pendingReceiveSession).toMatchObject({
      receiveJobId: 'receive-job-A',
      poId: 'po-A',
    });
    expect(screen.queryByText(/opening receive/i)).toBeNull();
    expectNoReceiveMutation();
  });

  it('(H2) /wms without receiveJobId renders ordinary Operations immediately', () => {
    deferReceiveJobGets();
    renderWmsAt('/wms');

    expect(screen.getByTestId('wms-module')).toBeInTheDocument();
    expect(screen.getByTestId('wms-receive-session')).toHaveTextContent('none');
    expect(screen.queryByText(/opening receive/i)).toBeNull();
    expect(mockedGet).not.toHaveBeenCalledWith(expect.stringMatching(/\/receive-jobs\//));
  });

  it('(H3) a failed fetch shows Retry, and Retry opens the requested session', async () => {
    const gets = deferReceiveJobGets();
    renderWmsAt('/wms?receiveJobId=receive-job-A');

    await gets.settle('receive-job-A', 'reject');

    expect(await screen.findByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /back to warehouse/i })).toBeInTheDocument();
    expect(screen.queryByText(/opening receive/i)).toBeNull();
    expect(screen.queryByTestId('wms-module')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByText(/opening receive/i)).toBeInTheDocument();
    await gets.settle('receive-job-A', 'resolve', receiveJobResponse('po-A'));

    await screen.findByTestId('wms-module');
    expect(mockModuleMounts).toHaveLength(1);
    expect(mockModuleMounts[0].pendingReceiveSession).toMatchObject({ receiveJobId: 'receive-job-A' });
    expectNoReceiveMutation();
  });

  it('(H4) a failed fetch offers Back to Warehouse, which clears receiveJobId and shows Operations', async () => {
    const gets = deferReceiveJobGets();
    renderWmsAt('/wms?receiveJobId=receive-job-A');

    await gets.settle('receive-job-A', 'reject');
    fireEvent.click(await screen.findByRole('button', { name: /back to warehouse/i }));

    await screen.findByTestId('wms-module');
    expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/);
    expect(screen.getByTestId('wms-receive-session')).toHaveTextContent('none');
    expectNoReceiveMutation();
  });

  it('(H5) a stale response for a previous job ID cannot open the wrong session', async () => {
    const gets = deferReceiveJobGets();
    renderWmsAt('/wms?receiveJobId=receive-job-A');

    fireEvent.click(screen.getByRole('button', { name: /probe go to job B/i }));
    await waitFor(() => expect(gets.requests('receive-job-B')).toBe(1));

    // A resolves late, after the destination changed to B.
    await gets.settle('receive-job-A', 'resolve', receiveJobResponse('po-A'));
    expect(screen.queryByTestId('wms-module')).toBeNull();
    expect(screen.getByText(/opening receive/i)).toBeInTheDocument();

    await gets.settle('receive-job-B', 'resolve', receiveJobResponse('po-B'));

    await screen.findByTestId('wms-module');
    expect(mockModuleMounts).toHaveLength(1);
    expect(mockModuleMounts[0].pendingReceiveSession).toMatchObject({ receiveJobId: 'receive-job-B', poId: 'po-B' });
    expect(screen.getByTestId('wms-receive-session')).not.toHaveTextContent('receive-job-A');
    expectNoReceiveMutation();
  });

  it('(H6) session exit and in-module Receive entry keep the mounted module (no hold, no remount)', async () => {
    const gets = deferReceiveJobGets();
    renderWmsAt('/wms?receiveJobId=receive-job-A');
    await gets.settle('receive-job-A', 'resolve', receiveJobResponse('po-A'));
    await screen.findByTestId('wms-module');

    fireEvent.click(screen.getByRole('button', { name: /stub exit session/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent(/^$/);
    expect(screen.getByTestId('wms-module')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stub enter receive/i }));
    expect(screen.getByTestId('location-search')).toHaveTextContent('receiveJobId=receive-job-in-module');
    expect(screen.getByTestId('wms-module')).toBeInTheDocument();
    expect(screen.queryByText(/opening receive/i)).toBeNull();
    expect(mockModuleMounts).toHaveLength(1);
    expectNoReceiveMutation();
  });

  it('(H7) counting deep-link is unaffected by the Receive hold', () => {
    deferReceiveJobGets();
    renderWmsAt('/wms?countTaskId=count-task-1');

    expect(screen.getByTestId('wms-count-task')).toHaveTextContent('count-task-1');
    expect(screen.queryByText(/opening receive/i)).toBeNull();
  });
});

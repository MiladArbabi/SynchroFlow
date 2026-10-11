/**
 * GH-1245 / RECEIVE-OUTSTANDING-01 (S2) — web Receive disposition contract.
 *
 * Ratified (GH-1245 #6108640765, #6108677052): goods that never arrived —
 * missing (supplier shortage) and deferred (later delivery) — are Receive /
 * supplier accounting, never physical Problem Center recovery work. The web
 * adapter must not issue the generic POST /api/v1/wms/problem-center for them.
 *
 * Exercises the real WmsOperationsPage Receive adapters (onReportReceiveException,
 * onInspectReceiveLine) by capturing the props it hands to WmsModuleFT2. Same
 * harness as WmsOperationsPage.receive-queue-handoff-1109.test.tsx.
 */
import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

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

const mockCapturedProps: { current: Record<string, any> | null } = { current: null };

jest.mock('@lasyncro/wms', () => {
  function WmsModuleFT2Stub(props: Record<string, any>) {
    mockCapturedProps.current = props;
    return null;
  }
  return {
    WmsModuleFT2: WmsModuleFT2Stub,
    useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
    useWebPush: jest.fn(),
    WmsConnectionBadge: () => null,
  };
});

const post = axiosInstance.post as jest.Mock;

const JOB_ID = 'receive-job-1245';
const LINE_ID = 'receive-line-1245';
const VARIANT_ID = '550e8400-e29b-41d4-a716-446655441245';
const EXCEPTION_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/exception`;
const INSPECT_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/inspect`;
const PROBLEM_CENTER_ROUTE = '/api/v1/wms/problem-center';

function renderPage() {
  render(
    <MemoryRouter initialEntries={['/wms']}>
      <Routes>
        <Route path="/wms" element={<WmsOperationsPage />} />
      </Routes>
    </MemoryRouter>, { wrapper: alertsQueryWrapper() });
  expect(mockCapturedProps.current).toBeTruthy();
  return mockCapturedProps.current!;
}

function postedRoutes(): string[] {
  return post.mock.calls.map((call) => String(call[0]));
}

describe('GH-1245 — web Receive disposition never fabricates Problem Center work for absent goods', () => {
  beforeEach(() => {
    mockCapturedProps.current = null;
    post.mockReset();
    post.mockResolvedValue({ data: { receive_exception_id: 'receive-exception-1245' } });
  });

  it('W1 — reporting missing_item persists the Receive exception only; no Problem Center task is created', async () => {
    const props = renderPage();

    await props.onReportReceiveException(JOB_ID, {
      lasyncro_variant_id: VARIANT_ID,
      receive_job_line_id: LINE_ID,
      exception_type: 'missing_item',
      quantity_affected: 5,
      accounting_role: 'shortfall',
      notes: 'Missing item reported during receive',
    });

    expect(postedRoutes()).toEqual([EXCEPTION_ROUTE]);
    expect(postedRoutes()).not.toContain(PROBLEM_CENTER_ROUTE);
  });

  it('W2 — a deferred/missing disposition is sent on the inspect request only; no exception and no Problem Center task (control)', async () => {
    const props = renderPage();

    await props.onInspectReceiveLine(JOB_ID, {
      lasyncro_variant_id: VARIANT_ID,
      receive_job_line_id: LINE_ID,
      quantity_accepted: 4,
      quantity_rejected: 2,
      quantity_missing: 0,
      quantity_deferred: 4,
    });

    expect(post.mock.calls).toEqual([
      [
        INSPECT_ROUTE,
        expect.objectContaining({
          receive_job_line_id: LINE_ID,
          quantity_accepted: 4,
          quantity_rejected: 2,
          quantity_missing: 0,
          quantity_deferred: 4,
        }),
      ],
    ]);
    expect(postedRoutes()).not.toContain(PROBLEM_CENTER_ROUTE);
  });
});

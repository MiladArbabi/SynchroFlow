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

  // GH-1241 S3-A1 — the operator's physical count is persisted through the
  // real adapter; a lost-response retry replays the SAME confirmation event
  // (a backend no-op), and only a later deliberate confirmation is a new event.
  it('W3 — count confirmation posts to confirm-count and a retry replays the same event', async () => {
    const props = renderPage();
    const CONFIRM_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/lines/${LINE_ID}/confirm-count`;
    expect(typeof props.onConfirmReceiveLineCount).toBe('function');

    post.mockRejectedValueOnce(new Error('network lost'));
    await expect(props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 7 })).rejects.toThrow('network lost');
    await props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 7 });
    await props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 7 });

    expect(postedRoutes()).toEqual([CONFIRM_ROUTE, CONFIRM_ROUTE, CONFIRM_ROUTE]);
    const events = post.mock.calls.map((call) => call[1].device_event_id);
    expect(post.mock.calls.every((call) => call[1].quantity_confirmed === 7)).toBe(true);
    expect(events[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(events[1]).toBe(events[0]);
    expect(events[2]).not.toBe(events[0]);
  });

  // GH-1241 S3-A1 G1 — an event ID belongs to ONE pending confirmation. A
  // count change starts a new intent, so a later confirmation of a quantity
  // used before must never replay the earlier (now invalidated) event, which
  // the backend permanently refuses with 409.
  it('W4 — a recount after an unacknowledged confirmation issues a new event for the new intent', async () => {
    const props = renderPage();
    const patch = axiosInstance.patch as jest.Mock;
    patch.mockReset();
    patch.mockResolvedValue({ data: {} });
    const confirmEvents = () => post.mock.calls.map((call) => call[1].device_event_id);

    // 1. Confirm 8 (E1); the response is lost, so E1 stays pending.
    post.mockRejectedValueOnce(new Error('network lost'));
    await expect(props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 8 })).rejects.toThrow('network lost');
    // A metadata-only draft with the same count keeps the pending operation:
    // the network retry still replays E1.
    await props.onPersistReceiveLineProgress(JOB_ID, LINE_ID, { quantity_sellable_provisional: 8, quantity_deferred: 2 });
    post.mockRejectedValueOnce(new Error('network lost'));
    await expect(props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 8 })).rejects.toThrow('network lost');
    const [e1, e1Retry] = confirmEvents();
    expect(e1Retry).toBe(e1);

    // 2–3. The physical count changes to 7 and is confirmed (E2).
    await props.onPersistReceiveLineProgress(JOB_ID, LINE_ID, { quantity_sellable_provisional: 7 });
    await props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 7 });
    // 4–5. Recount 8: a legitimate new confirmation, never the invalidated E1.
    await props.onPersistReceiveLineProgress(JOB_ID, LINE_ID, { quantity_sellable_provisional: 8 });
    await props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 8 });

    const [, , e2, e3] = confirmEvents();
    expect(post.mock.calls.map((call) => call[1].quantity_confirmed)).toEqual([8, 8, 7, 8]);
    expect(new Set([e1, e2, e3]).size).toBe(3);
  });

  it('W5 — a definitive refusal releases the event; the next confirmation is a new event', async () => {
    const props = renderPage();
    post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { code: 'RECEIVE_COUNT_CONFIRMATION_REPLAY_CONFLICT' } },
    }));
    await expect(props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 8 })).rejects.toThrow('409');
    await props.onConfirmReceiveLineCount(JOB_ID, LINE_ID, { quantity_confirmed: 8 });

    const [refused, next] = post.mock.calls.map((call) => call[1].device_event_id);
    expect(next).not.toBe(refused);
  });
});

// GH-1241 / S3-C — S3C-M3 host adapters for grouped draft / finalize.
//
// Contract (S3-B endpoints, receiveReconciliation.controller.ts):
//   PUT  /api/v1/suppliers/receive-jobs/:jobId/reconciliation/draft
//        { base_revision_id, device_event_id, lines } → { revision_id, revision_number, base_revision_id, status }
//   POST /api/v1/suppliers/receive-jobs/:jobId/reconciliation/finalize
//        { current_revision_id, device_event_id, lines } → { status: 'finalized', reconciliation_id, ... }
// The page owns the idempotency event: one stable device_event_id per unchanged
// intent. An unanswered request (lost response) retries with the SAME event
// (the server replays it); a definitive answer (success or 4xx refusal) ends
// the intent, so the next attempt — or any changed payload — is a new event.
//
// Exercises the real WmsOperationsPage adapters by capturing the props it
// hands to WmsModuleFT2 — same harness as
// WmsOperationsPage.receive-disposition-gh1245.test.tsx.
//
// PROVISIONAL INTERFACE: prop names onSaveReceiveReconciliationDraft /
// onFinalizeReceiveReconciliation, each (jobId, payload) => response body.
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
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: 'operator' } }),
}));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] }, isLoading: false, isError: false, refetch: jest.fn(), stowTasks: [], settings: null,
    openReceiveJobs: [], recountTasks: [], recountLocked: false,
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

const put = (axiosInstance as any).put as jest.Mock;
const post = axiosInstance.post as jest.Mock;

const JOB_ID = 'a1b2c3d4-1006-4000-8000-000000001006';
const LINE_P = '11111111-1006-4000-8000-000000000001';
const REV_1 = '33333333-1006-4000-8000-000000000001';
const REV_2 = '33333333-1006-4000-8000-000000000002';
const DRAFT_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/reconciliation/draft`;
const FINALIZE_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}/reconciliation/finalize`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const missingTwo = [{
  receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 2, quantity_deferred: 0,
  quantity_held_recoverable: 0, existing_exception_ids: [],
  new_exceptions: [{ exception_type: 'missing_item', quantity_affected: 2, accounting_role: 'shortfall', notes: null }],
}];
const laterTwo = [{
  receive_job_line_id: LINE_P, quantity_accepted: 1, quantity_rejected: 0, quantity_missing: 0, quantity_deferred: 2,
  quantity_held_recoverable: 0, existing_exception_ids: [], new_exceptions: [],
}];

const lostResponse = () => Object.assign(new Error('Network Error'), { request: {}, response: undefined });
const refusal = (code: string) => Object.assign(new Error(`${code}: refused`), {
  response: { status: 409, data: { error: `${code}: refused`, code } },
});

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

const eventsOf = (mock: jest.Mock) => mock.mock.calls.map(([, body]) => body.device_event_id);

beforeEach(() => {
  mockCapturedProps.current = null;
  put.mockReset();
  post.mockReset();
});

describe('GH-1241 S3C-M3 — grouped reconciliation host adapters', () => {
  it('HM1 — draft: exact request shape; a lost response retries the same event; a new intent or a refusal gets a new event', async () => {
    const props = renderPage();
    expect(typeof props.onSaveReceiveReconciliationDraft).toBe('function');

    put.mockRejectedValueOnce(lostResponse());
    await expect(props.onSaveReceiveReconciliationDraft(JOB_ID, { base_revision_id: null, lines: missingTwo })).rejects.toBeTruthy();
    put.mockResolvedValueOnce({ data: { revision_id: REV_1, revision_number: 1, base_revision_id: null, status: 'current' } });
    await expect(props.onSaveReceiveReconciliationDraft(JOB_ID, { base_revision_id: null, lines: missingTwo }))
      .resolves.toEqual({ revision_id: REV_1, revision_number: 1, base_revision_id: null, status: 'current' });

    expect(put.mock.calls.map(([url]) => url)).toEqual([DRAFT_ROUTE, DRAFT_ROUTE]);
    expect(put.mock.calls[1][1]).toEqual({ base_revision_id: null, lines: missingTwo, device_event_id: expect.stringMatching(UUID) });
    const [lost, retried] = eventsOf(put);
    expect(retried).toBe(lost);

    // A changed intent (new base and new decision) is a new event.
    put.mockRejectedValueOnce(refusal('RECEIVE_RECONCILIATION_REVISION_STALE'));
    await expect(props.onSaveReceiveReconciliationDraft(JOB_ID, { base_revision_id: REV_1, lines: laterTwo })).rejects.toBeTruthy();
    // After a definitive refusal the same intent is a new event too.
    put.mockResolvedValueOnce({ data: { revision_id: REV_2, revision_number: 2, base_revision_id: REV_1, status: 'current' } });
    await props.onSaveReceiveReconciliationDraft(JOB_ID, { base_revision_id: REV_1, lines: laterTwo });

    const events = eventsOf(put);
    expect(new Set(events).size).toBe(3);
    expect(events[2]).not.toBe(events[0]);
    expect(events[3]).not.toBe(events[2]);
    expect(post).not.toHaveBeenCalled();
  });

  it('HM2 — finalize: exact request shape; a lost response retries the same event and payload; a changed payload or a refusal gets a new event', async () => {
    const props = renderPage();
    expect(typeof props.onFinalizeReceiveReconciliation).toBe('function');
    const finalized = {
      status: 'finalized', reconciliation_id: '55555555-1006-4000-8000-000000000001', revision_id: REV_1,
      receive_job_id: JOB_ID, device_event_id: 'server-echo', finalized_at: '2026-10-13T12:05:00.000Z',
    };

    post.mockRejectedValueOnce(lostResponse());
    await expect(props.onFinalizeReceiveReconciliation(JOB_ID, { current_revision_id: REV_1, lines: missingTwo })).rejects.toBeTruthy();
    post.mockResolvedValueOnce({ data: finalized });
    await expect(props.onFinalizeReceiveReconciliation(JOB_ID, { current_revision_id: REV_1, lines: missingTwo }))
      .resolves.toEqual(finalized);

    expect(post.mock.calls.map(([url]) => url)).toEqual([FINALIZE_ROUTE, FINALIZE_ROUTE]);
    expect(post.mock.calls[1][1]).toEqual({ current_revision_id: REV_1, lines: missingTwo, device_event_id: expect.stringMatching(UUID) });
    const [lost, retried] = eventsOf(post);
    expect(retried).toBe(lost);

    // A different revision/payload is a different intent.
    post.mockRejectedValueOnce(refusal('RECEIVE_RECONCILIATION_PAYLOAD_MISMATCH'));
    await expect(props.onFinalizeReceiveReconciliation(JOB_ID, { current_revision_id: REV_2, lines: laterTwo })).rejects.toBeTruthy();
    post.mockRejectedValueOnce(lostResponse());
    await expect(props.onFinalizeReceiveReconciliation(JOB_ID, { current_revision_id: REV_2, lines: laterTwo })).rejects.toBeTruthy();
    post.mockResolvedValueOnce({ data: { ...finalized, revision_id: REV_2 } });
    await props.onFinalizeReceiveReconciliation(JOB_ID, { current_revision_id: REV_2, lines: laterTwo });

    const events = eventsOf(post);
    expect(events[2]).not.toBe(events[0]);
    // The refusal ended that intent: the next attempt is a new event, then its lost-response retry reuses it.
    expect(events[3]).not.toBe(events[2]);
    expect(events[4]).toBe(events[3]);
    expect(put).not.toHaveBeenCalled();
  });
});

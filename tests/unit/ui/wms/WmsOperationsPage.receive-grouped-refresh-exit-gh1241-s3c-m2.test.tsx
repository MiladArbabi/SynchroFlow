// GH-1241 / S3-C — S3C-M2 host-level regressions: stale Receive refresh after
// exit (G12) and scan-lookup failure classification (H1).
//
// G12 — refreshReceiveSession (WmsModuleFT2) re-reads GET /receive-jobs/:id
// and writes activeSession with no exit/supersede guard. Before M2 no Receive
// screen offers an exit while that refresh is in flight (per-line handoff
// renders only after the awaited refresh), so the race is unreachable today.
// M2's grouped count screen refreshes after each confirmation while Back to
// WMS stays available. Contract: a refresh still in flight when the operator
// leaves can never restore the exited session.
//
// H1 — WmsOperationsPage.handleResolveBarcode is the host adapter for every
// scan lookup. Contract: an unknown barcode (404) resolves null; a network or
// server failure rejects, so the session can say "couldn't check" instead of
// "not recognised".
//
// Same harness as WmsOperationsPage.receive-grouped-exit-gh1241-s3c.test.tsx
// (S3C-E1): the REAL WmsOperationsPage around the REAL WmsModuleFT2; HTTP is the
// mocked axios boundary; react-router v7 commits URL changes in a transition.
// The module is wrapped only to capture the props the page hands it (H1).
//
// PROVISIONAL INTERFACE (M2 grouped count screen): scan placeholder, the
// "Confirm count" action and "Back to WMS" — see the M2 adapter in
// ReceiveSessionPage.grouped-count-gh1241-s3c-m2.test.tsx.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

const JOB_ID = 'job-s3c-m2-refresh';
const LINE_ID = 'line-s3c-m2-refresh';
const BARCODE = '5000000000042';
const JOB_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}`;
const RECONCILIATION_ROUTE = `${JOB_ROUTE}/reconciliation`;
const PROGRESS_ROUTE = `${JOB_ROUTE}/lines/${LINE_ID}/progress`;
const CONFIRM_ROUTE = `${JOB_ROUTE}/lines/${LINE_ID}/confirm-count`;
const RESOLVE_ROUTE = '/api/v1/wms/barcode/resolve';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 7, role: 'owner' } }),
}));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({ data: { locations: [] } }),
}));
jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: () => ({ isDismissed: true, isLoading: false, dismiss: jest.fn() }),
}));
const mockCapturedModuleProps: { current: Record<string, any> | null } = { current: null };
jest.mock('@lasyncro/wms', () => {
  const ReactActual = jest.requireActual('react');
  const RealWmsModuleFT2 = jest.requireActual('../../../../modules/wms/src/ui/pages/WmsModuleFT2').default;
  function CapturingWmsModuleFT2(props: Record<string, any>) {
    mockCapturedModuleProps.current = props;
    return ReactActual.createElement(RealWmsModuleFT2, props);
  }
  return {
    WmsModuleFT2: CapturingWmsModuleFT2,
    useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
    useWebPush: jest.fn(),
    WmsConnectionBadge: () => null,
  };
});

const mockWmsValue = {
  data: { batches: [] },
  isLoading: false,
  isError: false,
  refetch: jest.fn(),
  stowTasks: [],
  settings: null,
  openReceiveJobs: [{
    receive_job_id: 'job-s3c-m2-refresh',
    status: 'in_progress',
    assigned_operator_id: 7,
    started_at: '2026-10-13T08:00:00.000Z',
    closed_at: null,
    supplier_name: 'M2 Refresh Supplier',
    po_id: 'po-s3c-m2-refresh',
    po_number: 2413,
    total_units: 4,
    total_variants: 1,
  }],
  recountTasks: [],
  recountLocked: false,
  recountTasksSettled: true,
  openingInventory: null,
};
jest.mock('pages/wms/useWms', () => ({
  useWms: () => mockWmsValue,
}));

// ── canonical read shapes ────────────────────────────────────────────────────

function receiveJobBody(countConfirmed: number | null, provisional: number | null) {
  return {
    job: {
      po_id: 'po-s3c-m2-refresh',
      po_number: 2413,
      supplier_name: 'M2 Refresh Supplier',
      status: 'in_progress',
      assigned_operator_id: 7,
      closed_at: null,
      actual_delivery_date: null,
      delivery_accounting_version: 2,
    },
    lines: [{
      receive_job_line_id: LINE_ID,
      lasyncro_variant_id: 'variant-s3c-m2-refresh',
      sku: 'M2-REFRESH',
      variant_title: 'Default Title',
      description: 'M2 refresh line',
      quantity_expected: 4,
      quantity_accepted: 0,
      quantity_rejected: 0,
      quantity_missing: null,
      quantity_deferred: null,
      quantity_sellable_provisional: provisional,
      reconciliation_started_at: null,
      quantity_count_confirmed: countConfirmed,
      count_state: countConfirmed == null ? 'not_counted' : 'confirmed',
      inspection_complete: false,
      image_url: null,
      barcode: BARCODE,
      product_title: 'M2 refresh widget',
      barcode_ready: false,
      barcode_readiness_reason: 'not_inspected',
      awaiting_label_ack: false,
      accepted_unit_count: 0,
      labelled_unit_count: 0,
    }],
  };
}

const openReconciliationBody = {
  receive_job_id: JOB_ID,
  status: 'open',
  current_revision_id: null,
  revisions: [],
  lines: [{
    receive_job_line_id: LINE_ID,
    po_line_item_id: `poli-${LINE_ID}`,
    lasyncro_variant_id: 'variant-s3c-m2-refresh',
    quantity_expected: 4,
    quantity_count_confirmed: null,
    count_state: 'not_counted',
    inspection_complete: false,
  }],
  finalization: null,
};

// ── harness ──────────────────────────────────────────────────────────────────

const get = axiosInstance.get as jest.Mock;
const post = axiosInstance.post as jest.Mock;
const patch = axiosInstance.patch as jest.Mock;
const put = (axiosInstance as any).put as jest.Mock;
const del = (axiosInstance as any).delete as jest.Mock;

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };
function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}

let search = '';
function LocationProbe() {
  search = useLocation().search;
  return null;
}

function renderAt(entry: string) {
  render(
    <MemoryRouter initialEntries={[entry]}>
      <WmsOperationsPage />
      <LocationProbe />
    </MemoryRouter>, { wrapper: alertsQueryWrapper() });
}

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }
};

const workCard = () => screen.queryByTestId(`receive-work-card-${JOB_ID}`);

function expectOperationsBoard() {
  const params = new URLSearchParams(search);
  expect({
    receiveJobId: params.get('receiveJobId'),
    warehouseFocus: params.get('warehouseFocus'),
    receiveSessionVisible: screen.queryByTestId('receive-session-mode') !== null,
    backToWmsVisible: screen.queryByRole('button', { name: 'Back to WMS' }) !== null,
    boardWorkCardVisible: workCard() !== null,
  }).toEqual({
    receiveJobId: null,
    warehouseFocus: null,
    receiveSessionVisible: false,
    backToWmsVisible: false,
    boardWorkCardVisible: true,
  });
}

beforeEach(() => {
  search = '';
  mockCapturedModuleProps.current = null;
  sessionStorage.clear();
  [get, post, patch, put, del].forEach((mock) => mock.mockReset());
  put.mockResolvedValue({ data: {} });
  del.mockResolvedValue({ data: {} });
});

describe('GH-1241 S3C-M2 — host-level grouped Receive regressions', () => {
  it('G12 — a post-confirmation refresh still in flight when the operator leaves cannot restore the exited session', async () => {
    // Canonical store: PATCH progress and POST confirm-count update it, every
    // GET receive job returns its latest values. Only the one post-confirmation
    // refresh is held until after Back to WMS.
    const canonical = { provisional: null as number | null, confirmed: null as number | null };
    let holdNextJobRead = false;
    const heldRefresh = deferred();
    let heldJobReads = 0;
    get.mockImplementation((url: string) => {
      if (url === JOB_ROUTE) {
        if (holdNextJobRead) {
          holdNextJobRead = false;
          heldJobReads += 1;
          return heldRefresh.promise;
        }
        return Promise.resolve({ data: receiveJobBody(canonical.confirmed, canonical.provisional) });
      }
      if (url === RECONCILIATION_ROUTE) return Promise.resolve({ data: openReconciliationBody });
      return Promise.resolve({ data: {} });
    });
    patch.mockImplementation((url: string, body: { quantity_sellable_provisional: number }) => {
      if (url === PROGRESS_ROUTE) {
        canonical.provisional = body.quantity_sellable_provisional;
        if (canonical.confirmed != null && canonical.confirmed !== canonical.provisional) canonical.confirmed = null;
      }
      return Promise.resolve({ data: {} });
    });
    post.mockImplementation((url: string, body: { quantity_confirmed: number }) => {
      if (url === CONFIRM_ROUTE) {
        canonical.confirmed = body.quantity_confirmed;
        canonical.provisional = body.quantity_confirmed;
        return Promise.resolve({ data: { quantity_count_confirmed: body.quantity_confirmed } });
      }
      return Promise.resolve({ data: {} });
    });

    renderAt('/wms');
    const card = await screen.findByTestId(`receive-work-card-${JOB_ID}`);
    fireEvent.click(within(card).getByRole('button', { name: /resume receive/i }));
    const marker = await screen.findByTestId('receive-session-mode');
    await waitFor(() => expect(marker).toHaveAttribute('data-receive-mode', 'grouped'));
    await settle();

    // Enter a count of one and confirm it.
    const counted = within(screen.getByTestId('receive-count-current')).getByRole('spinbutton', { name: /count/i });
    fireEvent.change(counted, { target: { value: '1' } });
    await waitFor(() => expect(canonical.provisional).toBe(1));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /confirm count/i })).toBeEnabled()
    );

    holdNextJobRead = true;
    fireEvent.click(screen.getByRole('button', { name: /confirm count/i }));
    await waitFor(() => expect(canonical.confirmed).toBe(1));
    // The confirmation succeeded and its refresh is now in flight.
    await waitFor(() => expect(heldJobReads).toBe(1));
    await waitFor(() =>
      expect(screen.getByTestId(`receive-count-line-${LINE_ID}`)).toHaveAttribute('data-count-state', 'confirmed')
    );

    fireEvent.click(screen.getByRole('button', { name: 'Back to WMS' }));
    await waitFor(() => expect(new URLSearchParams(search).get('receiveJobId')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('receive-session-mode')).not.toBeInTheDocument());

    // The stale refresh lands after exit.
    await act(async () => { heldRefresh.resolve({ data: receiveJobBody(1, 1) }); });
    await settle();
    expectOperationsBoard();

    // Writes: exactly one progress draft and one confirmation — nothing else.
    expect(patch.mock.calls.map(([url]) => url)).toEqual([PROGRESS_ROUTE]);
    expect(post.mock.calls.map(([url]) => url)).toEqual([CONFIRM_ROUTE]);
    expect(put).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('H1 — the host scan lookup resolves null only for an unknown barcode; network and server failures reject', async () => {
    get.mockResolvedValue({ data: {} });
    renderAt('/wms');
    await waitFor(() => expect(mockCapturedModuleProps.current).toBeTruthy());
    const resolveBarcode = mockCapturedModuleProps.current!.onResolveBarcode as (value: string) => Promise<unknown>;

    post.mockResolvedValueOnce({ data: { lasyncro_variant_id: 'variant-known' } });
    await expect(resolveBarcode('5000000000059')).resolves.toEqual({ lasyncro_variant_id: 'variant-known' });

    post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404, data: { error: 'No variant found for scanned value' } },
    }));
    await expect(resolveBarcode('0000000000000')).resolves.toBeNull();

    // Unanswered request (offline / DNS / timeout): not "unknown".
    post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { request: {}, response: undefined }));
    await expect(resolveBarcode('5000000000066')).rejects.toBeTruthy();

    // Server failure: not "unknown".
    post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { error: 'Barcode resolution failed' } },
    }));
    await expect(resolveBarcode('5000000000073')).rejects.toBeTruthy();

    expect(post.mock.calls.map(([url]) => url)).toEqual([RESOLVE_ROUTE, RESOLVE_ROUTE, RESOLVE_ROUTE, RESOLVE_ROUTE]);
  });
});

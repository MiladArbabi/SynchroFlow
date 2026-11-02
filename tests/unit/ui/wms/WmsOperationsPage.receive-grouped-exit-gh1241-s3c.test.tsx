// GH-1241 / S3-C — S3C-M1/E1 RECEIVE EXIT RESTORATION — RED regression gate.
//
// Live defect: an open grouped Receive session shows "Back to WMS". Clicking
// it clears the URL to /wms, but the Receive session stays visible instead of
// the Operations board.
//
// Contract: Back to WMS is authoritative. The URL drops receiveJobId and
// warehouseFocus, the Operations board renders, the Receive session is gone,
// no Receive read that resolves later may bring it back, the same job can be
// reopened, and exit performs no accounting write.
//
// Renders the REAL WmsOperationsPage around the REAL WmsModuleFT2 (and through
// it the real ReceiveSessionPage), so the page's own Receive wiring is
// exercised end to end: board entry (onReceiveSessionEnter -> ?receiveJobId),
// the URL handoff (GET receive job -> pendingReceiveSession), mode resolution
// (GET /reconciliation) and exit (exitSession -> onSessionExit -> /wms).
// @lasyncro/wms is mocked only to hand the page the real module by path (the
// package entry cannot resolve in the frontend Jest project — GH-1191
// precedent, WmsOperationsPage.countCompletionExit.test.tsx) plus inert
// offline/push hooks. HTTP is the mocked axios boundary.
//
// Scheduling modelled, matching production: react-router v7 routers
// (BrowserRouter and MemoryRouter alike) apply URL changes inside
// startTransition. Board entry therefore issues two GET receive-job reads for
// one open: the module's own entry read first (enterReceiveSession, inside the
// click), then the page's URL-handoff read once ?receiveJobId commits. Either
// may be the slower one on a real network; the delayed-result cases hold one
// of them until after Back to WMS.
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

// WMS-OPS-NEEDS-ATTENTION-01 — owner/admin passively read the alerts inbox; a
// fresh client seeded with an empty inbox means no alerts request fires.
function alertsQueryWrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function AlertsQueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

const JOB_ID = 'job-s3c-e1';
const LINE_ID = 'line-s3c-e1';
const ME = 7;
const JOB_ROUTE = `/api/v1/suppliers/receive-jobs/${JOB_ID}`;
const RECONCILIATION_ROUTE = `${JOB_ROUTE}/reconciliation`;

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
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: jest.requireActual('../../../../modules/wms/src/ui/pages/WmsModuleFT2').default,
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(),
  WmsConnectionBadge: () => null,
}));

// One stable store value (react-query returns stable references between
// fetches); read at render time, after module initialisation.
const mockRefetch = jest.fn();
const mockWmsValue = {
  data: { batches: [] },
  isLoading: false,
  isError: false,
  refetch: mockRefetch,
  stowTasks: [],
  settings: null,
  // The operator's own in-progress Receive on the Operations board.
  openReceiveJobs: [{
    receive_job_id: 'job-s3c-e1',
    status: 'in_progress',
    assigned_operator_id: 7,
    started_at: '2026-10-13T08:00:00.000Z',
    closed_at: null,
    supplier_name: 'S3-C Supplier',
    po_id: 'po-s3c-e1',
    po_number: 1241,
    total_units: 10,
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

/** GET /receive-jobs/:jobId — in-progress v2 job, nothing counted or inspected. */
const receiveJobBody = {
  job: {
    po_id: 'po-s3c-e1',
    po_number: 1241,
    supplier_name: 'S3-C Supplier',
    status: 'in_progress',
    assigned_operator_id: ME,
    closed_at: null,
    actual_delivery_date: null,
    delivery_accounting_version: 2,
  },
  lines: [{
    receive_job_line_id: LINE_ID,
    lasyncro_variant_id: 'variant-s3c-e1',
    sku: 'S3C-E1-SKU',
    variant_title: 'Default Title',
    description: 'S3-C exit line',
    quantity_expected: 10,
    quantity_accepted: 0,
    quantity_rejected: 0,
    quantity_missing: null,
    quantity_deferred: null,
    quantity_sellable_provisional: null,
    reconciliation_started_at: null,
    quantity_count_confirmed: null,
    count_state: 'not_counted',
    inspection_complete: false,
    image_url: null,
    barcode: null,
    product_title: 'S3-C exit widget',
    barcode_ready: false,
    barcode_readiness_reason: 'not_inspected',
    awaiting_label_ack: false,
    accepted_unit_count: 0,
    labelled_unit_count: 0,
  }],
};

/** GET /reconciliation — open, no revision yet (S3-B read contract). */
const openReconciliationBody = {
  receive_job_id: JOB_ID,
  status: 'open',
  current_revision_id: null,
  revisions: [],
  lines: [{
    receive_job_line_id: LINE_ID,
    po_line_item_id: `poli-${LINE_ID}`,
    lasyncro_variant_id: 'variant-s3c-e1',
    quantity_expected: 10,
    quantity_count_confirmed: null,
    count_state: 'not_counted',
    inspection_complete: false,
  }],
  finalization: null,
};

// ── harness ──────────────────────────────────────────────────────────────────

const get = axiosInstance.get as jest.Mock;
const writeMocks = {
  post: axiosInstance.post as jest.Mock,
  patch: axiosInstance.patch as jest.Mock,
  put: (axiosInstance as any).put as jest.Mock,
  delete: (axiosInstance as any).delete as jest.Mock,
};

type Deferred = { promise: Promise<unknown>; resolve: (value: unknown) => void };
function deferred(): Deferred {
  let resolve!: (value: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}

/**
 * Routes GETs to the canonical bodies. `holdJobRead` (1-based) holds that one
 * GET receive-job read until the test releases it; every other read resolves.
 */
function routeGets({ holdJobRead }: { holdJobRead?: number } = {}) {
  const held = deferred();
  let jobReads = 0;
  get.mockImplementation((url: string) => {
    if (url === JOB_ROUTE) {
      jobReads += 1;
      if (jobReads === holdJobRead) return held.promise;
      return Promise.resolve({ data: receiveJobBody });
    }
    if (url === RECONCILIATION_ROUTE) return Promise.resolve({ data: openReconciliationBody });
    return Promise.resolve({ data: {} });
  });
  return {
    jobReads: () => jobReads,
    release: () => held.resolve({ data: receiveJobBody }),
  };
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

async function openFromBoard() {
  const card = await screen.findByTestId(`receive-work-card-${JOB_ID}`);
  fireEvent.click(within(card).getByRole('button', { name: /resume receive/i }));
}

/** The grouped Receive session is the visible surface. */
async function expectGroupedSession() {
  const marker = await screen.findByTestId('receive-session-mode');
  await waitFor(() => expect(marker).toHaveAttribute('data-receive-mode', 'grouped'));
  expect(marker).toHaveAttribute('data-current-revision-id', '');
  expect(screen.getByRole('button', { name: 'Exit' })).toBeInTheDocument();
}

/** Exit contract: clean URL, no Receive session, Operations board back. */
function expectOperationsBoard() {
  const params = new URLSearchParams(search);
  expect({
    receiveJobId: params.get('receiveJobId'),
    warehouseFocus: params.get('warehouseFocus'),
    receiveSessionVisible: screen.queryByTestId('receive-session-mode') !== null,
    backToWmsVisible: screen.queryByRole('button', { name: 'Exit' }) !== null,
    boardWorkCardVisible: workCard() !== null,
  }).toEqual({
    receiveJobId: null,
    warehouseFocus: null,
    receiveSessionVisible: false,
    backToWmsVisible: false,
    boardWorkCardVisible: true,
  });
}

/** Opening, viewing and leaving a grouped Receive writes nothing. */
function expectNoWrites() {
  expect({
    post: writeMocks.post.mock.calls.map(([url]) => url),
    patch: writeMocks.patch.mock.calls.map(([url]) => url),
    put: writeMocks.put.mock.calls.map(([url]) => url),
    delete: writeMocks.delete.mock.calls.map(([url]) => url),
  }).toEqual({ post: [], patch: [], put: [], delete: [] });
}

/**
 * WS-UX-RECEIVE-D4R S7-CORRECT — a clean grouped exit first shows the V3.1
 * Saved sheet and navigates nowhere; its Back to WMS performs the exit.
 */
async function clickBackToWms() {
  fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
  const sheet = await screen.findByRole('dialog', { name: /leave this receive/i });
  expect(new URLSearchParams(search).get('receiveJobId')).toBe(JOB_ID);
  expect(screen.getByTestId('receive-session-mode')).toBeInTheDocument();
  fireEvent.click(within(sheet).getByRole('button', { name: 'Back to WMS' }));
}

beforeEach(() => {
  search = '';
  sessionStorage.clear();
  get.mockReset();
  Object.values(writeMocks).forEach((mock) => {
    mock.mockReset();
    mock.mockResolvedValue({ data: {} });
  });
  mockRefetch.mockReset();
});

describe('GH-1241 S3C-M1/E1 — Back to WMS leaves a grouped Receive session', () => {
  it('E1 — board entry: Back to WMS restores the Operations board, stays there, and the same job reopens; nothing is written', async () => {
    routeGets();
    renderAt('/wms');

    // 1–3. Open the in-progress v2 Receive from the board; reconciliation is
    // open with no revision, so the grouped session appears.
    await openFromBoard();
    await expectGroupedSession();
    expect(new URLSearchParams(search).get('receiveJobId')).toBe(JOB_ID);
    await settle();

    // 4–7. Back to WMS.
    await clickBackToWms();
    await waitFor(() => expect(new URLSearchParams(search).get('receiveJobId')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('receive-session-mode')).not.toBeInTheDocument());
    expectOperationsBoard();

    // Nothing settling afterwards brings the session back.
    await settle();
    expectOperationsBoard();

    // 9. The same job reopens normally.
    await openFromBoard();
    await expectGroupedSession();
    expect(new URLSearchParams(search).get('receiveJobId')).toBe(JOB_ID);

    // 10. No accounting (or any other) write anywhere in the journey.
    expectNoWrites();
  });

  it('E2a — the module entry read resolving after Back to WMS cannot restore the session', async () => {
    // Hold read #1 (the module's own entry read); the page's URL-handoff read
    // (#2) resolves and opens the session first.
    const reads = routeGets({ holdJobRead: 1 });
    renderAt('/wms');

    await openFromBoard();
    await expectGroupedSession();
    expect(reads.jobReads()).toBeGreaterThanOrEqual(2);

    await clickBackToWms();
    await waitFor(() => expect(new URLSearchParams(search).get('receiveJobId')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('receive-session-mode')).not.toBeInTheDocument());

    // 8. The stale entry read lands after exit.
    await act(async () => { reads.release(); });
    await settle();
    expectOperationsBoard();
    expectNoWrites();
  });

  it('E2b — the page URL-handoff read resolving after Back to WMS cannot restore the session', async () => {
    // Hold read #2 (the page's URL-handoff read); the module's own entry read
    // (#1) resolves and opens the session first.
    const reads = routeGets({ holdJobRead: 2 });
    renderAt('/wms');

    await openFromBoard();
    await expectGroupedSession();
    await waitFor(() => expect(reads.jobReads()).toBeGreaterThanOrEqual(2));

    await clickBackToWms();
    await waitFor(() => expect(new URLSearchParams(search).get('receiveJobId')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('receive-session-mode')).not.toBeInTheDocument());

    // 8. The stale handoff read lands after exit.
    await act(async () => { reads.release(); });
    await settle();
    expectOperationsBoard();
    expectNoWrites();
  });

  it('E3 — direct URL entry / refresh: the grouped session restores from ?receiveJobId, then Back to WMS restores the board and the job reopens', async () => {
    routeGets();
    // A reload of an open grouped session lands on exactly this URL.
    renderAt(`/wms?receiveJobId=${JOB_ID}`);

    await expectGroupedSession();
    expect(new URLSearchParams(search).get('receiveJobId')).toBe(JOB_ID);
    await settle();

    await clickBackToWms();
    await waitFor(() => expect(new URLSearchParams(search).get('receiveJobId')).toBeNull());
    await waitFor(() => expect(screen.queryByTestId('receive-session-mode')).not.toBeInTheDocument());
    expectOperationsBoard();
    await settle();
    expectOperationsBoard();

    await openFromBoard();
    await expectGroupedSession();
    expectNoWrites();
  });
});

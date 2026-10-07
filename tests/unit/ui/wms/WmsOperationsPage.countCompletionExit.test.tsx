// GH-1191 — completing an Opening Inventory bin must leave the count session.
//
// Production journey: a focused Opening Inventory count
// (/wms?countTaskId=…&warehouseFocus=count) completes its bin, the success
// banner shows, the URL becomes /wms — yet the count execution UI stays
// rendered until a hard reload.
//
// This suite renders the REAL WmsOperationsPage around the REAL WmsModuleFT2
// so the page's own exit wiring (onSessionExit -> setSearchParams({}),
// onRefresh -> useWms.refetch, onCountFinished banner) is exercised end to end.
// @lasyncro/wms is mocked only to hand the page the real module by path (the
// package entry cannot resolve in the frontend Jest project — see
// WmsOperationsPage.openingInventoryCutover.test.tsx) plus inert offline/push
// hooks.
//
// Scheduling modelled, matching production:
//   - react-router v7 routers apply URL changes inside startTransition, so the
//     cleared URL commits AFTER exitSession's setActiveSession(null);
//   - useWms.refetch starts the recount-tasks read, so recountTasksSettled
//     drops to false (useWms: settled = !isFetching) while the URL transition
//     is still pending and recountTasks still holds the pre-completion task.
// useWms is a store read through useSyncExternalStore (as react-query is), and
// refetch flips recountTasksSettled synchronously to open that stale window
// deterministically.
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import WmsModuleFT2 from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
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

const TASK_ID = 'd898681e-3f4f-48e1-b30c-f1452d5071c1';
const LABEL = 'CNT-47-0001';
const OPENING_BIN = 'PICK-01';
const VARIANT = 'bd5cad3a-da2e-4ed3-b553-8a288553a137';
const ME = 7;

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
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

let mockWms: Record<string, any> = {};
const mockWmsListeners = new Set<() => void>();
function mockSetWms(patch: Record<string, unknown>) {
  mockWms = { ...mockWms, ...patch };
  mockWmsListeners.forEach((listener) => listener());
}
jest.mock('pages/wms/useWms', () => {
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (listener: () => void) => {
    mockWmsListeners.add(listener);
    return () => { mockWmsListeners.delete(listener); };
  };
  return { useWms: () => useSyncExternalStore(subscribe, () => mockWms) };
});

const openingTask = (over: Record<string, unknown> = {}) => ({
  recount_task_id: TASK_ID,
  label: LABEL,
  status: 'claimed',
  scope: 'location',
  blind: true,
  assigned_to: ME,
  claimed_by: ME,
  created_at: '2026-09-30T00:00:00.000Z',
  claimed_at: '2026-09-30T00:00:00.000Z',
  claim_generation: 'gen-1191',
  line_count: 1,
  counted_count: 1,
  purpose: 'opening_inventory',
  scope_location_code: OPENING_BIN,
  ...over,
});

// Save Bin Count already persisted: counted_quantity=1, count_method=unit_scan.
const savedLine = {
  recount_line_id: 'line-1191',
  lasyncro_variant_id: VARIANT,
  location_code: OPENING_BIN,
  counted_quantity: 1,
  count_method: 'unit_scan',
  scan_count: 1,
  counted_at: '2026-09-30T00:05:00.000Z',
  skip_reason: null,
  skipped_at: null,
  product_title: 'Reviewer product',
  variant_title: null,
  sku: 'SKU-1191',
  image_url: null,
};

const get = axiosInstance.get as jest.Mock;
const post = axiosInstance.post as jest.Mock;
const linesFetches = () =>
  get.mock.calls.filter(([url]) => url === `/api/v1/wms/recount-tasks/${TASK_ID}/lines`).length;

let search = '';
function LocationProbe() {
  search = useLocation().search;
  return null;
}

const countSessionVisible = () =>
  screen.queryByPlaceholderText('Scan bin barcode') !== null ||
  screen.queryByPlaceholderText('Scan product barcode') !== null ||
  screen.queryByRole('button', { name: 'Complete bin' }) !== null;

const settle = async () => {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
};

beforeEach(() => {
  sessionStorage.clear();
  get.mockReset();
  post.mockReset();
  get.mockImplementation(async (url: string) =>
    url.endsWith('/lines') ? { data: { lines: [savedLine] } } : { data: {} }
  );
  post.mockResolvedValue({ data: {} });
  mockWms = {
    data: { batches: [] },
    isLoading: false,
    isError: false,
    stowTasks: [],
    settings: null,
    openReceiveJobs: [],
    recountTasks: [openingTask()],
    recountLocked: false,
    recountTasksSettled: true,
    openingInventory: null,
    refetchOpeningInventory: jest.fn().mockResolvedValue(undefined),
    // useWms.refetch starts the recount-tasks read: isFetching -> not settled.
    refetch: () => mockSetWms({ recountTasksSettled: false }),
  };
});

describe('GH-1191 — completed Opening Inventory bin exits to the ordinary WMS body', () => {
  it('the completed count session does not stay or become active again after exit', async () => {
    render(
      <MemoryRouter initialEntries={[`/wms?countTaskId=${TASK_ID}&warehouseFocus=count`]}>
        <WmsOperationsPage />
        <LocationProbe />
      </MemoryRouter>, { wrapper: alertsQueryWrapper() });

    // A. Valid active Opening Inventory count restored from the focused URL.
    const binInput = await screen.findByPlaceholderText('Scan bin barcode');
    expect(new URLSearchParams(search).get('countTaskId')).toBe(TASK_ID);
    expect(new URLSearchParams(search).get('warehouseFocus')).toBe('count');

    fireEvent.change(binInput, { target: { value: OPENING_BIN } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm bin' }));
    const completeBin = await screen.findByRole('button', { name: 'Complete bin' });
    await settle();
    const fetchesBeforeExit = linesFetches();

    // B. Final successful completion -> exitSession(label).
    fireEvent.click(completeBin);
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/api/v1/wms/recount-tasks/${TASK_ID}/opening-complete`)
    );
    expect(await screen.findByText(`${LABEL} counted and submitted for review.`)).toBeInTheDocument();

    // C. The parent URL is ordinary /wms; the refresh is still in flight and
    // recountTasks still holds the formerly usable task.
    await waitFor(() => expect(search).toBe(''));
    await settle();
    expect(mockWms.recountTasksSettled).toBe(false);
    expect(mockWms.recountTasks).toEqual([openingTask()]);

    // D. The completed session must not remain or be re-established.
    expect({
      countSessionVisible: countSessionVisible(),
      sessionRemounted: linesFetches() > fetchesBeforeExit,
    }).toEqual({ countSessionVisible: false, sessionRemounted: false });

    // E. Refresh settles (task committed): the ordinary body renders in place.
    act(() => {
      mockSetWms({ recountTasks: [openingTask({ status: 'committed' })], recountTasksSettled: true });
    });
    await settle();
    expect(countSessionVisible()).toBe(false);
    expect(screen.getByRole('button', { name: 'Reconcile inventory' })).toBeInTheDocument();
    expect(search).toBe('');
  });
});

// GH-1191 — the exit fence tracks URL ownership, not entitlement. A URL that
// leaves the exited task while recount is locked must still release the fence,
// so the same still-valid task can be reopened legitimately later.
describe('GH-1191 — exit fence clears on URL departure even while recount is locked', () => {
  // Module-level, URL props driven explicitly (same precedent as
  // WmsOperationsPage.countFocus.test.tsx CONTRACT-1164-UI-11).
  function moduleProps(over: Record<string, unknown> = {}) {
    return {
      data: { batches: [] },
      isLoading: false,
      isError: false,
      currentUserId: ME,
      openReceiveJobs: [],
      stowTasks: [],
      onRefresh: jest.fn(),
      recountLocked: false,
      recountTasks: [openingTask({ status: 'dispatched', claimed_by: null, claimed_at: null, claim_generation: null })],
      recountTasksSettled: true,
      pendingCountTaskId: TASK_ID,
      countFocusRequested: true,
      onCountSessionEnter: jest.fn(),
      onCountSessionFocusChange: jest.fn(),
      onSessionExit: jest.fn(),
      onFetchCountingPreview: jest.fn().mockResolvedValue([]),
      onFetchCountingAssignees: jest.fn().mockResolvedValue([]),
      onCreateCountingTask: jest.fn(),
      onFetchCountingLines: jest.fn().mockResolvedValue([]),
      onFetchCountingFindings: jest.fn().mockResolvedValue([]),
      onCreateCountingFinding: jest.fn(),
      onClaimCountingTask: jest.fn().mockResolvedValue(undefined),
      onReassignCountingTask: jest.fn(),
      onRecordCountingLine: jest.fn(),
      onSkipCountingLine: jest.fn(),
      onCloseCountingTask: jest.fn(),
      onCreateOpeningLine: jest.fn(),
      onCompleteOpening: jest.fn(),
      onResolveBarcode: jest.fn(),
      onSetupBinsClick: jest.fn(),
      ...over,
    } as any;
  }

  const leaveCount = () => screen.queryByRole('button', { name: 'Leave count' });

  it('the same task A reopens after the URL left it while recount was locked', async () => {
    const p = moduleProps();
    const { rerender } = render(<WmsModuleFT2 {...p} />);

    // A. Valid count task A is active.
    expect(await screen.findByRole('button', { name: 'Leave count' })).toBeInTheDocument();

    // B. Leave count -> exitSession: the exit fence now holds A.
    fireEvent.click(leaveCount()!);
    await settle();
    expect(p.onSessionExit).toHaveBeenCalledTimes(1);
    expect(leaveCount()).not.toBeInTheDocument();

    // C. Recount locks, and URL ownership leaves A while it is locked.
    rerender(<WmsModuleFT2 {...p} recountLocked />);
    await settle();
    rerender(<WmsModuleFT2 {...p} recountLocked pendingCountTaskId={null} countFocusRequested={false} />);
    await settle();

    // E. The URL legitimately names the same, still-usable task A again.
    rerender(<WmsModuleFT2 {...p} recountLocked />);
    await settle();
    expect(leaveCount()).not.toBeInTheDocument();
    p.onCountSessionFocusChange.mockClear();

    // F/G. Recount unlocks: A restores normally — no stale fence suppresses it.
    rerender(<WmsModuleFT2 {...p} />);
    expect(await screen.findByRole('button', { name: 'Leave count' })).toBeInTheDocument();
    await waitFor(() => expect(p.onCountSessionFocusChange).toHaveBeenCalledWith(TASK_ID, true));
  });
});

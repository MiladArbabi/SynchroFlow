// #1164 — stale WMS Opening Inventory card.
//
// Production: after the Ops Console started the cohort, the WMS card still
// read "Your first warehouse count has not started yet." The page held the
// progress view in local state fetched once on mount, so the console's
// canonical re-read never reached it. Contract: the WMS surface reads the
// SAME canonical query the Ops Console refreshes after a start, so one
// re-read updates both — no duplicated state, no timers.
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axiosInstance } from 'api/axiosConfig';
import { AuthContext } from 'contexts/AuthContext';
import { useActivationChecklist } from 'hooks/useActivationChecklist';
import { useWms } from 'pages/wms/useWms';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn() },
}));

let mockRecountEntitled = true;
let mockEntitlementsResolved = true;
jest.mock('hooks/usePlanEntitlement', () => ({
  usePlanEntitlement: () => ({
    can: () => mockRecountEntitled,
    hasResolved: mockEntitlementsResolved,
  }),
}));

const mockedGet = axiosInstance.get as jest.Mock;
const PROGRESS_URL = '/api/v1/wms/opening-inventory/progress';

let progressState = 'not_started';

function recountTaskReads() {
  return mockedGet.mock.calls.filter(([url]) => url === '/api/v1/wms/recount-tasks').length;
}

function view(state: string) {
  return {
    progress: { state, total_bins: 2, complete_bins: 0, bins: [] },
    cutover: null,
    shopify_synced_at: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  progressState = 'not_started';
  mockRecountEntitled = true;
  mockEntitlementsResolved = true;
  mockedGet.mockImplementation((url: string) => {
    if (url === PROGRESS_URL) return Promise.resolve({ data: view(progressState) });
    if (url === '/api/v1/onboarding/readiness') {
      return Promise.resolve({
        data: {
          modules: [{
            moduleId: 'wms',
            tasks: [
              { id: 'map-zones', complete: true },
              { id: 'reconcile-inventory', complete: false },
            ],
            signals: [
              { name: 'wms.zonesConfigured', value: true },
              { name: 'wms.openingInventoryReconciliationRequired', value: true },
            ],
          }],
        },
      });
    }
    if (url === '/api/v1/user-state/activation-events') {
      return Promise.resolve({ data: { wave_released: false } });
    }
    if (url === '/api/v1/wms/recount-tasks') return Promise.resolve({ data: { tasks: [] } });
    if (url === '/api/v1/wms/stow-tasks') return Promise.resolve({ data: { stow_tasks: [] } });
    if (url === '/api/v1/wms/settings') return Promise.resolve({ data: { settings: null } });
    if (url === '/api/v1/suppliers/receive-jobs') return Promise.resolve({ data: { receive_jobs: [] } });
    return Promise.resolve({ data: {} });
  });
});

function renderBoth() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const auth = { user: { id: 7, role: 'owner' } } as unknown as React.ContextType<typeof AuthContext>;
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AuthContext.Provider value={auth}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </AuthContext.Provider>
  );
  return renderHook(() => ({ wms: useWms(), checklist: useActivationChecklist() }), { wrapper });
}

describe('#1164 — WMS Opening Inventory view shares the canonical progress query', () => {
  it('the Ops Console post-start re-read updates the WMS view from not_started to counting', async () => {
    const { result } = renderBoth();

    await waitFor(() =>
      expect(result.current.wms.openingInventory?.progress.state).toBe('not_started')
    );
    await waitFor(() => expect(recountTaskReads()).toBeGreaterThan(0));
    const recountReadsBefore = recountTaskReads();

    // The cohort is started elsewhere (Ops Console); the console then re-reads
    // canonical progress through the checklist hook.
    progressState = 'counting';
    await act(async () => {
      await result.current.checklist.refreshOpeningInventory();
    });

    await waitFor(() =>
      expect(result.current.wms.openingInventory?.progress.state).toBe('counting')
    );
    // The WMS recount list is re-read too, so the new cohort's countTaskId
    // deep link resolves without waiting for the 10s poll.
    expect(recountTaskReads()).toBeGreaterThan(recountReadsBefore);
  });

  it('refetchOpeningInventory re-reads the same canonical endpoint', async () => {
    const { result } = renderBoth();
    await waitFor(() => expect(result.current.wms.openingInventory).toBeTruthy());

    progressState = 'counting';
    await act(async () => {
      await result.current.wms.refetchOpeningInventory();
    });

    await waitFor(() =>
      expect(result.current.wms.openingInventory?.progress.state).toBe('counting')
    );
  });
});

// #1164 — a focused countTaskId deep link may only fail open once count-task
// state is definitive. Loading (task read or entitlements) is never settled.
describe('#1164 — recountTasksSettled', () => {
  function renderWms() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return renderHook(() => useWms(), { wrapper });
  }

  it('entitled: not settled while the task read is pending, settled once it resolves', async () => {
    let resolveTasks!: (value: unknown) => void;
    const base = mockedGet.getMockImplementation()!;
    mockedGet.mockImplementation((url: string) =>
      url === '/api/v1/wms/recount-tasks'
        ? new Promise((resolve) => { resolveTasks = resolve; })
        : base(url)
    );
    const { result } = renderWms();

    await waitFor(() => expect(recountTaskReads()).toBe(1));
    expect(result.current.recountTasksSettled).toBe(false);

    await act(async () => { resolveTasks({ data: { tasks: [] } }); });
    await waitFor(() => expect(result.current.recountTasksSettled).toBe(true));
    expect(result.current.recountLocked).toBe(false);
  });

  it('entitled: a failed task read is definitive — settled and locked', async () => {
    const base = mockedGet.getMockImplementation()!;
    mockedGet.mockImplementation((url: string) =>
      url === '/api/v1/wms/recount-tasks'
        ? Promise.reject(new Error('Recount tasks unavailable'))
        : base(url)
    );
    const { result } = renderWms();

    await waitFor(() => expect(result.current.recountTasksSettled).toBe(true));
    expect(result.current.recountLocked).toBe(true);
  });

  it('not entitled: unsettled until entitlements resolve, then settled and locked', () => {
    mockRecountEntitled = false;
    mockEntitlementsResolved = false;
    const { result, rerender } = renderWms();
    expect(result.current.recountLocked).toBe(true);
    expect(result.current.recountTasksSettled).toBe(false);

    mockEntitlementsResolved = true;
    rerender();
    expect(result.current.recountTasksSettled).toBe(true);
    expect(result.current.recountLocked).toBe(true);
  });
});

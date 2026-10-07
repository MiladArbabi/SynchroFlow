// 4b-2b GRILL-04 — WmsOperationsPage opening inventory cutover wiring.
//
// Proves only the page-level seam: HTTP lives here, WmsModuleFT2 receives
// state + callback, and the POST body carries nothing but the explicit
// acceptance boolean (never shop/user identity). Card behaviour is covered
// by OpeningInventoryCutoverCard.test.tsx.
//
// #1164: the canonical progress view is read through useWms on the shared
// ['wms','opening-inventory','progress'] query (so an Ops Console start
// refreshes this page too); the page re-reads it via refetchOpeningInventory.
//
// @lasyncro/wms is stubbed for the same structural reason documented in
// WmsOperationsPage.floorPlanningNav.test.tsx (the real WmsModuleFT2 pulls
// modules/shared `.js`-suffixed imports the frontend Jest project cannot
// resolve); the stub captures the props the page passes.
import fs from 'fs';
import path from 'path';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

let mockRole = 'owner';
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 3, role: mockRole } }),
}));

jest.mock('components/UpgradePrompt', () => ({
  UpgradePrompt: () => null,
}));

const mockRefetch = jest.fn();
const mockRefetchOpeningInventory = jest.fn();
jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] },
    isLoading: false,
    isError: false,
    refetch: mockRefetch,
    stowTasks: [],
    settings: null,
    openReceiveJobs: [],
    recountTasks: [],
    recountLocked: false,
    openingInventory: mockOpeningView,
    refetchOpeningInventory: mockRefetchOpeningInventory,
  }),
}));

jest.mock('pages/wms/useReadyToPack', () => ({
  useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }),
}));

jest.mock('pages/floor-planning/useWarehouseGrid', () => ({
  useWarehouseGrid: () => ({ data: { locations: [] } }),
}));

const mockUseSpotlight = jest.fn();
const mockOpeningSpotlightDismiss = jest.fn();
jest.mock('hooks/useSpotlight', () => ({
  useSpotlight: (key: string) => {
    mockUseSpotlight(key);
    return {
      isDismissed: false,
      isLoading: false,
      dismiss: key === 'opening_inventory_count' ? mockOpeningSpotlightDismiss : jest.fn(),
    };
  },
}));

const mockModuleProps: { current: Record<string, any> | null } = { current: null };
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: (props: Record<string, any>) => {
    mockModuleProps.current = props;
    return null;
  },
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(),
  WmsConnectionBadge: () => null,
}));

const PROGRESS_URL = '/api/v1/wms/opening-inventory/progress';
const CUTOVER_URL = '/api/v1/wms/opening-inventory/cutover';

const mockOpeningView = {
  progress: { state: 'review_required', difference_count: 2 },
  cutover: null,
  shopify_synced_at: null,
};
const VIEW = mockOpeningView;

function progressGetCount() {
  return (axiosInstance.get as jest.Mock).mock.calls.filter(([url]) => url === PROGRESS_URL).length;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/wms']}>
      <WmsOperationsPage />
    </MemoryRouter>, { wrapper: alertsQueryWrapper() });
}

describe('WmsOperationsPage — opening inventory cutover wiring', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRole = 'owner';
    mockModuleProps.current = null;
    (axiosInstance.get as jest.Mock).mockImplementation((url: string) =>
      Promise.resolve({ data: url === PROGRESS_URL ? VIEW : {} })
    );
    (axiosInstance.post as jest.Mock).mockResolvedValue({ data: { status: 'complete' } });
  });

  test('canonical view (from the shared useWms query) + callback passed to WmsModuleFT2; no page-local GET', async () => {
    renderPage();

    await waitFor(() => expect(mockModuleProps.current?.openingInventory).toEqual(VIEW));
    // #1164: no second, page-local copy of the progress view.
    expect(progressGetCount()).toBe(0);
    expect(mockModuleProps.current?.canApproveOpeningInventoryCutover).toBe(true);
    expect(typeof mockModuleProps.current?.onApproveOpeningInventoryCutover).toBe('function');
  });

  test.each([true, false])(
    'POST body is exactly { accept_physical_truth: %s } — no shop/user identity — then refreshes',
    async (accept) => {
      renderPage();
      await waitFor(() => expect(mockModuleProps.current?.openingInventory).toEqual(VIEW));

      await act(async () => {
        await mockModuleProps.current?.onApproveOpeningInventoryCutover(accept);
      });

      expect(axiosInstance.post).toHaveBeenCalledTimes(1);
      expect(axiosInstance.post).toHaveBeenCalledWith(CUTOVER_URL, { accept_physical_truth: accept });
      expect(mockRefetchOpeningInventory).toHaveBeenCalledTimes(1);
      expect(mockRefetch).toHaveBeenCalled();
    }
  );

  test('count-finished callback refreshes opening inventory progress', async () => {
    renderPage();
    await waitFor(() => expect(mockModuleProps.current).not.toBeNull());
    expect(mockRefetchOpeningInventory).not.toHaveBeenCalled();

    await act(async () => {
      mockModuleProps.current?.onCountFinished('Bin A-01');
    });

    await waitFor(() => expect(mockRefetchOpeningInventory).toHaveBeenCalledTimes(1));
  });

  test('#1164: Opening Inventory count Spotlight uses the persisted useSpotlight convention', async () => {
    renderPage();
    await waitFor(() => expect(mockModuleProps.current).not.toBeNull());

    expect(mockUseSpotlight).toHaveBeenCalledWith('opening_inventory_count');
    const injected = mockModuleProps.current?.openingInventorySpotlight;
    expect(injected?.isDismissed).toBe(false);
    injected?.dismiss();
    expect(mockOpeningSpotlightDismiss).toHaveBeenCalledTimes(1);
  });

  test('#1164: the Spotlight key is registered in the server-side dismissal allow-list', () => {
    // An unregistered key 400s on dismiss and the mark rolls back into view
    // (see useSpotlight onError), so registration is part of persistence.
    const controller = fs.readFileSync(
      path.resolve(__dirname, '../../../../apps/backend/src/api/user-state/user-state.controller.ts'),
      'utf8'
    );
    const allowList = controller.match(/const VALID_SPOTLIGHT_KEYS = new Set\(\[([\s\S]*?)\]\);/)?.[1] ?? '';
    expect(allowList).toMatch(/'opening_inventory_count'/);
  });

  test('failed POST surfaces the server error message to the module', async () => {
    (axiosInstance.post as jest.Mock).mockRejectedValue({
      response: { status: 409, data: { code: 'OPENING_CUTOVER_LOCATION', error: 'Shopify location mapping missing' } },
    });
    renderPage();
    await waitFor(() => expect(mockModuleProps.current?.openingInventory).toEqual(VIEW));

    await act(async () => {
      await mockModuleProps.current?.onApproveOpeningInventoryCutover(false);
    });

    expect(mockModuleProps.current?.openingInventoryCutoverError).toBe('Shopify location mapping missing');
    expect(mockModuleProps.current?.openingInventoryCutoverSubmitting).toBe(false);
  });

  test('operator: canApproveOpeningInventoryCutover is false', async () => {
    mockRole = 'operator';
    renderPage();
    await waitFor(() => expect(mockModuleProps.current?.openingInventory).toEqual(VIEW));
    expect(mockModuleProps.current?.canApproveOpeningInventoryCutover).toBe(false);
  });
});

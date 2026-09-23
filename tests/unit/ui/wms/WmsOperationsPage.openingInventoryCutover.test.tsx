// 4b-2b GRILL-04 — WmsOperationsPage opening inventory cutover wiring.
//
// Proves only the page-level seam: HTTP lives here, WmsModuleFT2 receives
// state + callback, and the POST body carries nothing but the explicit
// acceptance boolean (never shop/user identity). Card behaviour is covered
// by OpeningInventoryCutoverCard.test.tsx.
//
// @lasyncro/wms is stubbed for the same structural reason documented in
// WmsOperationsPage.floorPlanningNav.test.tsx (the real WmsModuleFT2 pulls
// modules/shared `.js`-suffixed imports the frontend Jest project cannot
// resolve); the stub captures the props the page passes.
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

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

const VIEW = {
  progress: { state: 'review_required', difference_count: 2 },
  cutover: null,
  shopify_synced_at: null,
};

function progressGetCount() {
  return (axiosInstance.get as jest.Mock).mock.calls.filter(([url]) => url === PROGRESS_URL).length;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/wms']}>
      <WmsOperationsPage />
    </MemoryRouter>
  );
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

  test('GET progress on load and view + callback passed to WmsModuleFT2', async () => {
    renderPage();

    await waitFor(() => expect(mockModuleProps.current?.openingInventory).toEqual(VIEW));
    expect(progressGetCount()).toBe(1);
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
      expect(progressGetCount()).toBe(2);
      expect(mockRefetch).toHaveBeenCalled();
    }
  );

  test('count-finished callback refreshes opening inventory progress', async () => {
    renderPage();
    await waitFor(() => expect(progressGetCount()).toBe(1));

    await act(async () => {
      mockModuleProps.current?.onCountFinished('Bin A-01');
    });

    await waitFor(() => expect(progressGetCount()).toBe(2));
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

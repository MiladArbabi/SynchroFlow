/** PACK-CTX-01 — real session callback and real HTTP adapter boundaries. */
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PackSessionPage from '../../../../modules/wms/src/ui/pages/PackSessionPage';
import type { PackFreeScanResult } from '../../../../modules/wms/src/ui/pages/WmsModuleFT2';
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

// Same adapter isolation as WmsOperationsPage.receive-reassign-1143.test.tsx.
// Neither PackSessionPage nor the page's Pack request adapter is mocked.
const mockModuleProps: { current: Record<string, any> | null } = { current: null };
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, role: 'owner' } }) }));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useWms', () => ({ useWms: () => ({
  data: { batches: [] }, isLoading: false, isError: false, refetch: jest.fn(),
  stowTasks: [], settings: null, openReceiveJobs: [], recountTasks: [], recountLocked: false,
}) }));
jest.mock('pages/wms/useReadyToPack', () => ({ useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }) }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({ useWarehouseGrid: () => ({ data: { locations: [] } }) }));
jest.mock('hooks/useSpotlight', () => ({ useSpotlight: () => ({ isDismissed: true, isLoading: false, dismiss: jest.fn() }) }));
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: (props: Record<string, any>) => { mockModuleProps.current = props; return null; },
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: jest.fn() }),
  useWebPush: jest.fn(), WmsConnectionBadge: () => null,
}));

const ORDER_A = '2de3e882-385a-49d9-a721-dd79b660539e';
const initial: PackFreeScanResult = {
  type: 'unit_resolved', pick_batch_id: 'batch-a', lasyncro_unit_id: 'LSU-A',
  lasyncro_order_id: ORDER_A, order_complete: true, auto_claimed: true,
  has_carrier_label: false, variant: null, order: null,
  line_items: [{
    lasyncro_line_item_id: 'line-a', lasyncro_variant_id: 'variant-a',
    product_title: 'Fixture item', quantity: 1, image_url: null, sku: null,
    pack_scanned: true, has_tracked_unit: true,
  }],
};
const post = axiosInstance.post as jest.Mock;
beforeEach(() => {
  mockModuleProps.current = null;
  jest.clearAllMocks();
  post.mockResolvedValue({ data: initial });
});

it('active Pack session supplies A as expected context for subsequent LSU and LSO calls', async () => {
  // A mock accepting arbitrary arguments is assignable to the current one-arg
  // production prop. The RED checks call evidence without changing its type.
  const scan = jest.fn().mockResolvedValue(initial);
  render(<PackSessionPage initialFreeScanResult={initial} onPackFreeScan={scan}
    onPackCountConfirm={jest.fn()} onPrintInvoice={jest.fn().mockResolvedValue(undefined)}
    onPrintLabel={jest.fn().mockResolvedValue(undefined)} onCreateProblemTask={jest.fn()}
    onComplete={jest.fn()} />);
  const input = screen.getByRole('textbox');
  await act(async () => {
    fireEvent.change(input, { target: { value: 'LSU-B' } });
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  await waitFor(() => expect(input).not.toBeDisabled());
  await act(async () => {
    fireEvent.change(input, { target: { value: 'LSO-B' } });
    fireEvent.keyDown(input, { key: 'Enter' });
  });
  expect(scan.mock.calls).toEqual([['LSU-B', ORDER_A], ['LSO-B', ORDER_A]]);
});

function renderAdapter() {
  render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: alertsQueryWrapper() });
  expect(typeof mockModuleProps.current?.onPackFreeScan).toBe('function');
}

it('HTTP adapter forwards active expected order as a constraint alongside the scanned barcode', async () => {
  renderAdapter();
  await mockModuleProps.current!.onPackFreeScan('LSU-B', ORDER_A);
  expect(post).toHaveBeenCalledWith('/api/v1/wms/pack/free-scan', {
    scanned_value: 'LSU-B', expected_lasyncro_order_id: ORDER_A,
  });
});

it('initial outer acquisition sends the barcode without inventing expected context', async () => {
  renderAdapter();
  await mockModuleProps.current!.onPackFreeScan('LSU-A');
  expect(post).toHaveBeenCalledWith('/api/v1/wms/pack/free-scan', { scanned_value: 'LSU-A' });
});

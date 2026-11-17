/**
 * SF-PICK-ASSIGN-01 — web rejected offline scans on the real WmsOperationsPage.
 * The offline queue hook is the seam (same stub pattern as the other page
 * tests): refused scans must be visible with their details and leave only on
 * an explicit operator acknowledgement.
 */
import React from 'react';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn().mockResolvedValue({ data: {} }), post: jest.fn(), patch: jest.fn() },
}));
jest.mock('contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, role: 'operator' } }) }));
jest.mock('components/UpgradePrompt', () => ({ UpgradePrompt: () => null }));
jest.mock('pages/wms/useWms', () => ({
  useWms: () => ({
    data: { batches: [] }, isLoading: false, isError: false, refetch: jest.fn(), stowTasks: [], settings: null,
    openReceiveJobs: [], recountTasks: [], recountLocked: false, recountTasksSettled: true,
    openingInventory: null, refetchOpeningInventory: jest.fn(),
  }),
}));
jest.mock('pages/wms/useReadyToPack', () => ({ useReadyToPack: () => ({ data: { orders: [], orderCount: 0 } }) }));
jest.mock('pages/floor-planning/useWarehouseGrid', () => ({ useWarehouseGrid: () => ({ data: { locations: [] } }) }));
jest.mock('hooks/useSpotlight', () => ({ useSpotlight: () => ({ isDismissed: true, isLoading: false, dismiss: jest.fn() }) }));

const mockQueue: { current: Record<string, unknown> } = { current: {} };
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: () => null,
  useOfflineScanQueue: () => mockQueue.current,
  useWebPush: jest.fn(),
  WmsConnectionBadge: () => null,
}));

const rejected = {
  id: 'evt-1',
  url: '/api/v1/wms/pick/scan',
  method: 'POST',
  body: JSON.stringify({ pick_batch_id: 'abcd1234-0000-4000-8000-000000000001', pick_claim_generation: 'g1' }),
  queuedAt: 1,
  rejected: { status: 409, code: 'PICK_OWNERSHIP_REVOKED', error: 'Batch owned by different operator', at: 2 },
};

function renderPage() {
  return render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
}

test('WR-01 refused offline scans are visible with their details and leave only on explicit acknowledgement', async () => {
  const dismiss = jest.fn().mockResolvedValue(undefined);
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [rejected], dismissRejectedScan: dismiss };
  renderPage();
  const warning = await screen.findByTestId('rejected-offline-scans');
  expect(within(warning).getByText('1 offline scan could not be confirmed')).toBeInTheDocument();
  expect(within(warning).getByText(/Batch ABCD1234: Batch owned by different operator/)).toBeInTheDocument();
  expect(within(warning).getByText(/check them with your supervisor/i)).toBeInTheDocument();
  expect(dismiss).not.toHaveBeenCalled();
  fireEvent.click(within(warning).getByRole('button', { name: 'Reviewed — dismiss' }));
  expect(dismiss).toHaveBeenCalledWith('evt-1');
});

test('WR-02 no warning when nothing was refused (and hosts without the field render unchanged)', async () => {
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn() };
  renderPage();
  await Promise.resolve();
  expect(screen.queryByTestId('rejected-offline-scans')).not.toBeInTheDocument();
});

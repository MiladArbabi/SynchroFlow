/**
 * SF-PICK-ASSIGN-01 C011 (NEW-1) — WmsOperationsPage: when a refused offline
 * scan cannot be dismissed because its review was not recorded, the scan stays
 * listed and the operator sees an actionable error (previously the failure was
 * swallowed). The offline queue hook is the seam (same stub pattern as WR-*).
 */
import React from 'react';
import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  rejected: { status: 409, code: 'PICK_GENERATION_STALE', error: 'This Pick session is no longer current', at: 2 },
};

test('WP-01 a dismissal whose review was not recorded keeps the scan listed and shows an actionable error', async () => {
  const dismiss = jest.fn().mockRejectedValue(new Error('Network Error'));
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [rejected], dismissRejectedScan: dismiss };
  render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
  const warning = await screen.findByTestId('rejected-offline-scans');
  expect(warning.textContent ?? '').not.toMatch(/not recorded/i);
  fireEvent.click(within(warning).getByRole('button', { name: 'Reviewed — dismiss' }));
  await waitFor(() => expect(within(warning).getByText(/review could not be recorded.*kept on this device.*Try again when connected/i)).toBeInTheDocument());
  expect(dismiss).toHaveBeenCalledWith('evt-1');
  expect(within(warning).getByText(/This Pick session is no longer current/)).toBeInTheDocument();
});

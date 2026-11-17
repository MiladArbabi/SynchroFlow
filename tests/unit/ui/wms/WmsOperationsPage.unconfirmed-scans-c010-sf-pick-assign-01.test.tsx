/**
 * SF-PICK-ASSIGN-01 C010 (REVIEW-006 F2) — generation-less historical web Pick
 * scans on the real WmsOperationsPage: shown as "Unconfirmed" (never as "not
 * recorded"), and removed only through the explicit, audited review action.
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

const unconfirmed = {
  id: 'evt-old',
  url: '/api/v1/wms/pick/scan',
  method: 'POST',
  body: JSON.stringify({ pick_batch_id: 'feed0001-0000-4000-8000-000000000001', lasyncro_line_item_id: 'li', quantity_confirmed: 1 }),
  queuedAt: 1_699_999_000_000,
};

function renderPage() {
  return render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
}

test('WU-01 unconfirmed scans are visible, labelled Unconfirmed, and never described as not recorded', async () => {
  const review = jest.fn().mockResolvedValue(undefined);
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [], unconfirmedScans: [unconfirmed], reviewUnconfirmedScan: review };
  renderPage();
  const panel = await screen.findByTestId('unconfirmed-offline-scans');
  expect(within(panel).getByText('Unconfirmed: 1 earlier offline scan')).toBeInTheDocument();
  expect(within(panel).getByText(/Batch FEED0001/)).toBeInTheDocument();
  expect(panel.textContent ?? '').not.toMatch(/not recorded/i);
  expect(review).not.toHaveBeenCalled();
});

test('WU-02 the review action is explicit and calls the audited review for that entry only', async () => {
  const review = jest.fn().mockResolvedValue(undefined);
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [], unconfirmedScans: [unconfirmed], reviewUnconfirmedScan: review };
  renderPage();
  const panel = await screen.findByTestId('unconfirmed-offline-scans');
  fireEvent.click(within(panel).getByRole('button', { name: 'Reviewed with supervisor — remove' }));
  await waitFor(() => expect(review).toHaveBeenCalledWith('evt-old'));
});

test('WU-03 a failed review keeps the entry and says so', async () => {
  // C012 FINAL-UX-006: an actual Axios network failure (isAxiosError, no response).
  const review = jest.fn().mockRejectedValue(Object.assign(new Error('Network Error'), { isAxiosError: true }));
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [], unconfirmedScans: [unconfirmed], reviewUnconfirmedScan: review };
  renderPage();
  const panel = await screen.findByTestId('unconfirmed-offline-scans');
  fireEvent.click(within(panel).getByRole('button', { name: 'Reviewed with supervisor — remove' }));
  expect(await within(panel).findByText(/could not be recorded.*kept on this device/i)).toBeInTheDocument();
});

test('WU-04 hosts without the field render no panel', async () => {
  mockQueue.current = { isOnline: true, queuedCount: 0, submitScan: jest.fn() };
  renderPage();
  await Promise.resolve();
  expect(screen.queryByTestId('unconfirmed-offline-scans')).not.toBeInTheDocument();
});

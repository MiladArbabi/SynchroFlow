/**
 * SF-PICK-ASSIGN-01 C012 (UX-TRUTH-004, F-A) — WmsOperationsPage: the message
 * after a failed review of an unconfirmed (historical) scan names the actual
 * cause. A local storage failure is never reported as lost connectivity or as
 * an unrecorded review; 401, no answer and server errors stay distinct. No
 * re-scan instruction. Harness identical to WmsOperationsPage.local-failure-c012.
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
  id: 'evt-1',
  url: '/api/v1/wms/pick/scan',
  method: 'POST',
  body: JSON.stringify({ pick_batch_id: 'abcd1234-0000-4000-8000-000000000001' }),
  queuedAt: 1,
};
const storageFailure = () =>
  Object.assign(new Error('This device could not update its saved scans.'), { code: 'SCAN_QUEUE_STORAGE_FAILED' });
const httpFailure = (status: number) =>
  Object.assign(new Error(String(status)), { isAxiosError: true, response: { status, data: {} } });

async function messageFor(error: Error) {
  mockQueue.current = {
    isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [],
    dismissRejectedScan: jest.fn(), unconfirmedScans: [unconfirmed],
    reviewUnconfirmedScan: jest.fn().mockRejectedValue(error),
  };
  const view = render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
  const notice = await screen.findByTestId('unconfirmed-offline-scans');
  fireEvent.click(within(notice).getByRole('button', { name: 'Reviewed with supervisor — remove' }));
  await waitFor(() => expect(within(notice).getByText(/kept on this device/i)).toBeInTheDocument());
  const text = within(notice).getByText(/kept on this device/i).textContent ?? '';
  view.unmount();
  return text;
}

test('WU-P1 a local storage failure is not reported as lost connectivity or an unrecorded review', async () => {
  const text = await messageFor(storageFailure());
  expect(text).toMatch(/could not (finish|update)/i);
  expect(text).toMatch(/supervisor/i);
  expect(text).not.toMatch(/when connected|connection/i);
  expect(text).not.toMatch(/review could not be recorded/i);
  expect(text).not.toMatch(/scan (the item|it) again/i);
});

test('WU-P2 401 asks the operator to sign in again', async () => {
  const text = await messageFor(httpFailure(401));
  expect(text).toMatch(/review could not be recorded/i);
  expect(text).toMatch(/sign in again/i);
  expect(text).not.toMatch(/when connected/i);
});

test('WU-P3 no answer at all waits for the connection', async () => {
  const text = await messageFor(Object.assign(new Error('Network Error'), { isAxiosError: true }));
  expect(text).toMatch(/review could not be recorded/i);
  expect(text).toMatch(/when connected/i);
});

test('WU-P4 a server error is not reported as lost connectivity', async () => {
  const text = await messageFor(httpFailure(500));
  expect(text).toMatch(/review could not be recorded/i);
  expect(text).toMatch(/try again in a moment/i);
  expect(text).toMatch(/supervisor/i);
  expect(text).not.toMatch(/when connected|connection/i);
  expect(text).not.toMatch(/scan (the item|it) again/i);
});

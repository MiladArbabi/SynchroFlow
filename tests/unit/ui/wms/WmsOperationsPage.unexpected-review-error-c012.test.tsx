/**
 * SF-PICK-ASSIGN-01 C012 (FINAL-UX-006) — WmsOperationsPage: an unexpected
 * local error from reviewing an unconfirmed scan (for example the hook's
 * "This scan is not awaiting review.") is not a connectivity failure. The
 * operator is not told to wait for a connection, no review outcome is claimed,
 * and there is no re-scan instruction. A genuine no-answer network failure
 * still waits for the connection. Harness identical to
 * WmsOperationsPage.unconfirmed-local-failure-c012.
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

// The error line only: the notice's own intro mentions a connection and the supervisor.
const ERROR_TEXT = /reload|when connected|sign in again|try again/i;

async function messageFor(error: Error) {
  mockQueue.current = {
    isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [],
    dismissRejectedScan: jest.fn(), unconfirmedScans: [unconfirmed],
    reviewUnconfirmedScan: jest.fn().mockRejectedValue(error),
  };
  const view = render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
  const notice = await screen.findByTestId('unconfirmed-offline-scans');
  fireEvent.click(within(notice).getByRole('button', { name: 'Reviewed with supervisor — remove' }));
  await waitFor(() => expect(within(notice).getByText(ERROR_TEXT)).toBeInTheDocument());
  const text = within(notice).getByText(ERROR_TEXT).textContent ?? '';
  view.unmount();
  return text;
}

test('WU-U1 an unexpected local error is not reported as lost connectivity', async () => {
  const text = await messageFor(new Error('This scan is not awaiting review.'));
  expect(text).not.toMatch(/when connected|connection/i);
  expect(text).not.toMatch(/review could not be recorded|review (was|has been) recorded/i);
  expect(text).toMatch(/reload/i);
  expect(text).toMatch(/supervisor/i);
  expect(text).toMatch(/do not re-scan/i);
});

test('WU-U2 a genuine no-answer network failure still waits for the connection', async () => {
  const text = await messageFor(Object.assign(new Error('Network Error'), { isAxiosError: true }));
  expect(text).toMatch(/review could not be recorded/i);
  expect(text).toMatch(/when connected/i);
});

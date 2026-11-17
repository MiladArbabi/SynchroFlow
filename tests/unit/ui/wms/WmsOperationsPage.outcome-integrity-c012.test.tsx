/**
 * SF-PICK-ASSIGN-01 C012 (OUTCOME-INTEGRITY) — WmsOperationsPage: the message
 * shown when a review could not be recorded matches the actual cause. Only a
 * connection failure says "when connected"; an expired sign-in says to sign in
 * again; a server failure says to retry and when to involve the supervisor.
 * The offline queue hook is the seam (same stub pattern as WP-01).
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
  rejected: { status: 409, code: 'PICK_SCAN_OUTCOME_UNCERTAIN', error: 'This pick may already have been recorded.', at: 2 },
};
const httpError = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { isAxiosError: true, response: { status, data: {} } });

async function dismissWith(error: Error) {
  mockQueue.current = {
    isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [rejected],
    dismissRejectedScan: jest.fn().mockRejectedValue(error),
  };
  const view = render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
  const warning = await screen.findByTestId('rejected-offline-scans');
  fireEvent.click(within(warning).getByRole('button', { name: 'Reviewed — dismiss' }));
  await waitFor(() => expect(within(warning).getByText(/review could not be recorded/i)).toBeInTheDocument());
  const text = within(warning).getByText(/review could not be recorded/i).textContent ?? '';
  view.unmount();
  return text;
}

test('WO-P1 an expired sign-in says to sign in again, not to wait for a connection', async () => {
  const text = await dismissWith(httpError(401));
  expect(text).toMatch(/kept on this device/);
  expect(text).toMatch(/sign in again/i);
  expect(text).not.toMatch(/when connected/i);
});

test('WO-P2 a server failure says to retry and when to involve the supervisor, not to wait for a connection', async () => {
  const text = await dismissWith(httpError(500));
  expect(text).toMatch(/kept on this device/);
  expect(text).toMatch(/keeps failing.*supervisor/i);
  expect(text).not.toMatch(/when connected/i);
});

test('WO-P3 a connection failure still says to try again when connected', async () => {
  const text = await dismissWith(Object.assign(new Error('Network Error'), { isAxiosError: true, request: {}, response: undefined }));
  expect(text).toMatch(/kept on this device.*when connected/i);
});

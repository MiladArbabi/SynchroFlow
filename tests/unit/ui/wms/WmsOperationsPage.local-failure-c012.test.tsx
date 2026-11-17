/**
 * SF-PICK-ASSIGN-01 C012 (FINAL-CLOSURE, LOW-2) — WmsOperationsPage: when this
 * device's own scan storage fails during a dismissal, the message says so
 * (the scan is kept; this device could not finish), never "when connected"
 * and never that the review was not recorded. No re-scan instruction.
 * Harness identical to WmsOperationsPage.outcome-integrity-c012 (WO-P*).
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
const storageFailure = () =>
  Object.assign(new Error('This device could not update its saved scans.'), { code: 'SCAN_QUEUE_STORAGE_FAILED' });

async function messageFor(error: Error) {
  mockQueue.current = {
    isOnline: true, queuedCount: 0, submitScan: jest.fn(), rejectedScans: [rejected],
    dismissRejectedScan: jest.fn().mockRejectedValue(error),
  };
  const view = render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
  const warning = await screen.findByTestId('rejected-offline-scans');
  fireEvent.click(within(warning).getByRole('button', { name: 'Reviewed — dismiss' }));
  await waitFor(() => expect(within(warning).getByText(/kept on this device/i)).toBeInTheDocument());
  const text = within(warning).getByText(/kept on this device/i).textContent ?? '';
  view.unmount();
  return text;
}

test('WL-P1 a local storage failure is not reported as lost connectivity or an unrecorded review', async () => {
  const text = await messageFor(storageFailure());
  expect(text).toMatch(/kept on this device/i);
  expect(text).toMatch(/could not (finish|update)/i);
  expect(text).toMatch(/supervisor/i);
  expect(text).not.toMatch(/when connected|connection/i);
  expect(text).not.toMatch(/review could not be recorded/i);
  expect(text).not.toMatch(/scan (the item|it) again/i);
});

test('WL-P2 the specific 401 handling is unchanged', async () => {
  const text = await messageFor(Object.assign(new Error('401'), { isAxiosError: true, response: { status: 401, data: {} } }));
  expect(text).toMatch(/sign in again/i);
  expect(text).not.toMatch(/when connected/i);
});

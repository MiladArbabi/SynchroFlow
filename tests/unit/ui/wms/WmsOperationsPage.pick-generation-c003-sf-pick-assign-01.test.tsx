/**
 * SF-PICK-ASSIGN-01 Correction 003 (REVIEW-001 M2) — web Pick write callbacks
 * on the real WmsOperationsPage. Consequential writes (scan, exception,
 * completion, custody ack) must never POST /claim: a missing generation is
 * restored through the read-only GET pick-session, the cache survives
 * unrelated 409s and is dropped only on ownership/generation refusals.
 */
import React from 'react';
import type { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import WmsOperationsPage from 'pages/ft2-pages/WmsOperationsPage';
import { axiosInstance } from 'api/axiosConfig';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(['alerts', { status: 'inbox' }], { data: [], meta: { total: 0, status: 'inbox' } });
  return function W({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn() },
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

const mockProps: { current: Record<string, any> } = { current: {} };
const mockSubmitScan = jest.fn();
jest.mock('@lasyncro/wms', () => ({
  WmsModuleFT2: (props: Record<string, any>) => { mockProps.current = props; return null; },
  useOfflineScanQueue: () => ({ isOnline: true, queuedCount: 0, submitScan: mockSubmitScan, rejectedScans: [], dismissRejectedScan: jest.fn() }),
  useWebPush: jest.fn(),
  WmsConnectionBadge: () => null,
}));

const BATCH = 'abcd1234-0000-4000-8000-000000000001';
const get = axiosInstance.get as jest.Mock;
const post = axiosInstance.post as jest.Mock;
const refusal = (code: string) => Object.assign(new Error(code), { response: { status: 409, data: { code, error: code } } });
const claimCalls = () => post.mock.calls.filter(([url]) => String(url).endsWith('/claim'));
const sessionCalls = () => get.mock.calls.filter(([url]) => String(url).endsWith('/pick-session'));
const scanParams = { lasyncro_line_item_id: 'li', lasyncro_variant_id: 'v', quantity_confirmed: 1, location_code: 'A1' };

async function renderPage() {
  render(<MemoryRouter initialEntries={['/wms']}><WmsOperationsPage /></MemoryRouter>, { wrapper: wrapper() });
  await waitFor(() => expect(mockProps.current.onConfirmScan).toBeDefined());
  return mockProps.current;
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  mockSubmitScan.mockReset();
  get.mockImplementation(async (url: string) =>
    String(url).endsWith('/pick-session') ? { data: { pick_claim_generation: 'g-resumed' } } : { data: {} });
  post.mockResolvedValue({ data: {} });
  mockSubmitScan.mockResolvedValue(undefined);
});

// C010 (REVIEW-006 F1) supersedes the C003 contract "restored read-only":
// a missing generation is never adopted from pick-session.
test('WG-01 no Pick write ever calls POST /claim; a missing generation is refused, never adopted', async () => {
  const props = await renderPage();
  for (const write of [
    () => props.onConfirmScan(BATCH, scanParams),
    () => props.onReportException(BATCH, { stage: 'pick' }),
    () => props.onAcknowledgePickCustody(BATCH),
    () => props.onPickComplete(BATCH),
  ]) {
    await expect(write()).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_REQUIRED' } } });
  }
  expect(claimCalls()).toHaveLength(0);
  expect(sessionCalls()).toHaveLength(0);
  expect(mockSubmitScan).not.toHaveBeenCalled();
  expect(post.mock.calls.find(([url]) => String(url).endsWith('/exception'))).toBeUndefined();
});

test('WG-02 the explicit claim is the only POST /claim, and its generation is used without a resume read', async () => {
  post.mockImplementation(async (url: string) =>
    String(url).endsWith('/claim') ? { data: { pick_claim_generation: 'g-claimed', custody_ack_required: false } } : { data: {} });
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  await props.onConfirmScan(BATCH, scanParams);
  expect(claimCalls()).toHaveLength(1);
  expect(sessionCalls()).toHaveLength(0);
  expect(mockSubmitScan.mock.calls[0][0].body.pick_claim_generation).toBe('g-claimed');
});

test('WG-03 an unrelated 409 keeps the cached generation', async () => {
  // C010 (F1): the generation comes from the explicit claim (no read-only adoption).
  post.mockImplementation(async (url: string) =>
    String(url).endsWith('/claim') ? { data: { pick_claim_generation: 'g-claimed' } } : { data: {} });
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  mockSubmitScan.mockRejectedValueOnce(refusal('INSUFFICIENT_ON_HAND'));
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toThrow();
  await props.onConfirmScan(BATCH, scanParams);
  expect(mockSubmitScan.mock.calls[1][0].body.pick_claim_generation).toBe('g-claimed');
  expect(sessionCalls()).toHaveLength(0);
  expect(claimCalls()).toHaveLength(1);
});

// C010 (F1): after the refusal the dropped generation is never re-read and adopted.
test('WG-04 an ownership refusal drops the generation; the next write is refused (never re-adopted, never claims)', async () => {
  post.mockImplementation(async (url: string) =>
    String(url).endsWith('/claim') ? { data: { pick_claim_generation: 'g-claimed' } } : { data: {} });
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  mockSubmitScan.mockRejectedValueOnce(refusal('PICK_GENERATION_STALE'));
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toThrow();

  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toMatchObject({
    response: { data: { code: 'PICK_GENERATION_REQUIRED' } },
  });
  expect(sessionCalls()).toHaveLength(0);
  expect(claimCalls()).toHaveLength(1);
  expect(mockSubmitScan).toHaveBeenCalledTimes(1);
});

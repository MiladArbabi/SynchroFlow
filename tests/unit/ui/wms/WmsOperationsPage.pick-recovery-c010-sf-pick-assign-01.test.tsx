/**
 * SF-PICK-ASSIGN-01 C010 (REVIEW-006 F1, R4) — web Pick recovery on the real
 * WmsOperationsPage. Recovery verifies the generation this page HOLDS
 * (X-Pick-Claim-Generation); it never adopts a different or missing one and
 * never claims. Fresh entry is the explicit claim.
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
const heldHeader = (call: unknown[]) => (call[1] as { headers?: Record<string, string> } | undefined)?.headers?.['X-Pick-Claim-Generation'];
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


const claimWith = (gen: string, custody = false) =>
  post.mockImplementation(async (url: string) =>
    String(url).endsWith('/claim') ? { data: { pick_claim_generation: gen, custody_ack_required: custody } } : { data: {} });

test('WF1-01 reconnect after A→B→A (B picked nothing): the held generation is refused and never replaced', async () => {
  claimWith('g1');
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  // Meanwhile B took over and A took it back elsewhere: the server's current generation is g3.
  get.mockImplementation(async (url: string, cfg?: { headers?: Record<string, string> }) => {
    if (!String(url).endsWith('/pick-session')) return { data: {} };
    if (cfg?.headers?.['X-Pick-Claim-Generation'] !== 'g3') throw refusal('PICK_GENERATION_STALE');
    return { data: { pick_claim_generation: 'g3' } };
  });
  await expect(props.onRevalidatePickOwnership(BATCH)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_STALE' } } });
  expect(heldHeader(sessionCalls()[0])).toBe('g1');
  // The stale session cannot write with either generation afterwards.
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toBeTruthy();
  expect(mockSubmitScan).not.toHaveBeenCalled();
  expect(claimCalls()).toHaveLength(1);                     // only the original explicit claim
});

test('WF1-02 same-generation recovery succeeds and keeps the held generation', async () => {
  claimWith('g1');
  get.mockImplementation(async (url: string) =>
    String(url).endsWith('/pick-session') ? { data: { pick_claim_generation: 'g1' } } : { data: {} });
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  await props.onRevalidatePickOwnership(BATCH);
  expect(heldHeader(sessionCalls()[0])).toBe('g1');
  await props.onConfirmScan(BATCH, scanParams);
  expect(mockSubmitScan.mock.calls[0][0].body.pick_claim_generation).toBe('g1');
});

test('WF1-03 a server answer carrying a different generation is never adopted', async () => {
  claimWith('g1');
  get.mockImplementation(async (url: string) =>
    String(url).endsWith('/pick-session') ? { data: { pick_claim_generation: 'g-other' } } : { data: {} });
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  await expect(props.onRevalidatePickOwnership(BATCH)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_STALE' } } });
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toBeTruthy();
  expect(mockSubmitScan).not.toHaveBeenCalled();
});

test('WF1-04 missing held generation (e.g. after reload): writes are refused visibly, nothing adopted or claimed', async () => {
  const props = await renderPage();
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_REQUIRED' } } });
  await expect(props.onRevalidatePickOwnership(BATCH)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_REQUIRED' } } });
  expect(sessionCalls().every((c) => heldHeader(c) === undefined ? false : true)).toBe(true);
  expect(mockSubmitScan).not.toHaveBeenCalled();
  expect(claimCalls()).toHaveLength(0);
});

test('WF1-05 lost connection keeps the held generation for recovery (no answer → still paused)', async () => {
  claimWith('g1');
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  get.mockImplementation(async () => { throw Object.assign(new Error('Network Error'), { request: {} }); });
  await expect(props.onRevalidatePickOwnership(BATCH)).rejects.toMatchObject({ code: 'PICK_CONNECTION_LOST' });
  get.mockImplementation(async (url: string) =>
    String(url).endsWith('/pick-session') ? { data: { pick_claim_generation: 'g1' } } : { data: {} });
  await props.onRevalidatePickOwnership(BATCH);
  expect(sessionCalls().map(heldHeader)).toEqual(['g1', 'g1']);
});

test('WR4-01 reload with custody pending: the explicit claim reports it and the ack uses the claimed generation', async () => {
  claimWith('g-take', true);
  const props = await renderPage();
  const result = await props.onClaimBatch(BATCH);
  expect(result).toMatchObject({ custody_ack_required: true });
  await props.onAcknowledgePickCustody(BATCH);
  const ackCall = post.mock.calls.find(([url]) => String(url).endsWith('/custody-ack'));
  expect(ackCall?.[1]).toEqual({ pick_claim_generation: 'g-take' });
  expect(sessionCalls()).toHaveLength(0);
});

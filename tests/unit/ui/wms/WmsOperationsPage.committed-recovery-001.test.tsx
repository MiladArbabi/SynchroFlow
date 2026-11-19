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
import { readPendingPick } from '../../../../modules/wms/src/ui/pickPendingRecovery';
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
jest.mock('contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 3, shop_id: 1, role: 'operator' } }) }));
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
  ...jest.requireActual('../../../../modules/wms/src/ui/pickPendingRecovery'),
  isUncertainPickOutcome: jest.requireActual('../../../../modules/wms/src/ui/pages/PickSessionPage').isUncertainPickOutcome,
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

let heldLock = false;
beforeEach(() => {
  localStorage.clear(); heldLock = false;
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: async (_key: string, _options: any, run: any) => {
    if (heldLock) return run(null); heldLock = true; try { return await run({ name: _key }); } finally { heldLock = false; }
  } } });
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

const item = { lasyncro_line_item_id: 'li', lasyncro_variant_id: 'v', reservation_allocation_id: 'alloc', product_title: 'Product', quantity: 1, location_code: 'A1' };
const params = { ...scanParams, reservation_allocation_id: 'alloc', device_event_id: 'original-request', lasyncro_unit_ids: ['LSU-A'], recovery_item: item };
const timeout = { response: { status: 504, data: { error: 'Gateway timeout' } } };
async function claimed() {
  post.mockImplementation(async () => ({ data: { pick_claim_generation: 'original-generation' } }));
  const p = await renderPage(); await p.onClaimBatch(BATCH); return p;
}
test('write-ahead fence contains exact original body BEFORE transport, and blocks another submission/tab', async () => {
  const p = await claimed(); let finish!: () => void;
  mockSubmitScan.mockImplementation(async (request: any) => {
    const stored = readPendingPick(1, 3, BATCH)!; expect(stored.body).toEqual(request.body); expect(request.requireExactOutcome).toBe(true);
    expect(stored.generation).toBe('original-generation'); expect(request.body.recovery_item).toBeUndefined();
    await new Promise<void>(r => { finish = r; });
  });
  const first = p.onConfirmScan(BATCH, params); await waitFor(() => expect(mockSubmitScan).toHaveBeenCalledTimes(1));
  await expect(p.onConfirmScan(BATCH, { ...params, device_event_id: 'other-request' })).rejects.toThrow();
  finish(); await first; expect(readPendingPick(1, 3, BATCH)).toBeNull();
});
test('storage failure prevents HTTP; definitive refusal clears while uncertain response preserves the exact pending body', async () => {
  const p = await claimed(); const setter = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage full'); });
  await expect(p.onConfirmScan(BATCH, params)).rejects.toThrow(); expect(mockSubmitScan).not.toHaveBeenCalled(); setter.mockRestore();
  mockSubmitScan.mockRejectedValueOnce(refusal('PICK_UNIT_IDENTITY_MISMATCH'));
  await expect(p.onConfirmScan(BATCH, params)).rejects.toThrow(); expect(readPendingPick(1, 3, BATCH)).toBeNull();
  mockSubmitScan.mockRejectedValueOnce(timeout); await expect(p.onConfirmScan(BATCH, params)).rejects.toBe(timeout);
  expect(readPendingPick(1, 3, BATCH)?.body.lasyncro_unit_ids).toEqual(['LSU-A']);
  await expect(p.onConfirmScan(BATCH, params)).rejects.toThrow(); expect(mockSubmitScan).toHaveBeenCalledTimes(2);
});
test('recovery reads the original held generation and selector, rejects mismatched generation and never adopts it', async () => {
  const p = await claimed(); mockSubmitScan.mockRejectedValueOnce(timeout); await expect(p.onConfirmScan(BATCH, params)).rejects.toBe(timeout);
  get.mockImplementation(async () => ({ data: { pick_claim_generation: 'different-generation', outcome: { status: 'unresolved' } } }));
  await expect(p.onRevalidatePickOwnership(BATCH)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_STALE' } } });
  const config = sessionCalls().slice(-1)[0][1]; expect(config.headers['X-Pick-Claim-Generation']).toBe('original-generation');
  expect(config.params).toMatchObject({ reservation_allocation_id: 'alloc', operation_type: 'pick' });
  expect(p.onReadPendingPick(BATCH).generation).toBe('original-generation'); expect(mockSubmitScan).toHaveBeenCalledTimes(1);
});

test('positive exact receipt clears the fence only on acknowledgement; mismatched receipt stays unresolved', async () => {
  const p = await claimed(); mockSubmitScan.mockRejectedValueOnce(timeout); await expect(p.onConfirmScan(BATCH, params)).rejects.toBe(timeout);
  const outcome = { status: 'recorded', operation_identity: `pick:${BATCH}:alloc`, operation_type: 'pick', pick_batch_id: BATCH,
    reservation_allocation_id: 'alloc', lasyncro_line_item_id: 'li', lasyncro_variant_id: 'v', location_code: 'A1',
    operator_id: 3, quantity_required: 1, quantity_confirmed: 1, lasyncro_unit_ids: ['LSU-A'], scan_id: 'scan', inventory_movement_id: 'movement' };
  get.mockResolvedValueOnce({ data: { pick_claim_generation: 'original-generation', outcome: { ...outcome, operator_id: 4 } } });
  expect((await p.onRevalidatePickOwnership(BATCH)).status).toBe('unresolved');
  expect(readPendingPick(1, 3, BATCH)).not.toBeNull();
  get.mockResolvedValueOnce({ data: { pick_claim_generation: 'original-generation', outcome } });
  expect(await p.onRevalidatePickOwnership(BATCH)).toEqual(outcome);
  expect(readPendingPick(1, 3, BATCH)).not.toBeNull();
  p.onClearPendingPick(BATCH, outcome); expect(readPendingPick(1, 3, BATCH)).toBeNull();
});


test('Short Pick is saved before HTTP; timeout keeps the event and blocks further submissions until its exact receipt', async () => {
  const p = await claimed(); const shortItem = { ...item, quantity: 2 };
  const shortParams = { lasyncro_line_item_id: 'li', lasyncro_variant_id: 'v', reservation_allocation_id: 'alloc',
    stage: 'pick', exception_type: 'short_pick', quantity_required: 2, quantity_found: 1,
    device_event_id: 'short-event', lasyncro_unit_ids: ['LSU-A'], recovery_item: shortItem };
  post.mockImplementation(async (url: string, body: any) => {
    expect(String(url)).toMatch(/exception$/);
    const pending = readPendingPick(1, 3, BATCH)!;
    expect(pending.kind).toBe('exception'); expect(pending.body).toEqual(body);
    expect(pending.requestId).toBe('short-event'); throw timeout;
  });
  await expect(p.onReportException(BATCH, shortParams)).rejects.toBe(timeout);
  expect(readPendingPick(1, 3, BATCH)?.body.lasyncro_unit_ids).toEqual(['LSU-A']);
  await expect(p.onReportException(BATCH, shortParams)).rejects.toThrow();
  expect(post.mock.calls.filter(([url]) => String(url).endsWith('/exception'))).toHaveLength(1);
  expect(mockSubmitScan).not.toHaveBeenCalled();
});

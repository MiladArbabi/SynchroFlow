/**
 * SF-PICK-RESUME-GENERATION-001 — host adapter on the real WmsOperationsPage.
 * Without a held generation, opening resumes through POST /claim
 * {resume_only:true} and uses the returned generation; a held generation is
 * verified as-is (fenced pick-session) and never replaced; generation /
 * ownership refusals never trigger resume-only.
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

const BATCH = 'abcd1234-0000-4000-8000-0000000000r1';
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
  get.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
  mockSubmitScan.mockResolvedValue(undefined);
});

const resumeAnswers = (gen: string) =>
  post.mockImplementation(async (url: string, body?: { resume_only?: boolean }) =>
    String(url).endsWith('/claim') && body?.resume_only === true
      ? { data: { pick_batch_id: BATCH, status: 'picking', pick_claim_generation: gen, custody_ack_required: false, units_picked: 1, takeover: null } }
      : { data: {} });

test('RH-01 fresh page (no held generation): resume-only claim, then the next scan carries that generation', async () => {
  resumeAnswers('g-current');
  const props = await renderPage();
  expect(typeof props.onResumePickSession).toBe('function');
  await expect(props.onResumePickSession(BATCH)).resolves.toMatchObject({ pick_claim_generation: 'g-current' });
  expect(claimCalls()).toHaveLength(1);
  expect(claimCalls()[0][1]).toEqual({ resume_only: true });
  await props.onConfirmScan(BATCH, scanParams);
  expect(mockSubmitScan.mock.calls[0][0].body.pick_claim_generation).toBe('g-current');
});

test('RH-02 server refusal propagates; nothing is held; writes stay refused; no normal claim is attempted', async () => {
  post.mockRejectedValue(refusal('PICK_OWNERSHIP_REVOKED'));
  const props = await renderPage();
  await expect(props.onResumePickSession(BATCH)).rejects.toMatchObject({ response: { data: { code: 'PICK_OWNERSHIP_REVOKED' } } });
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_REQUIRED' } } });
  expect(mockSubmitScan).not.toHaveBeenCalled();
  expect(claimCalls().map((c) => c[1])).toEqual([{ resume_only: true }]);
});

test('RH-03 a held generation is verified as-is through the fenced pick-session, never replaced by resume-only', async () => {
  post.mockImplementation(async (url: string) =>
    String(url).endsWith('/claim') ? { data: { pick_claim_generation: 'g1', custody_ack_required: false } } : { data: {} });
  get.mockImplementation(async () => { throw refusal('PICK_GENERATION_STALE'); });
  const props = await renderPage();
  await props.onClaimBatch(BATCH);
  await expect(props.onResumePickSession(BATCH)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_STALE' } } });
  expect((sessionCalls()[0][1] as any).headers['X-Pick-Claim-Generation']).toBe('g1');
  expect(claimCalls()).toHaveLength(1);                     // only the original explicit claim
  await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toBeTruthy();
  expect(mockSubmitScan).not.toHaveBeenCalled();
});

test.each(['PICK_GENERATION_STALE', 'PICK_OWNERSHIP_REVOKED'])(
  'RH-04 a %s scan refusal never triggers resume-only recovery', async (code) => {
    resumeAnswers('g-current');
    const props = await renderPage();
    await props.onResumePickSession(BATCH);
    mockSubmitScan.mockRejectedValueOnce(refusal(code));
    await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toBeTruthy();
    await expect(props.onConfirmScan(BATCH, scanParams)).rejects.toMatchObject({ response: { data: { code: 'PICK_GENERATION_REQUIRED' } } });
    expect(claimCalls()).toHaveLength(1);
  });

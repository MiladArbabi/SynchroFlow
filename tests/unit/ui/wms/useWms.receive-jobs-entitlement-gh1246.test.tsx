// GH-1246 — WMS receive-jobs read is gated by the canonical purchasing.core decision.
//
// GET /api/v1/suppliers/receive-jobs requires purchasing.core (Growth+). The WMS
// hook used to poll it for every tier, so Core operators produced a 403 every
// 10s. Contract: only a resolved, allowed canonical decision for a known shop
// may read or show open receive jobs; every other state fails closed, and a
// cached tally never survives a downgrade or crosses shops.
//
// Real EntitlementsProvider, useCommercialAccess and useWms; only the HTTP
// boundary and the auth session are faked.
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RECEIVE_JOB_OPEN_STATUSES } from '@lasyncro/shared';

import { EntitlementsProvider, useEntitlements } from 'contexts/EntitlementsContext';
import { useWms } from 'pages/wms/useWms';

const mockGet = jest.fn();
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: (...args: unknown[]) => mockGet(...args) },
}));

// GH-1247: session identity is the access token's shop_id claim, so sessions use
// unsigned JWT-shaped tokens. `nonce` distinguishes refreshed tokens of one shop.
const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
const jwt = (shopId: number, nonce = 0) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ user_id: 7, shop_id: shopId, iat: nonce })}.sig`;
const TOKEN_SHOP_11 = jwt(11);
const TOKEN_SHOP_11_REFRESHED = jwt(11, 1);
const TOKEN_SHOP_22 = jwt(22);

// One access token per shop session; changing it re-runs the real entitlement fetch.
let mockAuth = { isLoggedIn: true, accessToken: TOKEN_SHOP_11 };
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

const RECEIVE_URL = '/api/v1/suppliers/receive-jobs';
const ENTITLEMENTS_URL = '/api/v1/entitlements/me';

type Session = { shopId: number; tier: 'starter' | 'core' | 'growth' | 'scale' };
// The backend answers for the shop that owns the presented token.
let sessions: Record<string, Session>;
let entitlementsMode: 'resolve' | 'pending' | 'reject';

function reads(url: string) {
  return mockGet.mock.calls.filter(([u]) => u === url).length;
}
const receiveReads = () => reads(RECEIVE_URL);

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth = { isLoggedIn: true, accessToken: TOKEN_SHOP_11 };
  sessions = { [TOKEN_SHOP_11]: { shopId: 11, tier: 'growth' } };
  entitlementsMode = 'resolve';
  mockGet.mockImplementation((url: string) => {
    const session = sessions[mockAuth.accessToken];
    if (url === ENTITLEMENTS_URL) {
      if (entitlementsMode === 'pending') return new Promise(() => {});
      if (entitlementsMode === 'reject') return Promise.reject(new Error('entitlements unavailable'));
      return Promise.resolve({
        data: {
          shopId: session.shopId, tier: session.tier, modules: [], flags: [],
          trialEndsAt: null, subscriptionStatus: 'active', displayCurrency: 'USD',
          locale: 'en-US', billingCurrency: 'USD', billingProvider: 'stripe',
        },
      });
    }
    if (url === RECEIVE_URL) {
      return Promise.resolve({ data: { receive_jobs: [{ id: `job-shop-${session.shopId}` }] } });
    }
    if (url === '/api/v1/wms/batches') return Promise.resolve({ data: { batches: [] } });
    if (url === '/api/v1/wms/stow-tasks') return Promise.resolve({ data: { stow_tasks: [] } });
    if (url === '/api/v1/wms/settings') return Promise.resolve({ data: { settings: null } });
    if (url === '/api/v1/wms/recount-tasks') return Promise.resolve({ data: { tasks: [] } });
    return Promise.resolve({ data: {} });
  });
});

function renderWms() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const history: Array<{ shopId: number | null; jobIds: string[] }> = [];
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <EntitlementsProvider>{children}</EntitlementsProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => {
    const wms = useWms();
    const { shopId } = useEntitlements();
    history.push({ shopId, jobIds: (wms.openReceiveJobs as Array<{ id: string }>).map((j) => j.id) });
    return { wms, shopId };
  }, { wrapper });
  return { ...view, client, history };
}

// The other WMS reads always start, so they prove the hook is live and settled.
async function settled() {
  await waitFor(() => expect(reads(ENTITLEMENTS_URL)).toBeGreaterThan(0));
  await waitFor(() => expect(reads('/api/v1/wms/batches')).toBeGreaterThan(0));
  await waitFor(() => expect(reads('/api/v1/wms/stow-tasks')).toBeGreaterThan(0));
  await waitFor(() => expect(reads('/api/v1/wms/settings')).toBeGreaterThan(0));
}

describe('GH-1246 — receive-jobs read requires a resolved, allowed purchasing.core decision', () => {
  it('Growth: one canonical open receive-jobs read, rows exposed, manual refetch re-reads', async () => {
    const { result } = renderWms();

    await waitFor(() => expect(receiveReads()).toBe(1));
    expect(mockGet).toHaveBeenCalledWith(RECEIVE_URL, {
      params: {
        status: RECEIVE_JOB_OPEN_STATUSES.join(','),
      },
      _sessionGeneration: expect.any(Number),
    });
    await waitFor(() =>
      expect(result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-11' }])
    );

    await act(async () => { result.current.wms.refetch(); });
    await waitFor(() => expect(receiveReads()).toBe(2));
  });

  it('Core: denied — zero reads (including manual refetch), empty tally, other WMS reads unaffected', async () => {
    sessions[TOKEN_SHOP_11].tier = 'core';
    const { result } = renderWms();

    await settled();
    // Core is entitled to recount, so the recount read proves resolution happened.
    await waitFor(() => expect(reads('/api/v1/wms/recount-tasks')).toBeGreaterThan(0));
    expect(result.current.shopId).toBe(11);

    const batchesBefore = reads('/api/v1/wms/batches');
    await act(async () => { result.current.wms.refetch(); });
    await waitFor(() => expect(reads('/api/v1/wms/batches')).toBeGreaterThan(batchesBefore));

    expect(receiveReads()).toBe(0);
    expect(result.current.wms.openReceiveJobs).toEqual([]);
  });

  it('unresolved commercial truth: zero reads while the entitlement snapshot is pending', async () => {
    entitlementsMode = 'pending';
    const { result } = renderWms();

    await settled();
    await act(async () => { result.current.wms.refetch(); });

    expect(receiveReads()).toBe(0);
    expect(result.current.wms.openReceiveJobs).toEqual([]);
  });

  it('errored/unavailable commercial truth: zero reads after a failed entitlement fetch', async () => {
    entitlementsMode = 'reject';
    const { result } = renderWms();

    await settled();
    await act(async () => { result.current.wms.refetch(); });

    expect(receiveReads()).toBe(0);
    expect(result.current.wms.openReceiveJobs).toEqual([]);
  });

  it('allowed -> denied: the cached tally disappears and no further reads occur, polling disabled', async () => {
    const { result, rerender, client } = renderWms();
    await waitFor(() =>
      expect(result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-11' }])
    );
    const readsWhileAllowed = receiveReads();

    // Same shop downgraded to Core; a new session token re-runs the real entitlement fetch.
    sessions[TOKEN_SHOP_11_REFRESHED] = { shopId: 11, tier: 'core' };
    mockAuth = { isLoggedIn: true, accessToken: TOKEN_SHOP_11_REFRESHED };
    rerender();
    await waitFor(() => expect(result.current.wms.openReceiveJobs).toEqual([]));
    // GH-1247: a refreshed token of the same shop; wait for its own
    // entitlement resolution before inspecting shop 11.
    await waitFor(() => expect(reads(ENTITLEMENTS_URL)).toBe(2));
    await waitFor(() => expect(result.current.shopId).toBe(11));

    // The shop-11 entry still holds the old rows, yet the hook exposes none of them.
    const query = client.getQueryCache().find({ queryKey: ['wms', 'receive-jobs', 'open', 11], exact: true });
    expect(query?.state.data).toEqual([{ id: 'job-shop-11' }]);
    // Observed but disabled: TanStack never schedules refetchInterval for a
    // disabled observer (query-core queryObserver #updateRefetchInterval), so
    // the 10s poll cannot run.
    expect(query?.getObserversCount()).toBeGreaterThan(0);
    expect(query?.isDisabled()).toBe(true);

    const batchesBefore = reads('/api/v1/wms/batches');
    await act(async () => { result.current.wms.refetch(); });
    await waitFor(() => expect(reads('/api/v1/wms/batches')).toBeGreaterThan(batchesBefore));

    expect(receiveReads()).toBe(readsWhileAllowed);
    expect(result.current.wms.openReceiveJobs).toEqual([]);
  });

  it('shop identity change: never shows or caches one shop\'s receive jobs as another\'s', async () => {
    sessions[TOKEN_SHOP_22] = { shopId: 22, tier: 'growth' };
    const { result, rerender, client, history } = renderWms();
    await waitFor(() =>
      expect(result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-11' }])
    );

    mockAuth = { isLoggedIn: true, accessToken: TOKEN_SHOP_22 };
    rerender();
    await waitFor(() => expect(result.current.shopId).toBe(22));
    await waitFor(() =>
      expect(result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-22' }])
    );

    // No render ever attributed shop 11's rows to shop 22 (or vice versa).
    expect(history.filter((h) => h.shopId === 22 && h.jobIds.includes('job-shop-11'))).toEqual([]);
    expect(history.filter((h) => h.shopId === 11 && h.jobIds.includes('job-shop-22'))).toEqual([]);
    // The shop-11 cache entry was never written with shop 22's rows during the switch.
    expect(client.getQueryData(['wms', 'receive-jobs', 'open', 11])).toEqual([{ id: 'job-shop-11' }]);
    expect(client.getQueryData(['wms', 'receive-jobs', 'open', 22])).toEqual([{ id: 'job-shop-22' }]);
  });

  it('Growth -> logged out: the provider keeps tier growth but clears the shop — tally hidden, zero further reads', async () => {
    const { result, rerender } = renderWms();
    await waitFor(() =>
      expect(result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-11' }])
    );
    const readsWhileLoggedIn = receiveReads();

    mockAuth = { isLoggedIn: false, accessToken: '' };
    rerender();
    await waitFor(() => expect(result.current.shopId).toBeNull());
    await act(async () => { result.current.wms.refetch(); });

    expect(receiveReads()).toBe(readsWhileLoggedIn);
    expect(result.current.wms.openReceiveJobs).toEqual([]);
  });
});

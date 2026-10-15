// GH-1247 — entitlement snapshots, capability decisions and cached data never
// cross authenticated shop boundaries.
//
// GH-1246 review (G38B) found that EntitlementsProvider restored the previous
// shop's last-good snapshot when the next shop's entitlement fetch failed, and
// kept exposing the previous shop while that fetch was pending. Contract: the
// CURRENT ACCESS TOKEN'S shop (its shop_id claim) is the session identity; a
// snapshot is exposed, and last-good restored, only for that session.
//
// Every render and every receive-jobs request below is attributed to the
// token's shop decoded independently by this test — never to the provider's
// own shopId. Real EntitlementsProvider, useCommercialAccess and useWms; only
// the HTTP boundary and the auth session are faked.
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { EntitlementsProvider, useEntitlements } from 'contexts/EntitlementsContext';
import { useCommercialAccess } from 'runtime/commercialContext';
import { useWms } from 'pages/wms/useWms';

const mockGet = jest.fn();
jest.mock('api/axiosConfig', () => ({
  axiosInstance: { get: (...args: unknown[]) => mockGet(...args) },
}));

let mockAuth: { isLoggedIn: boolean; accessToken: string | null } = { isLoggedIn: false, accessToken: null };
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => mockAuth,
}));

type Tier = 'starter' | 'core' | 'growth' | 'scale';
const RECEIVE_URL = '/api/v1/suppliers/receive-jobs';
const ENTITLEMENTS_URL = '/api/v1/entitlements/me';

// ── Tokens: JWT-shaped, unsigned. `nonce` distinguishes refreshed tokens of one shop.
const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');
function jwt(shopId: number, nonce = 0): string {
  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ user_id: 7, shop_id: shopId, tier: 'scale', iat: nonce })}.sig`;
}
const MALFORMED = 'not-a-jwt';
/** JWT-shaped token with an arbitrary payload (for invalid shop_id claims). */
const jwtWith = (payload: object) => `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.sig`;
/** The test's own, independent reading of the session shop. */
function tokenShop(token: string | null): number | null {
  if (!token) return null;
  try {
    const shop = JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString()).shop_id;
    return Number.isSafeInteger(shop) && shop > 0 ? shop : null;
  } catch {
    return null;
  }
}

// ── Fake backend: the truth for whichever shop the presented token belongs to.
let tiers: Record<number, Tier>;
type Plan = 'resolve' | 'reject' | 'defer' | { respondAsShop: number };
let plans: Record<string, Plan>;
const deferred: Record<string, Array<{ resolve: (v: unknown) => void; reject: (e: unknown) => void; shop: number | null }>> = {};
const receiveCalls: Array<{ token: string | null; shop: number | null }> = [];

function entitlementsBody(shop: number) {
  return {
    data: {
      shopId: shop, tier: tiers[shop], modules: [], flags: [], trialEndsAt: null,
      subscriptionStatus: 'active', displayCurrency: 'USD', locale: 'en-US',
      billingCurrency: 'USD', billingProvider: 'stripe',
    },
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  receiveCalls.length = 0;
  for (const k of Object.keys(deferred)) delete deferred[k];
  tiers = { 11: 'growth', 22: 'core', 33: 'growth' };
  plans = {};
  mockAuth = { isLoggedIn: false, accessToken: null };
  mockGet.mockImplementation((url: string) => {
    const token = mockAuth.accessToken;
    const shop = tokenShop(token);
    if (url === ENTITLEMENTS_URL) {
      const plan = plans[token ?? ''] ?? 'resolve';
      if (plan === 'defer') {
        return new Promise((resolve, reject) => {
          (deferred[token!] ??= []).push({ resolve, reject, shop });
        });
      }
      // An explicit plan answers HTTP 200 even for a token without a valid shop.
      if (typeof plan === 'object') return Promise.resolve(entitlementsBody(plan.respondAsShop));
      if (plan === 'reject' || shop === null) return Promise.reject(new Error('entitlements unavailable'));
      return Promise.resolve(entitlementsBody(shop));
    }
    if (url === RECEIVE_URL) {
      receiveCalls.push({ token, shop });
      if (shop === null || !['growth', 'scale'].includes(tiers[shop])) {
        return Promise.reject(Object.assign(new Error('Request failed with status code 403'), { response: { status: 403 } }));
      }
      return Promise.resolve({ data: { receive_jobs: [{ id: `job-shop-${shop}`, shop }] } });
    }
    if (url === '/api/v1/wms/batches') return Promise.resolve({ data: { batches: [] } });
    if (url === '/api/v1/wms/stow-tasks') return Promise.resolve({ data: { stow_tasks: [] } });
    if (url === '/api/v1/wms/settings') return Promise.resolve({ data: { settings: null } });
    if (url === '/api/v1/wms/recount-tasks') return Promise.resolve({ data: { tasks: [] } });
    return Promise.resolve({ data: {} });
  });
});

async function settleDeferred(token: string, outcome: 'resolve' | 'reject') {
  const pending = deferred[token] ?? [];
  deferred[token] = [];
  await act(async () => {
    for (const d of pending) {
      if (outcome === 'reject' || d.shop === null) d.reject(new Error('entitlements unavailable'));
      else d.resolve(entitlementsBody(d.shop));
    }
  });
}

type Frame = {
  token: string | null; tokenShop: number | null; providerShop: number | null;
  purchasingAllowed: boolean; jobShops: Array<number | null>;
};

function render(initialToken: string | null) {
  mockAuth = { isLoggedIn: initialToken !== null, accessToken: initialToken };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const frames: Frame[] = [];
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <EntitlementsProvider>{children}</EntitlementsProvider>
    </QueryClientProvider>
  );
  const view = renderHook(() => {
    const wms = useWms();
    const ent = useEntitlements();
    const { isResolved, decide } = useCommercialAccess();
    const frame: Frame = {
      token: mockAuth.accessToken,
      tokenShop: mockAuth.isLoggedIn ? tokenShop(mockAuth.accessToken) : null,
      providerShop: ent.shopId,
      purchasingAllowed: isResolved && decide('purchasing.core').allowed,
      jobShops: (wms.openReceiveJobs as Array<{ shop: number | null }>).map((j) => j.shop),
    };
    frames.push(frame);
    return { wms, ent };
  }, { wrapper });
  const switchTo = (token: string | null) => {
    mockAuth = { isLoggedIn: token !== null, accessToken: token };
    view.rerender();
  };
  return { ...view, client, frames, switchTo };
}

/** Invariant 7: no render exposes another shop's data, or a capability the token's shop lacks. */
function expectNoCrossShopExposure(frames: Frame[]) {
  const leaks = frames.filter((f) =>
    f.jobShops.some((s) => s !== f.tokenShop) ||
    (f.providerShop !== null && f.providerShop !== f.tokenShop && tokenShop(f.token) !== null) ||
    (f.purchasingAllowed && (f.tokenShop === null || !['growth', 'scale'].includes(tiers[f.tokenShop])))
  );
  expect(leaks).toEqual([]);
}

/** Invariant 8: every receive-jobs request was made by a session whose shop is entitled. */
function expectNoUnauthorizedReceiveReads() {
  const unauthorized = receiveCalls.filter((c) => c.shop === null || !['growth', 'scale'].includes(tiers[c.shop]));
  expect(unauthorized).toEqual([]);
}

/** No observed receive-jobs query is enabled, so no 10s poll can run (query-core #updateRefetchInterval). */
function expectReceivePollingDisabled(client: QueryClient) {
  const observed = client.getQueryCache().findAll({ queryKey: ['wms', 'receive-jobs', 'open'] })
    .filter((q) => q.getObserversCount() > 0);
  expect(observed.length).toBeGreaterThan(0);
  expect(observed.every((q) => q.isDisabled())).toBe(true);
}

async function onShopAWithRows(r: ReturnType<typeof render>) {
  await waitFor(() => expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-11', shop: 11 }]));
}

describe('GH-1247 — entitlement state never crosses authenticated shop boundaries', () => {
  it('1. Growth A → Core B, entitlement pending: nothing of A is exposed or used under B', async () => {
    const A = jwt(11), B = jwt(22);
    plans[B] = 'defer';
    const r = render(A);
    await onShopAWithRows(r);

    r.switchTo(B);
    await waitFor(() => expect(deferred[B]?.length).toBe(1));
    await act(async () => { r.result.current.wms.refetch(); });
    const underB = r.frames.filter((f) => f.token === B);
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.every((f) => f.providerShop === null && !f.purchasingAllowed && f.jobShops.length === 0)).toBe(true);
    expect(r.result.current.ent.hasResolved).toBe(false);

    await settleDeferred(B, 'resolve');
    await waitFor(() => expect(r.result.current.ent.shopId).toBe(22));
    await act(async () => { r.result.current.wms.refetch(); });
    expect(r.result.current.ent.tier).toBe('core');
    expect(r.result.current.wms.openReceiveJobs).toEqual([]);
    expect(receiveCalls.filter((c) => c.token === B)).toEqual([]);
    expectReceivePollingDisabled(r.client);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it('2. Growth A → Core B, entitlement rejected: A\'s last-good snapshot is NOT restored; fail closed', async () => {
    const A = jwt(11), B = jwt(22);
    plans[B] = 'reject';
    const r = render(A);
    await onShopAWithRows(r);

    r.switchTo(B);
    await waitFor(() => expect(r.result.current.ent.error).toBe('entitlements unavailable'));
    await act(async () => { r.result.current.wms.refetch(); });
    expect(r.result.current.ent.hasResolved).toBe(true);
    expect(r.result.current.ent.shopId).toBeNull();
    expect(r.result.current.ent.tier).toBe('starter');
    expect(r.result.current.wms.openReceiveJobs).toEqual([]);
    expect(receiveCalls.filter((c) => c.token === B)).toEqual([]);
    expectReceivePollingDisabled(r.client);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it('3. Growth A → Growth B, successful resolution: only B\'s data, cached under B', async () => {
    const A = jwt(11), C = jwt(33);
    const r = render(A);
    await onShopAWithRows(r);

    r.switchTo(C);
    await waitFor(() => expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-33', shop: 33 }]));
    expect(r.result.current.ent.shopId).toBe(33);
    expect(receiveCalls.filter((c) => c.token === C).length).toBeGreaterThan(0);
    expect(r.client.getQueryData(['wms', 'receive-jobs', 'open', 11])).toEqual([{ id: 'job-shop-11', shop: 11 }]);
    expect(r.client.getQueryData(['wms', 'receive-jobs', 'open', 33])).toEqual([{ id: 'job-shop-33', shop: 33 }]);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it('4. late response from A after switching to B never overwrites B', async () => {
    const A = jwt(11), C = jwt(33);
    plans[A] = 'defer';
    const r = render(A);
    await waitFor(() => expect(deferred[A]?.length).toBe(1));

    r.switchTo(C);
    await waitFor(() => expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-33', shop: 33 }]));

    // A's (Growth) answer arrives late, after B's session resolved.
    await settleDeferred(A, 'resolve');
    await act(async () => { r.result.current.wms.refetch(); });
    expect(r.result.current.ent.shopId).toBe(33);
    expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-33', shop: 33 }]);
    expect(receiveCalls.filter((c) => c.shop === 11)).toEqual([]);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it('3b. valid shop B (Growth) + response for B: allowed, B\'s data only', async () => {
    tiers[22] = 'growth';
    const B = jwt(22);
    const r = render(B);

    await waitFor(() => expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-22', shop: 22 }]));
    expect(r.result.current.ent.shopId).toBe(22);
    expect(r.result.current.ent.error).toBeNull();
    expect(r.frames[r.frames.length - 1].purchasingAllowed).toBe(true);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it('4b. valid shop B + a response describing shop A: rejected (fail closed)', async () => {
    const B = jwt(22);
    plans[B] = { respondAsShop: 11 };
    const r = render(B);

    await waitFor(() => expect(r.result.current.ent.error).toBe('ENTITLEMENTS_SHOP_MISMATCH'));
    expect(r.result.current.ent.shopId).toBeNull();
    expect(r.result.current.ent.tier).toBe('starter');
    expect(receiveCalls).toEqual([]);
    expectNoCrossShopExposure(r.frames);
  });

  it('5. same-shop temporary failure (silent refresh of A): last-good restored, no gap, reads continue', async () => {
    const A1 = jwt(11, 1), A2 = jwt(11, 2);
    plans[A2] = 'defer';
    const r = render(A1);
    await onShopAWithRows(r);

    r.switchTo(A2);
    await waitFor(() => expect(deferred[A2]?.length).toBe(1));
    // Same shop session: A's entitlements and rows stay usable while refreshing.
    const duringRefresh = r.frames.filter((f) => f.token === A2);
    expect(duringRefresh.length).toBeGreaterThan(0);
    expect(duringRefresh.every((f) => f.providerShop === 11 && f.purchasingAllowed)).toBe(true);

    await settleDeferred(A2, 'reject');
    await waitFor(() => expect(r.result.current.ent.isLoading).toBe(false));
    expect(r.result.current.ent.error).toBeNull();
    expect(r.result.current.ent.tier).toBe('growth');
    expect(r.result.current.ent.shopId).toBe(11);
    const before = receiveCalls.length;
    await act(async () => { r.result.current.wms.refetch(); });
    await waitFor(() => expect(receiveCalls.length).toBe(before + 1));
    expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-11', shop: 11 }]);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it('6a. logout: previous-shop access invalidated, tier not retained, no reads', async () => {
    const A = jwt(11);
    const r = render(A);
    await onShopAWithRows(r);
    const before = receiveCalls.length;

    r.switchTo(null);
    await act(async () => { r.result.current.wms.refetch(); });
    expect(r.result.current.ent.shopId).toBeNull();
    expect(r.result.current.ent.tier).toBe('starter');
    expect(r.result.current.ent.hasResolved).toBe(true);
    expect(r.result.current.wms.openReceiveJobs).toEqual([]);
    expect(receiveCalls.length).toBe(before);
    expect(r.frames.filter((f) => f.token === null).every((f) => f.jobShops.length === 0 && !f.purchasingAllowed)).toBe(true);
  });

  it('6b. logout then same shop again: the old last-good snapshot cannot be restored on failure', async () => {
    const A1 = jwt(11, 1), A2 = jwt(11, 2);
    plans[A2] = 'reject';
    const r = render(A1);
    await onShopAWithRows(r);

    r.switchTo(null);
    await waitFor(() => expect(r.result.current.ent.shopId).toBeNull());
    r.switchTo(A2);
    await waitFor(() => expect(r.result.current.ent.error).toBe('entitlements unavailable'));
    expect(r.result.current.ent.tier).toBe('starter');
    expect(r.result.current.wms.openReceiveJobs).toEqual([]);
  });

  it('6c. Growth A → malformed token (server would answer 200 as Growth A): no A data or capability, fail closed', async () => {
    const A = jwt(11);
    plans[MALFORMED] = { respondAsShop: 11 };
    const r = render(A);
    await onShopAWithRows(r);

    r.switchTo(MALFORMED);
    await waitFor(() => expect(r.result.current.ent.error).toBe('ENTITLEMENTS_SESSION_UNKNOWN'));
    await act(async () => { r.result.current.wms.refetch(); });
    const underMalformed = r.frames.filter((f) => f.token === MALFORMED);
    expect(underMalformed.length).toBeGreaterThan(0);
    expect(underMalformed.every((f) => f.providerShop === null && !f.purchasingAllowed && f.jobShops.length === 0)).toBe(true);
    expect(r.result.current.ent.hasResolved).toBe(true);
    expect(r.result.current.ent.shopId).toBeNull();
    expect(r.result.current.ent.tier).toBe('starter');
    expect(r.result.current.wms.openReceiveJobs).toEqual([]);
    expect(receiveCalls.filter((c) => c.token === MALFORMED)).toEqual([]);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });

  it.each([
    ['opaque', 'test-token'],
    ['no shop_id claim', jwtWith({ user_id: 7 })],
    ['shop_id 0', jwtWith({ user_id: 7, shop_id: 0 })],
    ['negative shop_id', jwtWith({ user_id: 7, shop_id: -11 })],
    ['string shop_id', jwtWith({ user_id: 7, shop_id: '11' })],
    ['fractional shop_id', jwtWith({ user_id: 7, shop_id: 11.5 })],
  ])('6d. invalid session identity (%s) + HTTP 200 Growth response: fail closed', async (_label, token) => {
    plans[token] = { respondAsShop: 11 };
    const r = render(token);

    await waitFor(() => expect(r.result.current.ent.error).toBe('ENTITLEMENTS_SESSION_UNKNOWN'));
    await act(async () => { r.result.current.wms.refetch(); });
    expect(r.frames.every((f) => f.providerShop === null && !f.purchasingAllowed && f.jobShops.length === 0)).toBe(true);
    expect(r.result.current.ent.hasResolved).toBe(true);
    expect(r.result.current.ent.isLoading).toBe(false);
    expect(r.result.current.ent.tier).toBe('starter');
    expect(r.result.current.ent.modules).toEqual([]);
    expect(receiveCalls).toEqual([]);
  });

  it('7/8. full round trip A(Growth) → B(Core, pending → resolved) → C(Growth): no cross-shop exposure, no unauthorized reads', async () => {
    const A = jwt(11), B = jwt(22), C = jwt(33);
    plans[B] = 'defer';
    const r = render(A);
    await onShopAWithRows(r);

    r.switchTo(B);
    await waitFor(() => expect(deferred[B]?.length).toBe(1));
    await act(async () => { r.result.current.wms.refetch(); });
    await settleDeferred(B, 'resolve');
    await waitFor(() => expect(r.result.current.ent.tier).toBe('core'));
    await act(async () => { r.result.current.wms.refetch(); });
    expectReceivePollingDisabled(r.client);

    r.switchTo(C);
    await waitFor(() => expect(r.result.current.wms.openReceiveJobs).toEqual([{ id: 'job-shop-33', shop: 33 }]));
    expect(receiveCalls.map((c) => c.shop).filter((s) => s !== 11 && s !== 33)).toEqual([]);
    expectNoCrossShopExposure(r.frames);
    expectNoUnauthorizedReceiveReads();
  });
});

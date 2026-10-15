// AUTH-REMEDIATION-01 Stage 2B: real App/auth/interceptor/query composition.
// Only the routed WMS page is substituted. Providers, gates and hooks remain real.
import React from 'react';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { IntlProvider } from 'react-intl';
import { QueryCache, QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import App from '../../../../apps/frontend/src/App';
import { ConfigProvider } from 'contexts/ConfigContext';
import { UserProvider } from 'contexts/UserContext';
import { useAuth } from 'contexts/AuthContext';
import { useEntitlements } from 'contexts/EntitlementsContext';
import { useCommercialAccess } from 'runtime/commercialContext';
import { useIntegration } from 'contexts/integration';
import { useWms } from 'pages/wms/useWms';
import { axiosInstance } from 'api/axiosConfig';
import { clearToken, getToken, getSessionGeneration } from 'utils/authStore';

// Canonical Jest omits the lib alias. Forward to the unchanged real module.
jest.mock('lib/appStoreUrl', () => jest.requireActual('../../../../apps/frontend/src/lib/appStoreUrl'), { virtual: true });

jest.mock('pages/ft2-pages/WmsOperationsPage', () => ({
  __esModule: true,
  default: function DiagnosticWmsRoute() { return mockWmsLeaf(); },
}));

const ENT = '/api/v1/entitlements/me';
const RECEIVE = '/api/v1/suppliers/receive-jobs';
const REFRESH = '/api/v1/auth/refresh_token';
const CHECK = '/api/v1/wms/settings';
type Tier = 'growth' | 'core';
type Reply = [number, unknown];
type Deferred = { promise: Promise<Reply>; resolve: (value: Reply) => void };
function deferred(): Deferred {
  let resolve!: Deferred['resolve'];
  const promise = new Promise<Reply>(done => { resolve = done; });
  return { promise, resolve };
}
function jwt(shop: unknown, nonce = 0): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return encode({ alg: 'none', typ: 'JWT' }) + '.' +
    encode({ user_id: 7, shop_id: shop, shop_roles: ['operator'], tier: shop === 22 ? 'core' : 'growth', iat: nonce }) + '.sig';
}
function identity(token: string | null): number | null {
  try {
    const value = JSON.parse(Buffer.from(token?.split('.')[1] ?? '', 'base64url').toString()).shop_id;
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}
function user(shop: number) {
  return { id: 7, shop_id: shop, role: 'operator', plan: 'growth',
    first_name: 'Shop' + shop, last_name: 'Synthetic', email: 'operator' + shop + '@example.test' } as any;
}
const A = jwt(11);
const B = jwt(22);
const A2 = jwt(11, 2);
const row = (shop: number) => ({ id: 'job-shop-' + shop, shop });
let tiers: Record<number, Tier>;
let entPlans: Map<string, Reply | Deferred>;
let receivePlans: Map<string, Deferred>;
let refreshPlan: Deferred | null;
let protected401: Set<string>;
let controls: { auth: ReturnType<typeof useAuth>; navigate: ReturnType<typeof useNavigate>;
  wms: ReturnType<typeof useWms>; ent: ReturnType<typeof useEntitlements>; client: QueryClient } | null;
type Frame = { tokenShop: number | null; storeShop: number | null; generation: number;
  entitlementShop: number | null; tier: string; hasResolved: boolean; error: string | null;
  purchasing: boolean; rows: Array<{ id: string; shop: number }>; client: number;
  integrationId: number | null };
let frames: Frame[];
let dispatches: Array<{ url: string; method: string; authorization: string | null;
  headerShop: number | null; storeShop: number | null; generation: number;
  lastRenderedShop: number | null; renderedRoutePresent: boolean }>;
let cacheEvents: Array<{ cache: number; type: string; key: unknown; observers: number }>;
let unmatched: string[];
let shellErrors: string[];
let clients: Set<QueryClient>;
let caches: Set<QueryCache>;
let ids: WeakMap<object, number>;
let nextId: number;
let adapters: MockAdapter[];
let instrumentation: jest.SpyInstance[];
let originalMatchMedia: typeof window.matchMedia;
function id(value: object): number {
  if (!ids.has(value)) ids.set(value, nextId++);
  return ids.get(value)!;
}
function mockWmsLeaf() {
  const auth = useAuth();
  const ent = useEntitlements();
  const commercial = useCommercialAccess();
  const wms = useWms();
  const client = useQueryClient();
  const integration = useIntegration();
  const navigate = useNavigate();
  clients.add(client);
  controls = { auth, navigate, wms, ent, client };
  frames.push({
    tokenShop: identity(auth.accessToken), storeShop: identity(getToken()),
    generation: getSessionGeneration(), entitlementShop: ent.shopId, tier: ent.tier,
    hasResolved: ent.hasResolved, error: ent.error,
    purchasing: commercial.isResolved && commercial.decide('purchasing.core').allowed,
    rows: (wms.openReceiveJobs as Array<{ id: string; shop: number }>).map(value => ({ ...value })),
    client: id(client), integrationId: integration.integrationId,
  });
  return <output data-testid="shell-wms-probe">{JSON.stringify(frames[frames.length - 1])}</output>;
}
function entitlement(shop: number) {
  return { shopId: shop, tier: tiers[shop], modules: [], flags: [], trialEndsAt: null,
    subscriptionStatus: 'active', displayCurrency: 'USD', locale: 'en-US',
    billingCurrency: 'USD', billingProvider: 'stripe' };
}
function transport(config: any): Reply | Promise<Reply> {
  const url = String(config.url);
  const authorization = config.headers?.get?.('Authorization') ?? config.headers?.Authorization ?? null;
  const token = typeof authorization === 'string' && authorization.startsWith('Bearer ')
    ? authorization.slice(7) : null;
  const shop = identity(token);
  dispatches.push({ url, method: config.method, authorization, headerShop: shop,
    storeShop: identity(getToken()), generation: getSessionGeneration(),
    lastRenderedShop: frames[frames.length - 1]?.tokenShop ?? null,
    renderedRoutePresent: document.querySelector('[data-testid="shell-wms-probe"]') !== null });
  if (config.method === 'post' && url === '/api/v1/auth/logout') return [200, { ok: true }];
  if (config.method === 'post' && url === REFRESH) {
    if (refreshPlan) return refreshPlan.promise;
    unmatched.push('UNPLANNED_REFRESH');
    return [599, { error: 'UNPLANNED_REFRESH' }];
  }
  if (config.method !== 'get') {
    unmatched.push(config.method + ' ' + url);
    return [599, { error: 'UNMATCHED_HTTP' }];
  }
  if (url === ENT) {
    const plan = entPlans.get(token ?? '');
    return plan ? ('promise' in plan ? plan.promise : plan) : [200, entitlement(shop ?? 11)];
  }
  if (url === RECEIVE) {
    const plan = receivePlans.get(token ?? '');
    if (plan) return plan.promise;
    if (shop === null || tiers[shop] !== 'growth') {
      return [403, { error: 'COMMERCIAL_ACCESS_DENIED', currentTier: shop ? tiers[shop] : 'core' }];
    }
    return [200, { receive_jobs: [row(shop)] }];
  }
  if (url === CHECK && protected401.delete(token ?? '')) return [401, { error: 'TOKEN_EXPIRED' }];
  if (url === '/api/v1/integrations/sync-status') return [200, { status: 'COMPLETED', integrationId: shop }];
  if (url === '/api/v1/lifecycle') return [200, { phase: 'FT2_READY' }];
  if (url === '/api/v1/lifecycle/ft2/readiness') return [200, { ready: true, progress: {} }];
  if (url === '/api/v1/layouts/dashboard') return [200, {}];
  if (url === '/api/v1/system/health') return [200, { status: 'healthy', shop,
    timestamp: '2026-10-15T00:00:00Z', projection: [],
    snapshot: { last_snapshot_at: null, lag_seconds: null, status: 'unknown' } }];
  if (url === '/api/v1/wms/batches') return [200, { batches: [] }];
  if (url === '/api/v1/wms/stow-tasks') return [200, { stow_tasks: [] }];
  if (url === CHECK) return [200, { settings: { shop } }];
  if (url === '/api/v1/wms/recount-tasks') return [200, { tasks: [] }];
  if (url === '/api/v1/wms/opening-inventory/progress') return [200, { shop, cohort: null, items: [] }];
  unmatched.push(config.method + ' ' + url);
  return [599, { error: 'UNMATCHED_HTTP' }];
}
async function tick(ms = 0) {
  await act(async () => { await jest.advanceTimersByTimeAsync(ms); });
}
async function mountA() {
  localStorage.setItem('accessToken', A);
  localStorage.setItem('user', JSON.stringify(user(11)));
  const outer = new QueryClient();
  clients.add(outer);
  render(
    <ConfigProvider><QueryClientProvider client={outer}><UserProvider>
      <MemoryRouter initialEntries={['/wms']}><IntlProvider locale="en" messages={{}}>
        <App />
      </IntlProvider></MemoryRouter>
    </UserProvider></QueryClientProvider></ConfigProvider>,
  );
  await waitFor(() => {
    expect(screen.getByTestId('shell-wms-probe')).toBeInTheDocument();
    expect(controls?.auth.user?.shop_id).toBe(11);
    expect(controls?.wms.openReceiveJobs).toEqual([row(11)]);
  });
  expect(unmatched).toEqual([]);
  expect(shellErrors).toEqual([]);
  console.log('SHELL_STARTUP_VALID', JSON.stringify({ shop: 11, client: id(controls!.client) }));
  return controls!;
}
async function login(token: string, shop = 22) {
  const current = controls!;
  await act(async () => { current.auth.login(user(shop), token); });
  await tick();
  expect(getToken()).toBe(token);
}
function unauthorizedReads() {
  return dispatches.filter(call => call.url === RECEIVE &&
    (call.headerShop === null || tiers[call.headerShop] !== 'growth'));
}
function leaks() {
  return frames.filter(frame => frame.rows.some(value => value.shop !== frame.tokenShop) ||
    (frame.entitlementShop !== null && frame.entitlementShop !== frame.tokenShop) ||
    (frame.purchasing && (frame.tokenShop === null || tiers[frame.tokenShop] !== 'growth')));
}
function observedForeignRows(client: QueryClient, shop: number) {
  return client.getQueryCache().findAll().filter(query => query.getObserversCount() > 0 &&
    Array.isArray(query.state.data) &&
    (query.state.data as any[]).some(value => value?.shop !== undefined && value.shop !== shop));
}
function expectNoTransportLeak() {
  expect(dispatches.filter(call => call.url === RECEIVE &&
    call.headerShop !== call.storeShop)).toEqual([]);
  expect(unauthorizedReads()).toEqual([]);
}
beforeEach(() => {
  jest.useFakeTimers();
  clearToken(); localStorage.clear(); sessionStorage.clear();
  delete axiosInstance.defaults.headers.common.Authorization;
  delete axios.defaults.headers.common.Authorization;
  window.history.replaceState({}, '', '/');
  tiers = { 11: 'growth', 22: 'core' };
  entPlans = new Map(); receivePlans = new Map(); refreshPlan = null; protected401 = new Set();
  controls = null; frames = []; dispatches = []; cacheEvents = []; unmatched = []; shellErrors = [];
  clients = new Set(); caches = new Set(); ids = new WeakMap(); nextId = 1; instrumentation = [];
  originalMatchMedia = window.matchMedia;
  window.matchMedia = jest.fn().mockImplementation((query: string) => ({
    matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
  }));
  // Call-through instrumentation only: original constructors/observers/options are untouched.
  const mount = QueryClient.prototype.mount;
  instrumentation.push(jest.spyOn(QueryClient.prototype, 'mount').mockImplementation(function(this: QueryClient) {
    clients.add(this); return mount.call(this);
  }));
  const notify = QueryCache.prototype.notify;
  instrumentation.push(jest.spyOn(QueryCache.prototype, 'notify').mockImplementation(function(this: QueryCache, event: any) {
    caches.add(this);
    cacheEvents.push({ cache: id(this), type: event.type, key: event.query?.queryKey,
      observers: event.query?.getObserversCount() ?? 0 });
    return notify.call(this, event);
  }));
  instrumentation.push(jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    shellErrors.push(args.map(value => String(value)).join(' '));
  }));
  adapters = [new MockAdapter(axiosInstance, { onNoMatch: 'throwException' }),
    new MockAdapter(axios, { onNoMatch: 'throwException' })];
  adapters.forEach(adapter => adapter.onAny().reply(transport));
});
afterEach(async () => {
  try {
    console.log('SHELL_TRACE', JSON.stringify({
      test: expect.getState().currentTestName,
      dispatches: dispatches.filter(call => [ENT, RECEIVE, REFRESH, CHECK].includes(call.url)),
      frames, cacheEvents: cacheEvents.filter(event => String(event.key).includes('receive') ||
        String(event.key).includes('integration')),
      caches: [...caches].map(cache => ({ id: id(cache), queries: cache.getAll().map(query => ({
        key: query.queryKey, observers: query.getObserversCount(), data: query.state.data,
      })) })), unmatched, shellErrors,
    }));
    expect(unmatched).toEqual([]);
    expect(shellErrors).toEqual([]);
  } finally {
    cleanup();
    clearToken();
    await Promise.all([...clients].map(client => client.cancelQueries()));
    clients.forEach(client => client.clear());
    adapters.forEach(adapter => adapter.restore());
    instrumentation.reverse().forEach(spy => spy.mockRestore());
    delete axiosInstance.defaults.headers.common.Authorization;
    delete axios.defaults.headers.common.Authorization;
    localStorage.clear(); sessionStorage.clear();
    window.matchMedia = originalMatchMedia;
    jest.clearAllTimers(); jest.useRealTimers();
  }
});

describe('App authenticated shop isolation — GH-1247 / GH-1246', () => {
  it('1 GH-1247: Growth A -> Core B with pending entitlements never exposes A', async () => {
    await mountA();
    entPlans.set(B, deferred());
    await login(B);
    await tick(10_000);
    const underB = frames.filter(frame => frame.tokenShop === 22);
    expect({ crossShopExposure: leaks(), unauthorizedReceiveReads: unauthorizedReads() })
      .toEqual({ crossShopExposure: [], unauthorizedReceiveReads: [] });
    expect(underB.every(frame => !frame.purchasing && frame.rows.length === 0)).toBe(true);
    expectNoTransportLeak();
  });

  it('2 GH-1246: rejected Core B entitlement request never reads receive jobs', async () => {
    await mountA();
    entPlans.set(B, [503, { error: 'SYNTHETIC_ENTITLEMENTS_UNAVAILABLE' }]);
    await login(B);
    await tick(10_000);
    expect(dispatches.some(call => call.url === ENT && call.headerShop === 22)).toBe(true);
    expect(unauthorizedReads()).toEqual([]);
    expect(leaks()).toEqual([]);
    expectNoTransportLeak();
  });

  it('3 Growth A -> Growth B isolates cached rows and retained observers', async () => {
    const first = await mountA();
    const oldClient = first.client;
    const oldCache = oldClient.getQueryCache();
    expect(oldCache.findAll().some(query => query.getObserversCount() > 0)).toBe(true);
    tiers[22] = 'growth';
    await login(B);
    await waitFor(() => expect(controls?.auth.accessToken).toBe(B));
    await tick();
    expect(controls!.wms.openReceiveJobs).toEqual([row(22)]);
    expect(controls!.client).not.toBe(oldClient);
    expect(controls!.client.getQueryCache()).not.toBe(oldCache);
    expect(leaks()).toEqual([]);
    expect(observedForeignRows(oldClient, 22)).toEqual([]);
    expect(observedForeignRows(controls!.client, 22)).toEqual([]);
    // This real consumer lives above EntitlementBoundary and can retain an observer.
    expect(frames.filter(frame => frame.tokenShop === 22).map(frame => frame.integrationId))
      .not.toContain(11);
    expectNoTransportLeak();
  });

  it('4 late A entitlement/receive/refresh responses cannot overwrite authenticated B', async () => {
    const first = await mountA();
    const oldClient = first.client;
    const ent = deferred(), receive = deferred(), refresh = deferred();
    entPlans.set(A, ent); receivePlans.set(A, receive); refreshPlan = refresh;
    protected401.add(A);
    await act(async () => { first.ent.refresh(); first.wms.refetch(); });
    await waitFor(() => {
      expect(dispatches.some(call => call.url === REFRESH)).toBe(true);
      expect(dispatches.filter(call => call.url === ENT && call.headerShop === 11).length).toBeGreaterThan(1);
      expect(dispatches.filter(call => call.url === RECEIVE && call.headerShop === 11).length).toBeGreaterThan(1);
    });
    tiers[22] = 'growth';
    await login(B);
    await waitFor(() => expect(controls?.auth.accessToken).toBe(B));
    await tick();
    await act(async () => {
      ent.resolve([200, entitlement(11)]);
      receive.resolve([200, { receive_jobs: [row(11)] }]);
      refresh.resolve([200, { accessToken: A2 }]);
    });
    await tick();
    expect(getToken()).toBe(B);
    expect(controls!.auth.accessToken).toBe(B);
    expect(controls!.auth.user?.shop_id).toBe(22);
    expect(controls!.wms.openReceiveJobs).toEqual([row(22)]);
    expect(leaks()).toEqual([]);
    expect(observedForeignRows(controls!.client, 22)).toEqual([]);
    expect(oldClient.getQueryCache()).not.toBe(controls!.client.getQueryCache());
    expectNoTransportLeak();
  });

  it('5 logout -> new login cannot reuse the retained old shop cache', async () => {
    const first = await mountA();
    const oldClient = first.client;
    const oldCache = oldClient.getQueryCache();
    await act(async () => { await first.auth.logout(); });
    expect(getToken()).toBeNull();
    expect(screen.queryByTestId('shell-wms-probe')).toBeNull();
    tiers[22] = 'growth';
    await act(async () => {
      first.auth.login(user(22), B);
      first.navigate('/wms');
    });
    await waitFor(() => expect(controls?.auth.accessToken).toBe(B));
    await tick();
    expect(controls!.wms.openReceiveJobs).toEqual([row(22)]);
    expect(controls!.client).not.toBe(oldClient);
    expect(oldClient.getQueryCache()).toBe(oldCache);
    expect(oldCache.getAll().every(query => query.getObserversCount() === 0)).toBe(true);
    expect(leaks()).toEqual([]);
    expectNoTransportLeak();
  });

  it('6 invalid or missing shop identity never binds entitlements or receives rows', async () => {
    await mountA();
    const opaque = 'synthetic-invalid-token';
    await login(opaque);
    await tick(10_000);
    const missing = jwt(undefined);
    await login(missing);
    await tick(10_000);
    expect(dispatches.filter(call => call.url === ENT &&
      [opaque, missing].some(token => call.authorization === 'Bearer ' + token))).toEqual([]);
    expect(frames.filter(frame => frame.tokenShop === null).every(frame =>
      frame.entitlementShop === null && !frame.purchasing && frame.rows.length === 0)).toBe(true);
    expect(unauthorizedReads()).toEqual([]);
    expect(leaks()).toEqual([]);
  });

  it('7 same-shop 401 -> refresh -> replay preserves identity and valid access', async () => {
    const first = await mountA();
    const client = first.client;
    protected401.add(A); refreshPlan = deferred();
    const before = dispatches.length;
    let outcome: Promise<unknown>;
    await act(async () => { outcome = axiosInstance.get(CHECK); });
    await waitFor(() => expect(dispatches.some(call => call.url === REFRESH)).toBe(true));
    await act(async () => { refreshPlan!.resolve([200, { accessToken: A2 }]); await outcome!; });
    await waitFor(() => expect(controls?.auth.accessToken).toBe(A2));
    expect(getToken()).toBe(A2);
    expect(controls!.client).toBe(client);
    expect(controls!.auth.user?.shop_id).toBe(11);
    expect(controls!.wms.openReceiveJobs).toEqual([row(11)]);
    const checkCalls = dispatches.slice(before).filter(call => call.url === CHECK);
    expect(checkCalls.map(call => call.authorization)).toEqual(['Bearer ' + A, 'Bearer ' + A2]);
    expect(dispatches.filter(call => call.url === REFRESH)).toHaveLength(1);
    expect(leaks()).toEqual([]);
    expectNoTransportLeak();
  });

  it('8 authStore B before React commit cannot authorise an already-live A refetch', async () => {
    const first = await mountA();
    const generationA = getSessionGeneration();
    const oldClient = first.client;
    entPlans.set(B, deferred());
    await act(async () => {
      first.auth.login(user(22), B);
      expect(identity(getToken())).toBe(22);
      expect(first.auth.user?.shop_id).toBe(11);
      first.wms.refetch();
    });
    await tick();
    expect(getSessionGeneration()).toBeGreaterThan(generationA);
    expect(dispatches.some(call => call.headerShop === 22 &&
      call.lastRenderedShop === 11)).toBe(true);
    expect(unauthorizedReads()).toEqual([]);
    expect(leaks()).toEqual([]);
    expect([...caches]).toContain(oldClient.getQueryCache());
    expectNoTransportLeak();
  });
});

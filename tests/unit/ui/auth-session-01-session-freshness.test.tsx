// tests/unit/ui/auth-session-01-session-freshness.test.tsx
//
// AUTH-SESSION-01 / D09 — web frontend session freshness.
//
// Ratified contract:
//   15  A same-identity silent refresh projects role, plan (tier), email and
//       first_name while preserving user_id and shop_id.
//   16  React state and the persisted PublicUser agree after refresh.
//   17  An explicit logout invalidates an in-flight refresh: a late success
//       restores no token, Authorization header or user.
//   18  A late failure from a previous session cannot log out a newly
//       established session.
//   19  Hard logout removes persisted stale user data.
//   20  A refresh 429 is non-terminal: the session survives, retryAfter is
//       respected, no immediate retry loop.
//   Preserved: per-tab single-flight, each request replayed at most once,
//   terminal 401/403, one retry for transient 503.
//   F3  A refresh with a different user_id or shop_id fails closed without
//       adopting its token, identity, Authorization header or request replay.
//
// Real AuthProvider + real authStore + real axiosConfig interceptors. The
// protected API is an axios-mock-adapter on axiosInstance; the refresh call is
// the raw axios.post that performRefresh() makes, intercepted with
// jest.spyOn(axios, 'post') (GH-1136 precedent:
// tests/unit/ui/commercial-state-freshness.interceptor.test.tsx).

import React from 'react';
import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { renderHook, act, waitFor } from '@testing-library/react';
import { axiosInstance } from 'api/axiosConfig';
import { AuthProvider, useAuth } from 'contexts/AuthContext';
import { clearToken, getToken } from 'utils/authStore';

const PROTECTED = '/api/v1/protected';
const REFRESH = '/api/v1/auth/refresh_token';

function fakeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`;
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function axiosError(status: number, data: Record<string, unknown>) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data, headers: {}, config: {} },
    config: {},
  });
}

const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;
const persistedUser = () => JSON.parse(localStorage.getItem('user') ?? 'null');

const SESSION_ONE_TOKEN = fakeJwt({
  user_id: 1,
  shop_id: 77,
  shop_roles: ['owner'],
  tier: 'core',
  email: 'one@test.example',
  first_name: 'One',
});
const SESSION_ONE_USER = {
  id: 1,
  shop_id: 77,
  role: 'owner',
  plan: 'core',
  email: 'one@test.example',
  first_name: 'One',
} as any;

describe('AUTH-SESSION-01 D09 — web session freshness', () => {
  let mock: MockAdapter;
  let postSpy: jest.SpyInstance;
  let capture: jest.Mock;
  let previousPosthog: unknown;
  const refreshFailures = () => capture.mock.calls.filter(([event]) => event === 'auth.token.refresh_failed');

  beforeEach(() => {
    previousPosthog = (window as any).posthog;
    capture = jest.fn();
    (window as any).posthog = { capture };
    clearToken();
    localStorage.clear();
    sessionStorage.clear();
    delete axiosInstance.defaults.headers.common.Authorization;
    window.history.replaceState({}, '', '/');
    mock = new MockAdapter(axiosInstance);
    postSpy = jest.spyOn(axios, 'post');
  });

  afterEach(() => {
    (window as any).posthog = previousPosthog;
    mock.restore();
    postSpy.mockRestore();
    delete axiosInstance.defaults.headers.common.Authorization;
  });

  async function loggedIn(user = SESSION_ONE_USER, token = SESSION_ONE_TOKEN) {
    const hook = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(hook.result.current.isLoading).toBe(false));
    act(() => {
      hook.result.current.login(user, token);
    });
    expect(getToken()).toBe(token);
    return hook;
  }

  const refreshCalls = () => postSpy.mock.calls.filter(([url]) => url === REFRESH).length;

  it('15/16 GREEN CONTROL: same-identity refresh updates role, plan, email and first_name in React state and persisted user', async () => {
    const { result } = await loggedIn();
    const refreshed = fakeJwt({
      user_id: 1,
      shop_id: 77,
      shop_roles: ['admin'],
      tier: 'growth',
      email: 'two@test.example',
      first_name: 'Two',
    });
    mock.onGet(PROTECTED).replyOnce(401).onGet(PROTECTED).replyOnce(200, { ok: true });
    postSpy.mockResolvedValueOnce({ data: { accessToken: refreshed } });

    await act(async () => {
      await axiosInstance.get(PROTECTED);
    });

    expect(result.current.accessToken).toBe(refreshed);
    expect(result.current.user).toMatchObject({
      id: 1,
      role: 'admin',
      plan: 'growth',
      shop_id: 77,
      email: 'two@test.example',
      first_name: 'Two',
    });
    expect(persistedUser()).toEqual(result.current.user);
  });

  it('F3 EXPECTED RED: a different user_id in a refresh fails closed without adopting or replaying the other user token', async () => {
    const renderedSessions: Array<{ userId: number | undefined; token: string | null }> = [];
    const { result } = renderHook(() => {
      const auth = useAuth();
      renderedSessions.push({ userId: auth.user?.id, token: auth.accessToken });
      return auth;
    }, { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.login(SESSION_ONE_USER, SESSION_ONE_TOKEN));
    expect(result.current.user?.id).toBe(1);
    expect(getToken()).toBe(SESSION_ONE_TOKEN);

    const otherUserToken = fakeJwt({
      user_id: 2,
      shop_id: 77,
      shop_roles: ['owner'],
      tier: 'core',
      email: 'other@test.example',
      first_name: 'Other',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const protectedAuthorization: unknown[] = [];
    mock.onGet(PROTECTED).reply(config => {
      protectedAuthorization.push(config.headers?.Authorization);
      return protectedAuthorization.length === 1 ? [401] : [200, { ok: true }];
    });
    postSpy.mockResolvedValueOnce({ data: { accessToken: otherUserToken } });
    const storageWrites = jest.spyOn(Storage.prototype, 'setItem');
    try {
      let outcome: string | undefined;
      await act(async () => {
        outcome = await axiosInstance.get(PROTECTED).then(() => 'resolved', () => 'rejected');
      });

      expect(refreshCalls()).toBe(1);
      expect({
        otherUserTokenWrites: storageWrites.mock.calls.filter(([key, value]) => key === 'accessToken' && value === otherUserToken),
        otherUserRenders: renderedSessions.filter(session => session.userId === 2 || session.token === otherUserToken),
        protectedAuthorization,
        requestOutcome: outcome,
        storedToken: getToken(),
        persistedToken: localStorage.getItem('accessToken'),
        persistedUser: persistedUser(),
        authorization: axiosInstance.defaults.headers.common.Authorization,
        accessToken: result.current.accessToken,
        user: result.current.user,
        isLoggedIn: result.current.isLoggedIn,
      }).toEqual({
        otherUserTokenWrites: [],
        otherUserRenders: [],
        protectedAuthorization: [`Bearer ${SESSION_ONE_TOKEN}`],
        requestOutcome: 'rejected',
        storedToken: null,
        persistedToken: null,
        persistedUser: null,
        authorization: undefined,
        accessToken: null,
        user: null,
        isLoggedIn: false,
      });
    } finally {
      storageWrites.mockRestore();
    }
    expect(refreshFailures()).toEqual([['auth.token.refresh_failed', { status: 200, code: 'REFRESH_IDENTITY_INVALID' }]]);
  });

  it('F3 EXPECTED RED: the same user_id with a different shop_id in a refresh fails closed without adopting or replaying the other shop token', async () => {
    const renderedSessions: Array<{ shopId: number | undefined; token: string | null }> = [];
    const { result } = renderHook(() => {
      const auth = useAuth();
      renderedSessions.push({ shopId: auth.user?.shop_id, token: auth.accessToken });
      return auth;
    }, { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    act(() => result.current.login(SESSION_ONE_USER, SESSION_ONE_TOKEN));
    expect(result.current.user).toMatchObject({ id: 1, shop_id: 77 });
    expect(getToken()).toBe(SESSION_ONE_TOKEN);

    const otherShopToken = fakeJwt({
      user_id: 1,
      shop_id: 88,
      shop_roles: ['owner'],
      tier: 'core',
      email: 'one@test.example',
      first_name: 'One',
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const protectedAuthorization: unknown[] = [];
    mock.onGet(PROTECTED).reply(config => {
      protectedAuthorization.push(config.headers?.Authorization);
      return protectedAuthorization.length === 1 ? [401] : [200, { ok: true }];
    });
    postSpy.mockResolvedValueOnce({ data: { accessToken: otherShopToken } });
    const storageWrites = jest.spyOn(Storage.prototype, 'setItem');
    try {
      let outcome: string | undefined;
      await act(async () => {
        outcome = await axiosInstance.get(PROTECTED).then(() => 'resolved', () => 'rejected');
      });

      expect(refreshCalls()).toBe(1);
      expect({
        otherShopTokenWrites: storageWrites.mock.calls.filter(([key, value]) => key === 'accessToken' && value === otherShopToken),
        otherShopRenders: renderedSessions.filter(session => session.shopId === 88 || session.token === otherShopToken),
        protectedAuthorization,
        requestOutcome: outcome,
        storedToken: getToken(),
        persistedToken: localStorage.getItem('accessToken'),
        persistedUser: persistedUser(),
        authorization: axiosInstance.defaults.headers.common.Authorization,
        accessToken: result.current.accessToken,
        user: result.current.user,
        isLoggedIn: result.current.isLoggedIn,
      }).toEqual({
        otherShopTokenWrites: [],
        otherShopRenders: [],
        protectedAuthorization: [`Bearer ${SESSION_ONE_TOKEN}`],
        requestOutcome: 'rejected',
        storedToken: null,
        persistedToken: null,
        persistedUser: null,
        authorization: undefined,
        accessToken: null,
        user: null,
        isLoggedIn: false,
      });
    } finally {
      storageWrites.mockRestore();
    }
    expect(refreshFailures()).toEqual([['auth.token.refresh_failed', { status: 200, code: 'REFRESH_IDENTITY_INVALID' }]]);
  });

  it('17 EXPECTED RED: explicit logout invalidates an in-flight refresh; a late success restores nothing', async () => {
    const { result } = await loggedIn();
    const pending = deferred<{ data: { accessToken: string } }>();
    postSpy.mockReturnValueOnce(pending.promise);
    mock.onGet(PROTECTED).replyOnce(401).onGet(PROTECTED).reply(200, { ok: true });

    let inFlight: Promise<unknown> = Promise.resolve();
    act(() => {
      inFlight = axiosInstance.get(PROTECTED).catch((e) => e);
    });
    await waitFor(() => expect(refreshCalls()).toBe(1));

    act(() => {
      result.current.logout();
    });
    await act(async () => {
      pending.resolve({ data: { accessToken: fakeJwt({ user_id: 1, shop_id: 77, shop_roles: ['owner'] }) } });
      await inFlight;
    });

    expect(getToken()).toBeNull();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(axiosInstance.defaults.headers.common.Authorization).toBeUndefined();
    expect(result.current.accessToken).toBeNull();
    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.user).toBeNull();
    expect(persistedUser()).toBeNull();
    expect(refreshFailures()).toHaveLength(0);
  });

  it('18 EXPECTED RED: a late refresh failure from a previous session cannot log out a newly established session', async () => {
    const { result } = await loggedIn();
    const pending = deferred<never>();
    postSpy.mockReturnValueOnce(pending.promise);
    mock.onGet(PROTECTED).replyOnce(401);

    let inFlight: Promise<unknown> = Promise.resolve();
    act(() => {
      inFlight = axiosInstance.get(PROTECTED).catch((e) => e);
    });
    await waitFor(() => expect(refreshCalls()).toBe(1));

    const sessionTwoToken = fakeJwt({ user_id: 2, shop_id: 99, shop_roles: ['owner'], tier: 'core' });
    const sessionTwoUser = { id: 2, shop_id: 99, role: 'owner', plan: 'core' } as any;
    act(() => {
      result.current.logout();
    });
    act(() => {
      result.current.login(sessionTwoUser, sessionTwoToken);
    });

    await act(async () => {
      pending.reject(axiosError(403, { error: 'SESSION_COMPROMISED', action: 'LOGOUT_REQUIRED' }));
      await inFlight;
    });

    expect(getToken()).toBe(sessionTwoToken);
    expect(localStorage.getItem('accessToken')).toBe(sessionTwoToken);
    expect(result.current.isLoggedIn).toBe(true);
    expect(persistedUser()?.id).toBe(2);
    expect(refreshFailures()).toHaveLength(0);
  });

  it('19 EXPECTED RED: hard logout removes persisted stale user data', async () => {
    await loggedIn();
    mock.onGet(PROTECTED).replyOnce(401);
    postSpy.mockRejectedValueOnce(axiosError(403, { error: 'SESSION_COMPROMISED', action: 'LOGOUT_REQUIRED' }));

    await act(async () => {
      await axiosInstance.get(PROTECTED).catch(() => undefined);
    });

    expect(getToken()).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
  });

  it('20 EXPECTED RED: refresh 429 is non-terminal; the retryAfter cooldown suppresses refresh, then a new single-flight attempt runs', async () => {
    await loggedIn();
    const refreshed = fakeJwt({ user_id: 1, shop_id: 77, shop_roles: ['owner'], tier: 'core' });
    mock
      .onGet(PROTECTED).replyOnce(401)
      .onGet(PROTECTED).replyOnce(401)
      .onGet(PROTECTED).replyOnce(401)
      .onGet(PROTECTED).reply(200, { ok: true });
    postSpy
      .mockRejectedValueOnce(axiosError(429, { error: 'TOO_MANY_REQUESTS', retryAfter: 60 }))
      .mockResolvedValueOnce({ data: { accessToken: refreshed } });

    // Controlled time (Date + timers); promise/microtask scheduling stays real.
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    jest.setSystemTime(new Date('2026-10-10T12:00:00.000Z'));
    try {
      await act(async () => {
        await axiosInstance.get(PROTECTED).catch(() => undefined);
      });

      // Non-terminal: exactly one attempt, local session intact.
      expect(refreshCalls()).toBe(1);
      expect(getToken()).toBe(SESSION_ONE_TOKEN);
      expect(persistedUser()?.id).toBe(1);

      // Inside the 60 s window a further 401 must not attempt refresh.
      await act(async () => {
        jest.advanceTimersByTime(30_000);
      });
      await act(async () => {
        await axiosInstance.get(PROTECTED).catch(() => undefined);
      });
      expect(refreshCalls()).toBe(1);
      expect(getToken()).toBe(SESSION_ONE_TOKEN);
      expect(persistedUser()?.id).toBe(1);
      expect(refreshFailures()).toEqual([['auth.token.refresh_failed', { status: 429, code: 'TOO_MANY_REQUESTS' }]]);

      // After the cooldown a new single-flight attempt runs and replays the request.
      await act(async () => {
        jest.advanceTimersByTime(31_000);
      });
      let res: { status: number } | undefined;
      await act(async () => {
        res = await axiosInstance.get(PROTECTED);
      });
      expect(refreshCalls()).toBe(2);
      expect(res?.status).toBe(200);
      expect(getToken()).toBe(refreshed);
    } finally {
      jest.useRealTimers();
    }
  });

  it('GREEN CONTROL: concurrent 401s share one refresh and each request is replayed exactly once', async () => {
    await loggedIn();
    const refreshed = fakeJwt({ user_id: 1, shop_id: 77, shop_roles: ['owner'], tier: 'core' });
    mock
      .onGet(PROTECTED).replyOnce(401)
      .onGet(PROTECTED).replyOnce(401)
      .onGet(PROTECTED).replyOnce(401)
      .onGet(PROTECTED).reply(200, { ok: true });
    postSpy.mockResolvedValue({ data: { accessToken: refreshed } });

    let results: Array<{ status: number }> = [];
    await act(async () => {
      results = await Promise.all([
        axiosInstance.get(PROTECTED),
        axiosInstance.get(PROTECTED),
        axiosInstance.get(PROTECTED),
      ]);
    });

    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(refreshCalls()).toBe(1);
    expect(mock.history.get.filter((c) => c.url === PROTECTED)).toHaveLength(6);
    expect(getToken()).toBe(refreshed);
  });

  it.each([
    [401, 'SESSION_EXPIRED'],
    [403, 'SESSION_COMPROMISED'],
  ])('GREEN CONTROL: refresh %i %s is terminal — no retry, session cleared', async (status, code) => {
    await loggedIn();
    capture.mockImplementation(() => { throw new Error('ANALYTICS_UNAVAILABLE'); });
    mock.onGet(PROTECTED).replyOnce(401);
    postSpy.mockRejectedValue(axiosError(status, { error: code, action: 'LOGOUT_REQUIRED' }));

    await act(async () => {
      await axiosInstance.get(PROTECTED).catch(() => undefined);
    });

    expect(refreshCalls()).toBe(1);
    expect(getToken()).toBeNull();
    expect(refreshFailures()).toEqual([['auth.token.refresh_failed', { status, code }]]);
  });

  it('GREEN CONTROL: transient 503 is retried exactly once and the request is replayed', async () => {
    await loggedIn();
    const refreshed = fakeJwt({ user_id: 1, shop_id: 77, shop_roles: ['owner'], tier: 'core' });
    mock.onGet(PROTECTED).replyOnce(401).onGet(PROTECTED).replyOnce(200, { ok: true });
    postSpy
      .mockRejectedValueOnce(axiosError(503, { error: 'REFRESH_TEMPORARILY_UNAVAILABLE', retryable: true }))
      .mockResolvedValueOnce({ data: { accessToken: refreshed } });

    let res: { status: number } | undefined;
    await act(async () => {
      res = await axiosInstance.get(PROTECTED);
    });

    expect(res?.status).toBe(200);
    expect(refreshCalls()).toBe(2);
    expect(getToken()).toBe(refreshed);
    expect(refreshFailures()).toHaveLength(0);

    // Exhaustion is one failure for the shared refresh, not one per waiter/attempt.
    mock.onGet(PROTECTED).reply(401);
    postSpy.mockRejectedValue(axiosError(503, { error: 'REFRESH_TEMPORARILY_UNAVAILABLE', retryable: true }));
    await act(async () => {
      await Promise.all([axiosInstance.get(PROTECTED).catch(() => undefined),
        axiosInstance.get(PROTECTED).catch(() => undefined)]);
    });
    expect(refreshCalls()).toBe(4);
    expect(getToken()).toBe(refreshed);
    expect(refreshFailures()).toEqual([['auth.token.refresh_failed', { status: 503, code: 'REFRESH_TEMPORARILY_UNAVAILABLE' }]]);
  });
});

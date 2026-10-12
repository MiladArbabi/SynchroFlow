import { act, render, waitFor, cleanupAsync } from '@testing-library/react-native';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@lasyncro/mobile-core';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';

const ACCESS = 'lasyncro_access_token';
const REFRESH = 'lasyncro_refresh_token';
const LOGIN = '/api/v1/auth/login';
const ROTATE = '/api/v1/auth/refresh_token';
const LOGOUT = '/api/v1/auth/logout';
const store = (SecureStore as any).__values as Map<string, string>;
type Auth = ReturnType<typeof useAuth>;
let auth: Auth;
let requests: InternalAxiosRequestConfig[];
let refresh: (config: InternalAxiosRequestConfig) => Promise<any>;
let revoke: (config: InternalAxiosRequestConfig) => Promise<any>;
let loginData: any;

function jwt(claims: Record<string, unknown> = {}) {
  return `e30.${Buffer.from(JSON.stringify({
    user_id: 41, role: 'admin', email: 'old@example.test', first_name: 'Old',
    exp: Math.floor(Date.now() / 1000) + 3600, ...claims,
  })).toString('base64')}.synthetic`;
}

function response(config: InternalAxiosRequestConfig, data: any) {
  return { config, status: 200, statusText: 'OK', headers: {}, data };
}

function rejected(config: InternalAxiosRequestConfig, status: number, error: string) {
  return new AxiosError(error, undefined, config, undefined, {
    config, status, statusText: 'Rejected', headers: {}, data: { error },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function calls(url: string) { return requests.filter((config) => config.url === url); }
function body(config: InternalAxiosRequestConfig) { return JSON.parse(config.data); }
// Attach rejection observation immediately, including for deliberately failed refreshes.
function protectedRequest() {
  return apiClient.get('/session-probe').then(
    (value) => ({ value, error: null }), (error) => ({ value: null, error })
  );
}

async function mount() {
  function Probe() { auth = useAuth(); return null; }
  const view = render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  return view;
}

async function authenticated() {
  await mount();
  await act(async () => { await auth.login('old@example.test', 'synthetic-password'); });
  expect(auth.isAuthenticated).toBe(true);
  expect(store.get(REFRESH)).toBe('refresh-0');
  requests.length = 0;
  jest.clearAllMocks();
}

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
  requests = [];
  delete apiClient.defaults.headers.common.Authorization;
  loginData = { accessToken: jwt(), refreshToken: 'refresh-0', user: { id: 41, role: 'admin' } };
  refresh = async (config) => response(config, { accessToken: jwt({ first_name: 'Rotated' }), refreshToken: 'refresh-1' });
  revoke = async (config) => response(config, { ok: true });
  // Real Axios instance, transforms and response interceptor; only the I/O adapter is replaced.
  apiClient.defaults.adapter = async (config) => {
    requests.push(config);
    if (config.url === LOGIN) return response(config, loginData);
    if (config.url === ROTATE) return refresh(config);
    if (config.url === LOGOUT) return revoke(config);
    if (config.url === '/session-probe') {
      if ((config as any)._retried) return response(config, { ok: true });
      throw rejected(config, 401, 'TOKEN_EXPIRED');
    }
    throw new Error(`Unexpected adapter request: ${config.method} ${config.url}`);
  };
});

test('M1 persists the rotated refresh token in SecureStore', async () => {
  await authenticated();
  await act(async () => { await protectedRequest(); });
  expect(calls(ROTATE)).toHaveLength(1);
  expect(body(calls(ROTATE)[0])).toEqual({ refreshToken: 'refresh-0' });
  expect(store.get(REFRESH)).toBe('refresh-1');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith(REFRESH, 'refresh-1');
});

test('M2 uses the rotated refresh token on the subsequent refresh', async () => {
  await authenticated();
  await act(async () => { await protectedRequest(); });
  await act(async () => { await protectedRequest(); });
  expect(calls(ROTATE)).toHaveLength(2);
  expect(body(calls(ROTATE)[0])).toEqual({ refreshToken: 'refresh-0' });
  expect(body(calls(ROTATE)[1])).toEqual({ refreshToken: 'refresh-1' });
});

test('M3 concurrent 401 requests share one in-flight refresh', async () => {
  await authenticated();
  const gate = deferred<any>();
  refresh = () => gate.promise;
  let first!: ReturnType<typeof protectedRequest>;
  let second!: ReturnType<typeof protectedRequest>;
  await act(async () => { first = protectedRequest(); second = protectedRequest(); });
  await waitFor(() => expect(calls(ROTATE).length).toBeGreaterThan(0));
  const overlappingRefreshCount = calls(ROTATE).length;
  let outcomes: any[] = [];
  await act(async () => {
    gate.resolve(response(calls(ROTATE)[0], { accessToken: jwt(), refreshToken: 'refresh-1' }));
    outcomes = await Promise.all([first, second]);
  });
  expect(overlappingRefreshCount).toBe(1);
  expect(calls(ROTATE)).toHaveLength(1);
  expect(outcomes.map((outcome) => outcome.error)).toEqual([null, null]);
  expect(calls('/session-probe')).toHaveLength(4);
});

test('M4 synchronizes all refreshed JWT identity and role claims', async () => {
  store.set(ACCESS, jwt());
  store.set(REFRESH, 'refresh-0');
  await mount();
  const accessToken = jwt({ role: 'staff', email: 'fresh@example.test', first_name: 'Fresh' });
  refresh = async (config) => response(config, { accessToken, refreshToken: 'refresh-1' });
  await act(async () => { await protectedRequest(); });
  expect(store.get(ACCESS)).toBe(accessToken);
  expect(apiClient.defaults.headers.common.Authorization).toBe(`Bearer ${accessToken}`);
  expect(auth).toMatchObject({ isAuthenticated: true, userId: 41, role: 'staff',
    roles: ['staff'], email: 'fresh@example.test', firstName: 'Fresh' });
});

test('M5 logout revokes the current body refresh token on the backend', async () => {
  await authenticated();
  store.set(REFRESH, 'current-refresh');
  await act(async () => { await auth.logout(); });
  expect(calls(LOGOUT)).toHaveLength(1);
  expect(calls(LOGOUT)[0].method).toBe('post');
  expect(body(calls(LOGOUT)[0])).toEqual({ refreshToken: 'current-refresh' });
  expect(store.has(ACCESS)).toBe(false);
  expect(store.has(REFRESH)).toBe(false);
});

test('M6 clears local credentials despite a confirmed backend revocation failure', async () => {
  await authenticated();
  const backendFailure = jest.fn(async (config: InternalAxiosRequestConfig) => {
    throw rejected(config, 503, 'SYNTHETIC_REVOCATION_FAILURE');
  });
  revoke = backendFailure;
  await act(async () => { await auth.logout(); });
  expect(store.has(ACCESS)).toBe(false);
  expect(store.has(REFRESH)).toBe(false);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  expect(auth).toMatchObject({ isAuthenticated: false, userId: null, role: null,
    email: null, firstName: null });
  // A configured failing stub alone does not prove the server failure path ran.
  expect(backendFailure).toHaveBeenCalledTimes(1);
  expect(body(calls(LOGOUT)[0])).toEqual({ refreshToken: 'refresh-0' });
});

test('M7 late refresh success cannot restore credentials after explicit logout', async () => {
  await authenticated();
  const gate = deferred<any>();
  refresh = () => gate.promise;
  let pending!: ReturnType<typeof protectedRequest>;
  await act(async () => { pending = protectedRequest(); });
  await waitFor(() => expect(calls(ROTATE)).toHaveLength(1));
  await act(async () => { await auth.logout(); });
  expect(store.size).toBe(0);
  jest.clearAllMocks();
  await act(async () => {
    gate.resolve(response(calls(ROTATE)[0], { accessToken: jwt(), refreshToken: 'late-refresh' }));
    await pending;
  });
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(store.size).toBe(0);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  expect(auth.isAuthenticated).toBe(false);
  expect(calls('/session-probe')).toHaveLength(1);
});

test('M8a REFRESH_TOKEN_CONFLICT is terminal without retry or token adoption', async () => {
  await authenticated();
  refresh = async (config) => { throw rejected(config, 400, 'REFRESH_TOKEN_CONFLICT'); };
  let result: any;
  await act(async () => { result = await protectedRequest(); });
  expect(result.error).toBeTruthy();
  expect(calls(ROTATE)).toHaveLength(1);
  expect(calls('/session-probe')).toHaveLength(1);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  expect(store.size).toBe(0);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  expect(auth).toMatchObject({ isAuthenticated: false, userId: null, role: null,
    email: null, firstName: null });
  await act(async () => { await protectedRequest(); });
  expect(calls(ROTATE)).toHaveLength(1);
});

test('M8b rejects a changed user_id before persistence or account switch', async () => {
  await authenticated();
  const alienAccess = jwt({ user_id: 42, email: 'other@example.test', first_name: 'Other' });
  refresh = async (config) => response(config, { accessToken: alienAccess, refreshToken: 'other-refresh' });
  let result: any;
  await act(async () => { result = await protectedRequest(); });
  expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(ACCESS, alienAccess);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith(REFRESH, 'other-refresh');
  expect(store.get(ACCESS)).not.toBe(alienAccess);
  expect(store.get(REFRESH)).not.toBe('other-refresh');
  expect(apiClient.defaults.headers.common.Authorization).not.toBe(`Bearer ${alienAccess}`);
  expect(auth.userId).not.toBe(42);
  expect(auth.email).not.toBe('other@example.test');
  expect(result.error).toBeTruthy();
  expect(calls('/session-probe')).toHaveLength(1);
});

test('M8c obsolete refresh failure cannot clear a newer authenticated session', async () => {
  await authenticated();
  const gate = deferred<any>();
  refresh = () => gate.promise;
  let pending!: ReturnType<typeof protectedRequest>;
  await act(async () => { pending = protectedRequest(); });
  await waitFor(() => expect(calls(ROTATE)).toHaveLength(1));
  const newerAccess = jwt({ user_id: 42, role: 'staff', email: 'new@example.test', first_name: 'New' });
  loginData = { accessToken: newerAccess, refreshToken: 'new-session-refresh', user: { id: 42, role: 'staff' } };
  await act(async () => { await auth.login('new@example.test', 'synthetic-password'); });
  expect(store.get(ACCESS)).toBe(newerAccess);
  expect(auth.userId).toBe(42);
  jest.clearAllMocks();
  await act(async () => {
    gate.reject(rejected(calls(ROTATE)[0], 400, 'REFRESH_TOKEN_CONFLICT'));
    await pending;
  });
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(store.get(ACCESS)).toBe(newerAccess);
  expect(store.get(REFRESH)).toBe('new-session-refresh');
  expect(apiClient.defaults.headers.common.Authorization).toBe(`Bearer ${newerAccess}`);
  expect(auth).toMatchObject({ isAuthenticated: true, userId: 42, role: 'staff',
    email: 'new@example.test', firstName: 'New' });
});

test('M8d body-token refresh explicitly disables native cookie credentials', async () => {
  await authenticated();
  await act(async () => { await protectedRequest(); });
  expect(calls(ROTATE)).toHaveLength(1);
  expect(body(calls(ROTATE)[0])).toEqual({ refreshToken: 'refresh-0' });
  // Axios XHR leaves undefined alone; React Native XHR defaults withCredentials=true.
  // This asserts the transport control, not behaviour of a mocked native cookie jar.
  expect(calls(ROTATE)[0].withCredentials).toBe(false);
  expect(calls(ROTATE)[0].headers.get('Cookie')).toBeUndefined();
});

// Logout failures must remain observable while surviving credentials are fenced.
async function logoutWithDeletionFailures(keys: string[], serverFails = false) {
  await authenticated();
  const backendFailure = jest.fn(async (config: InternalAxiosRequestConfig) => {
    throw rejected(config, 503, 'SYNTHETIC_REVOCATION_FAILURE');
  });
  if (serverFails) revoke = backendFailure;
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => {
    if (keys.includes(key)) throw new Error(`NATIVE_DELETE_FAILED:${key}`);
    store.delete(key);
  });
  let failure: any;
  await act(async () => {
    try { await auth.logout(); } catch (error) { failure = error; }
  });
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(ACCESS);
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH);
  expect(failure?.message).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
  expect(failure.failedKeys).toEqual(keys);
  expect(failure.durableInvalidation).toBe(true);
  expect(auth.error).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
  expect(auth).toMatchObject({ isAuthenticated: false, userId: null, role: null,
    email: null, firstName: null });
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  for (const key of [ACCESS, REFRESH]) expect(store.has(key)).toBe(keys.includes(key));
  expect(store.get('lasyncro_session_invalidated')).toBe('1');
  if (serverFails) expect(backendFailure).toHaveBeenCalledTimes(1);
}

afterEach(() => {
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async (key) => { store.delete(key); });
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async (key, value) => { store.set(key, value); });
});

test('P1a access deletion failure still attempts refresh deletion and reports partial cleanup', async () => {
  await logoutWithDeletionFailures([ACCESS]);
});

test('P1b refresh deletion failure is reported and durably fenced', async () => {
  await logoutWithDeletionFailures([REFRESH]);
});

test('P1c both deletion failures are reported and durably fenced', async () => {
  await logoutWithDeletionFailures([ACCESS, REFRESH]);
});

test('P1d failed server revocation does not prevent independent native cleanup', async () => {
  await logoutWithDeletionFailures([ACCESS, REFRESH], true);
});

test('P1e remount after partial cleanup cannot project a surviving valid access token', async () => {
  await logoutWithDeletionFailures([ACCESS]);
  // Explicitly unmount the actual provider before creating a fresh provider instance.
  await cleanupAsync();
  requests.length = 0;
  await mount();
  expect(auth.isAuthenticated).toBe(false);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  expect(calls(ROTATE)).toHaveLength(0);
  expect(auth.error).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
});

test('P1f a persisted invalidation marker blocks startup in a fresh module runtime', async () => {
  store.set(ACCESS, jwt());
  store.set(REFRESH, 'surviving-refresh');
  store.set('lasyncro_session_invalidated', '1');
  // Reload only AuthContext: native storage survives while its module fence resets.
  const React = require('react');
  let fresh!: typeof import('../src/contexts/AuthContext');
  jest.doMock('react', () => React);
  jest.doMock('expo-secure-store', () => SecureStore);
  jest.doMock('@lasyncro/mobile-core', () => ({ apiClient }));
  try {
    jest.isolateModules(() => { fresh = require('../src/contexts/AuthContext'); });
  } finally {
    jest.dontMock('react');
    jest.dontMock('expo-secure-store');
    jest.dontMock('@lasyncro/mobile-core');
  }
  function Probe() { auth = fresh.useAuth(); return null; }
  render(<fresh.AuthProvider><Probe /></fresh.AuthProvider>);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  expect(auth.isAuthenticated).toBe(false);
  expect(calls(ROTATE)).toHaveLength(0);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  expect(auth.error).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
});

test('P1g failed marker persistence reports that durable invalidation is unconfirmed', async () => {
  await authenticated();
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async () => { throw new Error('NATIVE_DELETE_FAILED'); });
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async () => { throw new Error('NATIVE_WRITE_FAILED'); });
  let failure: any;
  await act(async () => {
    try { await auth.logout(); } catch (error) { failure = error; }
  });
  expect(failure?.message).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
  expect(failure.durableInvalidation).toBe(false);
  expect(failure.failedKeys).toEqual([ACCESS, REFRESH]);
  expect(store.has(ACCESS)).toBe(true);
  expect(store.has(REFRESH)).toBe(true);
  expect(store.has('lasyncro_session_invalidated')).toBe(false);
  expect(auth.isAuthenticated).toBe(false);
  await cleanupAsync();
  requests.length = 0;
  await mount();
  expect(auth.isAuthenticated).toBe(false);
  expect(calls(ROTATE)).toHaveLength(0);
});


test('P1h unmount while server logout is pending still removes credentials', async () => {
  await authenticated();
  const gate = deferred<any>();
  const started = deferred<InternalAxiosRequestConfig>();
  revoke = config => { started.resolve(config); return gate.promise; };
  let pending!: Promise<void>;
  await act(async () => { pending = auth.logout(); });
  const config = await started.promise;
  await cleanupAsync();
  gate.resolve(response(config, { ok: true }));
  await pending;
  expect(store.has(ACCESS)).toBe(false);
  expect(store.has(REFRESH)).toBe(false);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  await mount();
  expect(auth.isAuthenticated).toBe(false);
});

test('P1i unmount during deletion still attempts both keys and persists invalidation', async () => {
  await authenticated();
  const gate = deferred<void>();
  const started = deferred<void>();
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => {
    if (key === ACCESS) { started.resolve(); await gate.promise; throw new Error('NATIVE_DELETE_FAILED'); }
    store.delete(key);
  });
  let pending!: Promise<any>;
  await act(async () => { pending = auth.logout().then(() => null, error => error); });
  await started.promise;
  await cleanupAsync();
  gate.resolve();
  const failure = await pending;
  expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(REFRESH);
  expect(failure?.message).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
  expect(failure.durableInvalidation).toBe(true);
  expect(store.get('lasyncro_session_invalidated')).toBe('1');
  expect(store.has(REFRESH)).toBe(false);
  await mount();
  expect(auth.isAuthenticated).toBe(false);
});

test('P1j fresh login replaces credentials before releasing an existing marker', async () => {
  store.set('lasyncro_session_invalidated', '1');
  await mount();
  expect(auth.isAuthenticated).toBe(false);
  const access = jwt({ user_id: 42 });
  loginData = { accessToken: access, refreshToken: 'new-refresh' };
  const deleteMarker = jest.mocked(SecureStore.deleteItemAsync);
  deleteMarker.mockImplementation(async key => {
    if (key === 'lasyncro_session_invalidated') {
      expect(store.get(ACCESS)).toBe(access);
      expect(store.get(REFRESH)).toBe('new-refresh');
    }
    store.delete(key);
  });
  await act(async () => { await auth.login('new@example.test', 'password'); });
  expect(auth.isAuthenticated).toBe(true);
  expect(auth.userId).toBe(42);
  expect(store.has('lasyncro_session_invalidated')).toBe(false);
  await cleanupAsync();
  await mount();
  expect(auth.userId).toBe(42);
});

test('P1k marker-removal failure during fresh login cannot adopt the new session', async () => {
  store.set('lasyncro_session_invalidated', '1');
  await mount();
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => {
    if (key === 'lasyncro_session_invalidated') throw new Error('MARKER_DELETE_FAILED');
    store.delete(key);
  });
  let failure: any;
  await act(async () => { try { await auth.login('new@example.test', 'password'); } catch (error) { failure = error; } });
  expect(failure).toBeInstanceOf(Error);
  expect(auth.isAuthenticated).toBe(false);
  expect(apiClient.defaults.headers.common.Authorization).toBeUndefined();
  expect(store.has(ACCESS)).toBe(false);
  expect(store.has(REFRESH)).toBe(false);
  expect(store.get('lasyncro_session_invalidated')).toBe('1');
  await cleanupAsync();
  await mount();
  expect(auth.isAuthenticated).toBe(false);
});

test('P1l old pending logout cannot erase a newer login after provider remount', async () => {
  await authenticated();
  const gate = deferred<any>();
  const started = deferred<InternalAxiosRequestConfig>();
  revoke = config => { started.resolve(config); return gate.promise; };
  let pending!: Promise<void>;
  await act(async () => { pending = auth.logout(); });
  const config = await started.promise;
  await cleanupAsync();
  await mount();
  const access = jwt({ user_id: 42 });
  loginData = { accessToken: access, refreshToken: 'new-refresh' };
  await act(async () => { await auth.login('new@example.test', 'password'); });
  jest.clearAllMocks();
  await act(async () => { gate.resolve(response(config, { ok: true })); await pending; });
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(store.get(ACCESS)).toBe(access);
  expect(store.get(REFRESH)).toBe('new-refresh');
  expect(apiClient.defaults.headers.common.Authorization).toBe(`Bearer ${access}`);
  expect(auth.userId).toBe(42);
});

test('P1m newer login during dispatched deletion is the final native writer', async () => {
  await authenticated();
  const gate = deferred<void>();
  const started = deferred<void>();
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => {
    if (key === ACCESS) { started.resolve(); await gate.promise; }
    store.delete(key);
  });
  let pending!: Promise<void>;
  await act(async () => { pending = auth.logout(); });
  await started.promise;
  await cleanupAsync();
  const access = jwt({ user_id: 42 });
  loginData = { accessToken: access, refreshToken: 'new-refresh' };
  function Probe() { auth = useAuth(); return null; }
  render(<AuthProvider><Probe /></AuthProvider>);
  let newer!: Promise<void>;
  await act(async () => { newer = auth.login('new@example.test', 'password'); });
  await act(async () => { gate.resolve(); await Promise.all([pending, newer]); });
  expect(store.get(ACCESS)).toBe(access);
  expect(store.get(REFRESH)).toBe('new-refresh');
  expect(store.has('lasyncro_session_invalidated')).toBe(false);
  expect(auth.userId).toBe(42);
  expect(apiClient.defaults.headers.common.Authorization).toBe(`Bearer ${access}`);
});

test('P1n disposed logout reports unconfirmed durability when deletion and marker write fail', async () => {
  await authenticated();
  const gate = deferred<void>();
  const started = deferred<void>();
  jest.mocked(SecureStore.deleteItemAsync).mockImplementation(async key => {
    if (key === ACCESS) { started.resolve(); await gate.promise; }
    throw new Error('NATIVE_DELETE_FAILED');
  });
  jest.mocked(SecureStore.setItemAsync).mockImplementation(async () => { throw new Error('NATIVE_WRITE_FAILED'); });
  let pending!: Promise<any>;
  await act(async () => { pending = auth.logout().then(() => null, error => error); });
  await started.promise;
  await cleanupAsync();
  gate.resolve();
  const failure = await pending;
  expect(failure.message).toBe('LOCAL_LOGOUT_CLEANUP_FAILED');
  expect(failure.failedKeys).toEqual([ACCESS, REFRESH]);
  expect(failure.durableInvalidation).toBe(false);
  expect(failure.invalidationFailure.message).toBe('NATIVE_WRITE_FAILED');
  await mount();
  expect(auth.isAuthenticated).toBe(false);
});

test('P1o disposed refresh rejection cannot invalidate the remounted provider session', async () => {
  await authenticated();
  const gate = deferred<any>();
  const started = deferred<InternalAxiosRequestConfig>();
  refresh = config => { started.resolve(config); return gate.promise; };
  let pending!: ReturnType<typeof protectedRequest>;
  await act(async () => { pending = protectedRequest(); });
  const config = await started.promise;
  await cleanupAsync();
  await mount();
  expect(auth.isAuthenticated).toBe(true);
  jest.clearAllMocks();
  await act(async () => { gate.reject(rejected(config, 400, 'REFRESH_TOKEN_CONFLICT')); await pending; });
  expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
  expect(store.get(REFRESH)).toBe('refresh-0');
  expect(apiClient.defaults.headers.common.Authorization).toBe(`Bearer ${store.get(ACCESS)}`);
  expect(auth.isAuthenticated).toBe(true);
});

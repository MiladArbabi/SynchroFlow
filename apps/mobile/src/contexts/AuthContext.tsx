// apps/mobile/src/contexts/AuthContext.tsx
import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@lasyncro/mobile-core';

const ACCESS_TOKEN_KEY = 'lasyncro_access_token';
const REFRESH_TOKEN_KEY = 'lasyncro_refresh_token';
const INVALIDATED_SESSION_KEY = 'lasyncro_session_invalidated';
// Survive provider remounts even when native storage cannot persist invalidation.
// Only a fully persisted explicit login may release this fence.
let sessionInvalidated = false;
let invalidationError: string | null = null;
let storageTail: Promise<unknown> = Promise.resolve();
// Session ownership spans provider lifetimes; disposal only fences UI/refresh work.
const sessionGeneration = { current: 0 };
const AUTH_ROUTES = ['/api/v1/auth/login', '/api/v1/auth/logout', '/api/v1/auth/refresh_token'];
type AuthState = {
  isAuthenticated: boolean; isLoading: boolean; error: string | null;
  role: string | null; userId: number | null; roles: string[];
  email: string | null; firstName: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};
const AuthContext = createContext<AuthState | null>(null);

function claimsFrom(token: string) {
  try {
    const encoded = token.split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!encoded) throw new Error('INVALID_ACCESS_TOKEN');
    const claims = JSON.parse(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')));
    if (!claims || typeof claims !== 'object') throw new Error('INVALID_ACCESS_TOKEN');
    return claims;
  } catch { throw new Error('INVALID_ACCESS_TOKEN'); }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = sessionGeneration;
  const mounted = useRef(true);
  const identity = useRef<number | null>(null);
  const activeGeneration = useRef<number | null>(generation.current);
  const flight = useRef<{ generation: number; promise: Promise<string | null> } | null>(null);

  // Native writes already dispatched cannot be cancelled. Serialize all writes and
  // cleanup, fencing between awaits so a newer session always has the final write.
  const serialize = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const next = storageTail.then(operation);
    storageTail = next.catch(() => undefined);
    return next;
  }, []);
  const requireCurrent = useCallback((epoch: number) => {
    if (!mounted.current || generation.current !== epoch) throw new Error('OBSOLETE_AUTH_SESSION');
  }, []);
  const project = useCallback((access: string, epoch: number) => {
    requireCurrent(epoch);
    const claims = claimsFrom(access);
    identity.current = Number.isSafeInteger(claims.user_id) ? claims.user_id : null;
    activeGeneration.current = epoch;
    apiClient.defaults.headers.common.Authorization = `Bearer ${access}`;
    setToken(access);
    setUserId(identity.current);
    const claimedRole = Array.isArray(claims.shop_roles) ? claims.shop_roles[0] : claims.role;
    setRole(typeof claimedRole === 'string' ? claimedRole : null);
    setEmail(typeof claims.email === 'string' ? claims.email : null);
    setFirstName(typeof claims.first_name === 'string' ? claims.first_name : null);
  }, [requireCurrent]);
  const clearSession = useCallback(async (epoch: number) => {
    if (generation.current !== epoch) return;
    const clearedEpoch = ++generation.current;
    sessionInvalidated = true;
    activeGeneration.current = null;
    identity.current = null;
    delete apiClient.defaults.headers.common.Authorization;
    if (mounted.current) {
      setToken(null); setRole(null); setUserId(null); setEmail(null); setFirstName(null);
    }
    await serialize(async () => {
      if (generation.current !== clearedEpoch) return;
      const failures: { key: string; cause: unknown }[] = [];
      for (const key of [ACCESS_TOKEN_KEY, REFRESH_TOKEN_KEY]) {
        if (generation.current !== clearedEpoch) return;
        try { await SecureStore.deleteItemAsync(key); }
        catch (cause) { failures.push({ key, cause }); }
      }
      if (generation.current !== clearedEpoch || failures.length === 0) return;
      // Surviving credentials must not be trusted on the next app launch.
      let durableInvalidation = false;
      let invalidationFailure: unknown;
      try {
        await SecureStore.setItemAsync(INVALIDATED_SESSION_KEY, '1');
        durableInvalidation = true;
      } catch (cause) { invalidationFailure = cause; }
      invalidationError = 'LOCAL_LOGOUT_CLEANUP_FAILED';
      if (mounted.current && generation.current === clearedEpoch) setError(invalidationError);
      throw Object.assign(new Error('LOCAL_LOGOUT_CLEANUP_FAILED'), {
        failedKeys: failures.map(({ key }) => key), failures,
        durableInvalidation, invalidationFailure,
      });
    });
  }, [serialize]);
  const persist = useCallback(async (access: string, refresh: string, epoch: number) => {
    await serialize(async () => {
      requireCurrent(epoch);
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, access);
      requireCurrent(epoch);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refresh);
      requireCurrent(epoch);
      // Refresh cannot release a logout fence: it is already generation-fenced.
      // A new explicit login replaces both credentials before removing the marker.
      await SecureStore.deleteItemAsync(INVALIDATED_SESSION_KEY);
      requireCurrent(epoch);
      sessionInvalidated = false;
      invalidationError = null;
      project(access, epoch);
    });
  }, [serialize, requireCurrent, project]);

  const tryRefresh = useCallback((epoch: number): Promise<string | null> => {
    if (activeGeneration.current === null) return Promise.reject(new Error('OBSOLETE_AUTH_SESSION'));
    if (flight.current?.generation === epoch) return flight.current.promise;
    const expectedUser = identity.current;
    const promise = (async () => {
      requireCurrent(epoch);
      const refreshToken = await serialize(() => SecureStore.getItemAsync(REFRESH_TOKEN_KEY));
      requireCurrent(epoch);
      if (!refreshToken) return null;
      const { data } = await apiClient.post('/api/v1/auth/refresh_token', { refreshToken }, { withCredentials: false });
      requireCurrent(epoch);
      const claims = claimsFrom(data.accessToken);
      if (!Number.isSafeInteger(claims.user_id) || claims.user_id <= 0 ||
          (expectedUser !== null && claims.user_id !== expectedUser)) {
        throw new Error('REFRESH_IDENTITY_MISMATCH');
      }
      if (typeof data.refreshToken !== 'string' || !data.refreshToken) throw new Error('REFRESH_RESPONSE_MISSING_TOKEN');
      await persist(data.accessToken, data.refreshToken, epoch);
      requireCurrent(epoch);
      return data.accessToken as string;
    })().finally(() => {
      if (flight.current?.promise === promise) flight.current = null;
    });
    flight.current = { generation: epoch, promise };
    return promise;
  }, [serialize, requireCurrent, persist]);

  useEffect(() => {
    mounted.current = true;
    const epoch = generation.current;
    (async () => {
      try {
        const invalidated = await serialize(() => SecureStore.getItemAsync(INVALIDATED_SESSION_KEY));
        requireCurrent(epoch);
        if (sessionInvalidated || invalidated !== null) {
          sessionInvalidated = true;
          activeGeneration.current = null;
          delete apiClient.defaults.headers.common.Authorization;
          setError(invalidated !== null ? 'LOCAL_LOGOUT_CLEANUP_FAILED' : invalidationError);
          return;
        }
        const stored = await serialize(() => SecureStore.getItemAsync(ACCESS_TOKEN_KEY));
        requireCurrent(epoch);
        let claims;
        try { claims = stored ? claimsFrom(stored) : null; } catch { claims = null; }
        identity.current = Number.isSafeInteger(claims?.user_id) ? claims.user_id : null;
        if (stored && claims && claims.exp * 1000 > Date.now()) project(stored, epoch);
        else if (!await tryRefresh(epoch)) await clearSession(epoch);
      } catch (failure: any) {
        if (mounted.current && generation.current === epoch && failure?.response?.status !== 503) {
          setError('AUTH_STORAGE_UNAVAILABLE');
          try { await clearSession(epoch); }
          catch { /* clearSession already exposes the native cleanup failure. */ }
        }
      } finally { if (mounted.current) setIsLoading(false); }
    })();
    return () => {
      mounted.current = false;
      activeGeneration.current = null;
    };
  }, [serialize, requireCurrent, project, tryRefresh, clearSession]);

  useEffect(() => {
    const requestInterceptor = apiClient.interceptors.request.use(config => {
      if (AUTH_ROUTES.includes(config.url ?? '')) return config;
      if (activeGeneration.current === null) return Promise.reject(new Error('OBSOLETE_AUTH_SESSION'));
      const request = config as typeof config & { _authGeneration?: number };
      if (request._authGeneration !== undefined) requireCurrent(request._authGeneration);
      request._authGeneration = generation.current;
      return config;
    });
    const responseInterceptor = apiClient.interceptors.response.use(response => response, async failure => {
      const config = failure?.config;
      if (!config || AUTH_ROUTES.includes(config.url) || config._retried ||
          (failure?.response?.status !== 401 && failure?.response?.data?.error !== 'TOKEN_EXPIRED')) {
        return Promise.reject(failure);
      }
      const epoch = config._authGeneration ?? generation.current;
      if (epoch !== generation.current) return Promise.reject(failure);
      config._retried = true;
      try {
        const access = await tryRefresh(epoch);
        requireCurrent(epoch);
        if (!access) { await clearSession(epoch); return Promise.reject(failure); }
        config.headers.Authorization = `Bearer ${access}`;
        return apiClient.request(config);
      } catch (refreshFailure: any) {
        const status = refreshFailure?.response?.status;
        if (mounted.current && generation.current === epoch && (status === 401 || status === 403 ||
            refreshFailure?.response?.data?.error === 'REFRESH_TOKEN_CONFLICT' ||
            refreshFailure?.message === 'REFRESH_IDENTITY_MISMATCH' ||
            refreshFailure?.message === 'REFRESH_RESPONSE_MISSING_TOKEN' ||
            refreshFailure?.message === 'INVALID_ACCESS_TOKEN')) await clearSession(epoch);
        return Promise.reject(failure);
      }
    });
    return () => {
      apiClient.interceptors.request.eject(requestInterceptor);
      apiClient.interceptors.response.eject(responseInterceptor);
    };
  }, [tryRefresh, requireCurrent, clearSession]);

  const login = useCallback(async (email: string, password: string) => {
    const epoch = ++generation.current;
    activeGeneration.current = null;
    setError(null);
    try {
      const { data } = await apiClient.post('/api/v1/auth/login', { email, password }, { withCredentials: false });
      requireCurrent(epoch);
      await persist(data.accessToken, data.refreshToken, epoch);
    } catch (failure: any) {
      if (generation.current !== epoch) throw failure;
      const message = failure?.response?.data?.error ?? 'Login failed. Check your credentials.';
      if (mounted.current) setError(message);
      await clearSession(epoch);
      throw new Error(message);
    }
  }, [persist, requireCurrent, clearSession]);

  const logout = useCallback(async () => {
    const epoch = ++generation.current;
    activeGeneration.current = null;
    sessionInvalidated = true;
    try {
      const refreshToken = await serialize(() => SecureStore.getItemAsync(REFRESH_TOKEN_KEY));
      await apiClient.post('/api/v1/auth/logout', { refreshToken }, { withCredentials: false });
    } catch {
      // Revocation is unconfirmed; always complete local cleanup for this epoch.
    } finally { await clearSession(epoch); }
  }, [serialize, clearSession]);

  return <AuthContext.Provider value={{ isAuthenticated: token !== null, isLoading, error,
    role, userId, roles: role ? [role] : [], email, firstName, login, logout }}>
    {children}
  </AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

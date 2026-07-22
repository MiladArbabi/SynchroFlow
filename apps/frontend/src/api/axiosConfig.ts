// apps/frontend/src/api/axiosConfig.ts

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { getToken, setToken, clearToken, notifyTokenRefreshed } from 'utils/authStore';

/**
 * AXIOS AUTH PHILOSOPHY (v3 — silent refresh + error-aware retry)
 * ────────────────────────────────────────────────────────────────
 * - Access token: 15-min JWT, injected into every non-auth request
 * - Refresh token: 7-day HttpOnly cookie, never touched by JS directly
 * - Single-flight: concurrent refresh triggers queue behind one call
 *
 * WHEN A REFRESH IS TRIGGERED (response interceptor):
 * - 401 on any non-auth route → always refreshable (token expired/invalid)
 * - 403 TIER_INSUFFICIENT → refreshable (ENT-01): the access token's `tier`
 *   claim can go stale the moment a shop upgrades/downgrades, even though
 *   the token is otherwise still valid for its full 15-min window.
 *   requireTier() (backend) reads tier straight off the JWT claim, so the
 *   only way to pick up a plan change without a full re-login is to force
 *   a refresh, which re-resolves tier fresh via resolveTierForShop().
 * - 403 from requireAction/requireRole (permission/role denial) → NOT
 *   refreshable. Refreshing re-derives tier and identity, not permissions —
 *   retrying cannot change who the user is, so this must stay excluded or
 *   every permission error becomes a pointless extra round-trip.
 *
 * WHAT HAPPENS INSIDE silentRefresh() (AUTH-02):
 * - The backend's POST /auth/refresh_token returns distinct, deliberate
 *   error shapes (see auth.controller.ts):
 *     503 REFRESH_TEMPORARILY_UNAVAILABLE, retryable: true  → transient
 *     401 SESSION_EXPIRED                                    → terminal
 *     403 SESSION_COMPROMISED                                → terminal
 * - Previously (v2) any failure at all — including the transient 503 —
 *   triggered immediate hardLogout(). In practice this meant a momentary
 *   DB blip or hitting the refresh rate limiter (10/min) could silently
 *   end an active operator's session mid-workflow, with no way to resume
 *   short of logging back in from scratch.
 * - Now: only genuinely transient failures (503 retryable, or no response
 *   at all / network error) get ONE retry via performRefresh() before
 *   giving up. SESSION_EXPIRED / SESSION_COMPROMISED still hardLogout
 *   immediately — retrying those can never succeed.
 *
 * Guarantees:
 * - No refresh loops (isRefreshing gate + originalRequest._retry)
 * - No poisoned login (auth routes excluded)
 * - No identity corruption (clearToken before hardLogout)
 * - Active WMS operators mid-workflow are not interrupted by token expiry,
 *   a mid-session tier change, or a single transient refresh failure
 */

// ─────────────────────────────────────────────────────────────
// Axios instance (SINGLE source of truth)
// ─────────────────────────────────────────────────────────────
const axiosInstance = axios.create();

// Typed window extension for PostHog (avoids unsafe `any`)
interface WindowWithPostHog extends Window {
  posthog?: { capture: (event: string, props?: Record<string, unknown>) => void };
}

// ─────────────────────────────────────────────────────────────
// Routes exempt from auth injection and refresh logic
// ─────────────────────────────────────────────────────────────
const AUTH_ROUTES = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/logout',
  '/api/v1/auth/refresh_token',
];

function isAuthRoute(url?: string): boolean {
  return !!url && AUTH_ROUTES.some(route => url.startsWith(route));
}

// ─────────────────────────────────────────────────────────────
// HARD LOGOUT (terminal, one-way)
// ─────────────────────────────────────────────────────────────
function hardLogout(reason: string): void {
  console.warn('[AUTH] Hard logout triggered:', reason);

  clearToken();
  delete axiosInstance.defaults.headers.common.Authorization;

  // Save current route so login can return user to where they were
  const currentPath = window.location.pathname + window.location.search;
  if (currentPath !== '/login') {
    sessionStorage.setItem('returnTo', currentPath);
  }

  // PostHog: session terminated (non-fatal analytics — wrapped defensively)
  try {
    const ph = (window as WindowWithPostHog).posthog;
    if (ph?.capture) {
      ph.capture('auth.session.terminated', { reason });
    }
  } catch { /* non-fatal */ }

  window.location.href = '/login';
}

// ─────────────────────────────────────────────────────────────
// SINGLE-FLIGHT REFRESH STATE
// ─────────────────────────────────────────────────────────────

/**
 * While a refresh is in flight, all queued 401 retries hold here.
 * Resolves with the new access token on success, rejects on failure.
 * Reset to null after each cycle so the next expiry starts fresh.
 */
let isRefreshing = false;
let refreshPromise: Promise<string> | null = null;

/**
 * AUTH-02: single attempt against POST /auth/refresh_token.
 * Extracted so silentRefresh() can retry it once for transient failures
 * without re-entering the single-flight gate.
 */
async function performRefresh(): Promise<string> {
  const res = await axios.post(
    '/api/v1/auth/refresh_token',
    {},
    { withCredentials: true } // sends HttpOnly refreshToken cookie
  );
  const newToken: string = res.data.accessToken;
  if (!newToken) throw new Error('REFRESH_RESPONSE_MISSING_TOKEN');

  setToken(newToken);
  axiosInstance.defaults.headers.common.Authorization = `Bearer ${newToken}`;
  notifyTokenRefreshed(newToken);

  try {
    const ph = (window as WindowWithPostHog).posthog;
    if (ph?.capture) ph.capture('auth.token.refreshed_silently');
  } catch { /* non-fatal */ }

  console.info('[AUTH] Silent refresh succeeded');
  return newToken;
}

/**
 * AUTH-02: only retry refresh failures the backend explicitly marks as
 * transient (503 REFRESH_TEMPORARILY_UNAVAILABLE, retryable: true) or a
 * network error (no response at all). 401 SESSION_EXPIRED and
 * 403 SESSION_COMPROMISED are terminal — retrying cannot fix them.
 */
interface RefreshErrorPayload {
  error?: string;
  retryable?: boolean;
}

function isRetryableRefreshError(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false;
  const axiosErr = err as AxiosError<RefreshErrorPayload>;
  const status = axiosErr.response?.status;
  const code = axiosErr.response?.data?.error;
  return (
    status === undefined ||
    (status === 503 &&
      (axiosErr.response?.data?.retryable === true || code === 'REFRESH_TEMPORARILY_UNAVAILABLE'))
  );
}

async function silentRefresh(): Promise<string> {
  if (isRefreshing && refreshPromise) {
    // Another request already kicked off a refresh — queue behind it
    return refreshPromise;
  }

  isRefreshing = true;

  refreshPromise = performRefresh()
    .catch(async initialErr => {
      let err = initialErr;

      if (isRetryableRefreshError(err)) {
        console.warn(
          '[AUTH] Silent refresh transient failure — retrying once',
          err?.response?.status,
          err?.response?.data?.error
        );
        try {
          return await performRefresh();
        } catch (retryErr) {
          err = retryErr;
        }
      }

      const status = err?.response?.status;
      const code = err?.response?.data?.error;

      try {
        const ph = (window as WindowWithPostHog).posthog;
        if (ph?.capture) {
          ph.capture('auth.token.refresh_failed', {
            status: status ?? 'network_error',
            code: code ?? null,
          });
        }
      } catch { /* non-fatal */ }

      console.warn('[AUTH] Silent refresh failed — logging out', status, code);
      hardLogout('refresh_failed');
      throw err;
    })
    .finally(() => {
      isRefreshing = false;
      refreshPromise = null;
    });

  return refreshPromise;
}

// ─────────────────────────────────────────────────────────────
// Request interceptor — inject Authorization header
// ─────────────────────────────────────────────────────────────
axiosInstance.interceptors.request.use(
  config => {
    if (isAuthRoute(config.url)) {
      delete config.headers?.Authorization;
      return config;
    }

    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      delete config.headers?.Authorization;
    }

    if (import.meta.env.MODE === 'development') {
      console.debug('[HTTP →]', config.method?.toUpperCase(), config.url, 'auth:', Boolean(token));
    }

    return config;
  },
  error => Promise.reject(error)
);

// ─────────────────────────────────────────────────────────────
// Response interceptor — silent refresh on 401
// ─────────────────────────────────────────────────────────────

/**
 * AUTH INVARIANT
 * ──────────────
 * - 401s on auth routes are EXPECTED (wrong password etc.) — never refresh
 * - 401s post-auth with a token → attempt silent refresh once
 * - 401s post-auth without a token → hardLogout (no session to recover)
 * - _retry flag prevents infinite loops if /overview itself returns 401
 */
axiosInstance.interceptors.response.use(
  response => response,
  async error => {
    const status: number | undefined = error?.response?.status;
    const url: string | undefined = error?.config?.url;
    const originalRequest: AxiosRequestConfig & { _retry?: boolean } = error?.config ?? {};

    if (import.meta.env.MODE === 'development') {
      console.warn('[HTTP ← ERROR]', status, url);
    }

    /**
     * ENT-01: a 403 TIER_INSUFFICIENT means the access token's tier claim is
     * stale (e.g. shop just upgraded) even though the token itself is still
     * valid — refreshing re-resolves tier fresh from the DB (see
     * entitlements.controller.ts / requireTier). Other 403s (role/permission
     * denials from requireAction/requireRole) are NOT refreshable — retrying
     * won't change who the user is, so they must stay excluded here.
     */
    const isStaleTier = status === 403 && error?.response?.data?.error === 'TIER_INSUFFICIENT';
    const isRefreshable = status === 401 || isStaleTier;

    if (!isRefreshable || originalRequest._retry || isAuthRoute(url)) {
      return Promise.reject(error);
    }

    // No token at all — nothing to refresh, hard logout immediately
    if (!getToken()) {
      hardLogout('401_no_token');
      return Promise.reject(error);
    }

    // Mark so we don't retry this request again after refresh
    originalRequest._retry = true;

    try {
      const newToken = await silentRefresh();
      // Inject new token and replay original request
      originalRequest.headers = {
        ...(originalRequest.headers ?? {}),
        Authorization: `Bearer ${newToken}`,
      };
      return axiosInstance(originalRequest);
    } catch {
      // silentRefresh already called hardLogout — just propagate
      return Promise.reject(error);
    }
  }
);

export { axiosInstance };
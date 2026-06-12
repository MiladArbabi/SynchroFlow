// apps/frontend/src/api/axiosConfig.ts

import axios, { AxiosRequestConfig } from 'axios';
import { getToken, setToken, clearToken, notifyTokenRefreshed } from 'utils/authStore';

/**
 * AXIOS AUTH PHILOSOPHY (v2 — silent refresh)
 * ────────────────────────────────────────────
 * - Access token: 15-min JWT, injected into every non-auth request
 * - Refresh token: 7-day HttpOnly cookie, never touched by JS directly
 * - On 401: attempt ONE silent refresh via POST /api/v1/auth/refresh_token
 *   - Success → update authStore + React state (via bridge), retry original request
 *   - Failure → hardLogout (token revoked / session expired)
 * - Single-flight: concurrent 401s queue behind one refresh call
 *
 * Guarantees:
 * - No refresh loops (isRefreshing gate)
 * - No poisoned login (auth routes excluded)
 * - No identity corruption (clearToken before hardLogout)
 * - Active WMS operators mid-workflow are never interrupted by token expiry
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

async function silentRefresh(): Promise<string> {
  if (isRefreshing && refreshPromise) {
    // Another request already kicked off a refresh — queue behind it
    return refreshPromise;
  }

  isRefreshing = true;

  refreshPromise = axios
    .post(
      '/api/v1/auth/refresh_token',
      {},
      { withCredentials: true } // sends HttpOnly refreshToken cookie
    )
    .then(res => {
      const newToken: string = res.data.accessToken;
      if (!newToken) throw new Error('REFRESH_RESPONSE_MISSING_TOKEN');

      // 1. Update module-level store + localStorage
      setToken(newToken);

      // 2. Update axios default header immediately for any requests
      //    that fire before the React re-render
      axiosInstance.defaults.headers.common.Authorization = `Bearer ${newToken}`;

      // 3. Notify AuthContext so React state stays in sync
      notifyTokenRefreshed(newToken);

      // PostHog: successful silent refresh (no PII)
      try {
        const ph = (window as WindowWithPostHog).posthog;
        if (ph?.capture) ph.capture('auth.token.refreshed_silently');
      } catch { /* non-fatal */ }

      console.info('[AUTH] Silent refresh succeeded');
      return newToken;
    })
    .catch(err => {
      // PostHog: refresh failed — user will be logged out
      try {
        const ph = (window as WindowWithPostHog).posthog;
        if (ph?.capture) {
          ph.capture('auth.token.refresh_failed', {
            status: err?.response?.status ?? 'network_error',
          });
        }
      } catch { /* non-fatal */ }

      console.warn('[AUTH] Silent refresh failed — logging out', err?.response?.status);
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

    // Not a 401, or already retried, or an auth route — pass through
    if (status !== 401 || originalRequest._retry || isAuthRoute(url)) {
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
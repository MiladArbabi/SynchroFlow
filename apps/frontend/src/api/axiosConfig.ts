// apps/frontend/src/api/axiosConfig.ts

import axios, { AxiosError, AxiosRequestConfig } from 'axios';
import { getToken, setToken, clearToken, notifyTokenRefreshed, getSessionGeneration } from 'utils/authStore';

/**
 * AXIOS AUTH PHILOSOPHY (v3 — silent refresh + error-aware retry)
 * ────────────────────────────────────────────────────────────────
 * - Access token: 15-min JWT, injected into every non-auth request
 * - Refresh token: 7-day HttpOnly cookie, never touched by JS directly
 * - Single-flight: concurrent refresh triggers queue behind one call
 *
 * WHEN A REFRESH IS TRIGGERED (response interceptor):
 * - 401 on any non-auth route → always refreshable (token expired/invalid)
 * - 403 TIER_INSUFFICIENT → refreshable (ENT-01, legacy stale-tier path):
 *   the access token's `tier` claim can go stale the moment a shop
 *   upgrades/downgrades, even though the token is otherwise still valid for
 *   its full 15-min window. requireTier() (backend) reads tier straight off
 *   the JWT claim, so the only way to pick up a plan change without a full
 *   re-login is to force a refresh, which re-resolves tier fresh via
 *   resolveTierForShop().
 * - 403 COMMERCIAL_ACCESS_DENIED (GH-1136) → refreshable ONLY when the held
 *   access token's `tier` claim differs from the backend's authoritative
 *   currentTier in the denial body. authenticateToken now independently
 *   re-resolves the CURRENT DB tier on every request, so this denial can
 *   mean either "the client is holding a stale pre-downgrade/upgrade
 *   token" (refresh fixes it) or "the shop's current plan genuinely lacks
 *   this capability" (an ordinary same-tier paywall denial — refreshing
 *   changes nothing and must not be attempted).
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
 * - No refresh loops (generation-scoped single-flight + originalRequest._retry)
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

function captureRefreshFailure(status: number | undefined, code: unknown): void {
  // Only known machine-readable codes: never forward arbitrary provider payloads.
  const safeCodes = ['SESSION_EXPIRED', 'SESSION_COMPROMISED', 'SHOP_CONTEXT_REQUIRED',
    'SHOP_CONTEXT_MISMATCH', 'REFRESH_TEMPORARILY_UNAVAILABLE', 'REFRESH_TOKEN_CONFLICT',
    'TOO_MANY_REQUESTS', 'REFRESH_IDENTITY_INVALID'];
  try {
    const ph = (window as WindowWithPostHog).posthog;
    ph?.capture?.('auth.token.refresh_failed', {
      status: status ?? 'network_error',
      code: typeof code === 'string' && safeCodes.includes(code) ? code : null,
    });
  } catch { /* Non-fatal analytics. */ }
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
let refreshGeneration = -1;
let cooldownGeneration = -1;
let refreshNotBefore = 0;
let refreshPromise: Promise<string> | null = null;

/**
 * AUTH-02: single attempt against POST /auth/refresh_token.
 * Extracted so silentRefresh() can retry it once for transient failures
 * without re-entering the single-flight gate.
 */
async function performRefresh(generation: number): Promise<string> {
  if (generation !== getSessionGeneration()) throw new Error('OBSOLETE_AUTH_SESSION');
  const res = await axios.post(
    '/api/v1/auth/refresh_token',
    {},
    { withCredentials: true } // sends HttpOnly refreshToken cookie
  );
  if (generation !== getSessionGeneration()) throw new Error('OBSOLETE_AUTH_SESSION');
  const newToken: string = res.data?.accessToken;
  const currentIdentity = readAccessTokenIdentity(getToken());
  const refreshedIdentity = readAccessTokenIdentity(newToken);
  if (!currentIdentity || !refreshedIdentity ||
      currentIdentity.userId !== refreshedIdentity.userId ||
      currentIdentity.shopId !== refreshedIdentity.shopId) {
    captureRefreshFailure(res.status ?? 200, 'REFRESH_IDENTITY_INVALID');
    hardLogout('refresh_identity_invalid');
    throw new Error('REFRESH_IDENTITY_INVALID');
  }

  setToken(newToken);
  axiosInstance.defaults.headers.common.Authorization = `Bearer ${newToken}`;
  notifyTokenRefreshed(newToken, generation);

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

async function silentRefresh(generation: number): Promise<string> {
  if (generation !== getSessionGeneration()) throw new Error('OBSOLETE_AUTH_SESSION');
  if (cooldownGeneration === generation && Date.now() < refreshNotBefore) {
    throw new Error('REFRESH_COOLDOWN');
  }
  if (refreshPromise && refreshGeneration === generation) return refreshPromise;
  refreshGeneration = generation;
  const current = performRefresh(generation).catch(async initialError => {
    if (generation !== getSessionGeneration()) throw initialError;
    let error = initialError;
    if (isRetryableRefreshError(error)) {
      try { return await performRefresh(generation); }
      catch (retryError) { error = retryError; }
    }
    if (generation !== getSessionGeneration()) throw error;
    const failure = error as AxiosError<RefreshErrorPayload & { retryAfter?: number }>;
    const status = failure.response?.status;
    captureRefreshFailure(status, failure.response?.data?.error);
    if (status === 429) {
      const seconds = Number(failure.response?.data?.retryAfter ?? failure.response?.headers?.['retry-after'] ?? 60);
      cooldownGeneration = generation;
      refreshNotBefore = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? seconds : 60) * 1000;
    } else if (status === 401 || status === 403 ||
        (status === 400 && failure.response?.data?.error === 'REFRESH_TOKEN_CONFLICT')) {
      hardLogout('refresh_failed');
    }
    // Transient exhaustion and cooldown preserve credentials, but reject the operation.
    throw error;
  }).finally(() => {
    if (refreshPromise === current) refreshPromise = null;
  });
  refreshPromise = current;
  return current;
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

    const sessionRequest = config as typeof config & { _sessionGeneration?: number };
    if (sessionRequest._sessionGeneration !== undefined &&
        sessionRequest._sessionGeneration !== getSessionGeneration()) {
      return Promise.reject(new Error('OBSOLETE_AUTH_SESSION'));
    }
    sessionRequest._sessionGeneration = getSessionGeneration();
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
// Commercial-tier claim inspection (GH-1136)
// ─────────────────────────────────────────────────────────────

/**
 * Recognized commercial tiers. Anything else (undefined, unrecognized
 * string, etc.) is treated as "unknown" and never drives a refresh decision.
 */
type CommercialTier = 'starter' | 'core' | 'growth' | 'scale';

function isCommercialTier(value: unknown): value is CommercialTier {
  return (
    value === 'starter' ||
    value === 'core' ||
    value === 'growth' ||
    value === 'scale'
  );
}

/**
 * Reads access JWT claims WITHOUT verifying the signature, for session
 * continuity and stale commercial metadata detection. Backend verification
 * and authorization remain authoritative.
 */
function readAccessTokenPayload(token: unknown): Record<string, unknown> | null {
  if (typeof token !== 'string' || !token) return null;

  try {
    const payloadSegment = token.split('.')[1];
    if (!payloadSegment) return null;

    const base64 = payloadSegment
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const padded = base64.padEnd(
      base64.length + ((4 - (base64.length % 4)) % 4),
      '='
    );

    const payload = JSON.parse(atob(padded));

    return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : null;
  } catch {
    return null;
  }
}

/** Claim decoding checks session continuity; backend JWT verification remains authoritative. */
function readAccessTokenIdentity(token: unknown): { userId: number; shopId: number } | null {
  const payload = readAccessTokenPayload(token);
  const userId = payload?.user_id;
  const shopId = payload?.shop_id;
  if (typeof userId !== 'number' || !Number.isSafeInteger(userId) || userId <= 0 ||
      typeof shopId !== 'number' || !Number.isSafeInteger(shopId) || shopId <= 0) return null;
  return { userId, shopId };
}

function readCommercialTierFromAccessToken(token: string | null): CommercialTier | null {
  const tier = readAccessTokenPayload(token)?.tier;
  return isCommercialTier(tier) ? tier : null;
}

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
    const originalRequest: AxiosRequestConfig & { _retry?: boolean; _sessionGeneration?: number } = error?.config ?? {};

    if (import.meta.env.MODE === 'development') {
      console.warn('[HTTP ← ERROR]', status, url);
    }

    /**
     * ENT-01 (legacy path): a 403 TIER_INSUFFICIENT means the access token's
     * tier claim is stale (e.g. shop just upgraded) even though the token
     * itself is still valid — refreshing re-resolves tier fresh from the DB
     * (see entitlements.controller.ts / requireTier). Other 403s (role/
     * permission denials from requireAction/requireRole) are NOT
     * refreshable — retrying won't change who the user is, so they must
     * stay excluded here.
     */
    const isStaleTier = status === 403 && error?.response?.data?.error === 'TIER_INSUFFICIENT';

    /**
     * GH-1136: 403 COMMERCIAL_ACCESS_DENIED means authenticateToken
     * independently re-resolved the CURRENT DB tier and found the caller's
     * capability insufficient. That is refreshable ONLY when it represents
     * stale client-side metadata — the held access token's `tier` claim
     * disagrees with the backend's authoritative currentTier (e.g. the shop
     * was downgraded mid-session and the client is still presenting the
     * pre-downgrade token). If the token's tier already matches
     * currentTier, this is an ordinary same-tier paywall denial and must
     * NOT trigger a refresh — refreshing cannot change a plan denial that
     * both sides already agree on.
     */
    const tokenTier = readCommercialTierFromAccessToken(getToken());
    const authoritativeTier = error?.response?.data?.currentTier;

    const isCanonicalStaleCommercialState =
      status === 403 &&
      error?.response?.data?.error === 'COMMERCIAL_ACCESS_DENIED' &&
      isCommercialTier(authoritativeTier) &&
      tokenTier !== null &&
      tokenTier !== authoritativeTier;

    const isRefreshable = status === 401 || isStaleTier || isCanonicalStaleCommercialState;

    if (!isRefreshable || originalRequest._retry || isAuthRoute(url)) {
      return Promise.reject(error);
    }

    const generation = originalRequest._sessionGeneration ?? getSessionGeneration();
    if (generation !== getSessionGeneration()) return Promise.reject(error);

    // No token at all — nothing to refresh, hard logout immediately
    if (!getToken()) {
      hardLogout('401_no_token');
      return Promise.reject(error);
    }

    // Mark so we don't retry this request again after refresh
    originalRequest._retry = true;

    try {
      const newToken = await silentRefresh(generation);
      if (generation !== getSessionGeneration()) return Promise.reject(error);
      // Inject new token and replay original request
      originalRequest.headers = {
        ...(originalRequest.headers ?? {}),
        Authorization: `Bearer ${newToken}`,
      };
      return axiosInstance(originalRequest);
    } catch {
      // Terminal failure, cooldown, or stale generation: reject the operation.
      return Promise.reject(error);
    }
  }
);

export { axiosInstance };

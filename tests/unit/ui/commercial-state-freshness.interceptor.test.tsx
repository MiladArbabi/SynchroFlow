// tests/unit/ui/commercial-state-freshness.interceptor.test.tsx
//
// GH-1136 — FRONTEND COMMERCIAL-STATE INVALIDATION — RED TEST ONLY.
// ===========================================================================
// authenticateToken (backend) now re-resolves the CURRENT DB tier on every
// request, so it independently rejects a stale-tier JWT with canonical
// COMMERCIAL_ACCESS_DENIED. But axiosConfig.ts's response interceptor only
// treats 401 and 403 TIER_INSUFFICIENT as refreshable — it does not
// recognize COMMERCIAL_ACCESS_DENIED at all, so a stale access token whose
// `tier` claim no longer matches the backend's currentTier is never sent
// through the existing silent-refresh pipeline
// (axiosConfig -> notifyTokenRefreshed -> AuthContext.setAccessToken ->
// EntitlementsContext -> GET /api/v1/entitlements/me). The user is left
// stuck behind a stale entitlement snapshot instead of being silently
// upgraded/downgraded to their current commercial state.
//
// This file proves that gap. It is EXPECTED TO BE RED on current main for
// the stale-mismatch case. Do not fix axiosConfig.ts here.

import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { axiosInstance } from 'api/axiosConfig';
import { getToken, setToken, clearToken, notifyTokenRefreshed, getSessionGeneration } from 'utils/authStore';

let mockSessionGeneration = 1;

jest.mock('utils/authStore', () => ({
  getToken: jest.fn(),
  setToken: jest.fn(),
  clearToken: jest.fn(),
  notifyTokenRefreshed: jest.fn(),
  getSessionGeneration: jest.fn(() => mockSessionGeneration),
}));

const mockedGetToken = getToken as jest.Mock;
const mockedSetToken = setToken as jest.Mock;
const mockedClearToken = clearToken as jest.Mock;
const mockedNotifyTokenRefreshed = notifyTokenRefreshed as jest.Mock;
const mockedGetSessionGeneration = getSessionGeneration as jest.Mock;

const FLOOR_PLANNING_ROUTE = '/api/v1/floor-planning/layout';

/** Syntactically valid, unsigned JWT — frontend code here only reads claims
 * out of the payload, never verifies the signature. */
function makeJwt(payload: Record<string, unknown>): string {
  const b64url = (obj: Record<string, unknown>): string =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  return `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url(payload)}.unsigned-test-signature`;
}

function getResponseInterceptorRejectedHandler(): (error: unknown) => Promise<unknown> {
  // as tests/unit/ui/axiosConfig.test.tsx.
  return axiosInstance.interceptors.response.handlers[0].rejected;
}

describe('GH-1136 — commercial-state freshness must trigger silent refresh on a stale-tier COMMERCIAL_ACCESS_DENIED', () => {
  let mockAdapter: MockAdapter;
  let postSpy: jest.SpyInstance;
  let currentToken: string | null = null;

  beforeEach(() => {
    mockAdapter = new MockAdapter(axiosInstance);
    postSpy = jest.spyOn(axios, 'post');
    mockedGetToken.mockReset();
    mockedSetToken.mockReset();
    mockedClearToken.mockReset();
    mockedNotifyTokenRefreshed.mockReset();
    mockedGetSessionGeneration.mockReset();

    mockSessionGeneration = 1;
    currentToken = null;
    mockedGetSessionGeneration.mockImplementation(() => mockSessionGeneration);
    mockedGetToken.mockImplementation(() => currentToken);
    mockedSetToken.mockImplementation((token: string | null) => {
      currentToken = token;
    });
    mockedClearToken.mockImplementation(() => {
      mockSessionGeneration += 1;
      currentToken = null;
    });
  });

  afterEach(() => {
    mockAdapter.restore();
    postSpy.mockRestore();
  });

  it('stale-mismatch: JWT tier=growth vs backend currentTier=starter triggers silent refresh and replays with the new token', async () => {
    const staleGrowthToken = makeJwt({ user_id: 1, shop_id: 77, tier: 'growth' });
    const newStarterToken = makeJwt({ user_id: 1, shop_id: 77, tier: 'starter' });

    currentToken = staleGrowthToken;
    postSpy.mockResolvedValue({ data: { accessToken: newStarterToken } });

    // Replay of the original request must not hit the real network.
    mockAdapter.onGet(FLOOR_PLANNING_ROUTE).reply(200, { ok: true });

    const originalRequest = {
      url: FLOOR_PLANNING_ROUTE,
      method: 'get',
      headers: {},
    };

    const error = {
      config: originalRequest,
      response: {
        status: 403,
        data: {
          error: 'COMMERCIAL_ACCESS_DENIED',
          reason: 'TIER_TOO_LOW',
          capabilityId: 'warehouse.floor_planning',
          currentTier: 'starter',
          requiredTier: 'growth',
        },
      },
    };

    const rejected = getResponseInterceptorRejectedHandler();

    let thrown: unknown;
    try {
      await rejected(error);
    } catch (e) {
      thrown = e;
    }

    // EXPECTED CONTRACT (currently RED — axiosConfig does not recognize
    // COMMERCIAL_ACCESS_DENIED at all, so it rejects immediately without
    // ever calling the refresh endpoint).
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith(
      '/api/v1/auth/refresh_token',
      {},
      expect.objectContaining({ withCredentials: true }),
    );

    expect(mockedSetToken).toHaveBeenCalledWith(newStarterToken);
    expect(mockedNotifyTokenRefreshed).toHaveBeenCalledWith(newStarterToken, 1);

    // Original request replayed with the NEW token.
    expect(mockAdapter.history.get.length).toBe(1);
    expect(mockAdapter.history.get[0].headers?.Authorization).toBe(`Bearer ${newStarterToken}`);

    // No hard logout.
    expect(mockedClearToken).not.toHaveBeenCalled();

    // No infinite refresh loop — exactly one refresh attempt.
    expect(postSpy).toHaveBeenCalledTimes(1);

    // The handler must have resolved (via the replayed request), not
    // rejected, once the stale-tier case is treated as refreshable.
    expect(thrown).toBeUndefined();
  });

  it('negative control: JWT tier === backend currentTier === starter is a legitimate paywall denial, not stale metadata — no refresh', async () => {
    const currentStarterToken = makeJwt({ user_id: 1, shop_id: 77, tier: 'starter' });

    currentToken = currentStarterToken;
    postSpy.mockResolvedValue({ data: { accessToken: 'should-not-be-used' } });

    const originalRequest = {
      url: FLOOR_PLANNING_ROUTE,
      method: 'get',
      headers: {},
    };

    const error = {
      config: originalRequest,
      response: {
        status: 403,
        data: {
          error: 'COMMERCIAL_ACCESS_DENIED',
          reason: 'TIER_TOO_LOW',
          capabilityId: 'warehouse.floor_planning',
          currentTier: 'starter',
          requiredTier: 'growth',
        },
      },
    };

    const rejected = getResponseInterceptorRejectedHandler();

    await expect(rejected(error)).rejects.toBe(error);

    // A legitimate plan denial (token tier already matches backend
    // currentTier) must NOT trigger a pointless refresh.
    expect(postSpy).not.toHaveBeenCalled();
    expect(mockedSetToken).not.toHaveBeenCalled();
    expect(mockedNotifyTokenRefreshed).not.toHaveBeenCalled();
    expect(mockedClearToken).not.toHaveBeenCalled();
  });
});

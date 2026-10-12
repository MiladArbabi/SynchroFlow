/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { PublicUser } from 'api-types';
import { getToken, setToken, clearToken, setOnTokenRefreshed, getSessionGeneration, advanceSessionGeneration } from 'utils/authStore';
import { axiosInstance } from 'api/axiosConfig';
import { identifyUser, groupByShop, resetAnalyticsIdentity } from '../analytics/adapter';

// --- Define State Shape ---
type SessionUser = PublicUser & { role?: string };
interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean; // For initial auth check (e.g., checking refresh token)
  user: SessionUser | null;
  accessToken: string | null;
}

// --- Define Context Shape ---
interface AuthContextType extends AuthState {
  login: (user: PublicUser, accessToken: string) => void;
  logout: () => Promise<void>;
  setAccessToken: (token: string | null) => void; // Needed for token refresh
}

// --- Create Context ---
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * #1164 — CANONICAL JWT IDENTITY
 * ───────────────────────────────
 * The access token's user_id is the authenticated identity the backend acts
 * on. A persisted `user` from an earlier session must never override it.
 * Decoding is best-effort: an opaque/undecodable token yields null and the
 * caller keeps the user it already has (normalization fails closed, it never
 * logs anyone out).
 */
function decodeJwtPayload(token: string): Record<string, any> | null {
  try {
    const segment = token.split('.')[1];
    if (!segment) return null;
    const payload = JSON.parse(atob(segment.replace(/-/g, '+').replace(/_/g, '/')));
    return payload && typeof payload === 'object' ? payload : null;
  } catch {
    return null;
  }
}

function jwtUserId(token: string | null): number | null {
  if (!token) return null;
  const userId = decodeJwtPayload(token)?.user_id;
  return Number.isSafeInteger(userId) && userId > 0 ? userId : null;
}

/** Returns `user` with id following the token; the same object when already canonical. */
function withTokenIdentity(user: PublicUser, token: string | null): PublicUser {
  const tokenUserId = jwtUserId(token);
  if (tokenUserId === null || user.id === tokenUserId) return user;
  return { ...user, id: tokenUserId };
}

/** Only preserve non-JWT metadata when it belongs to the same user and shop. */
function projectRefreshedUser(user: PublicUser | null, token: string): PublicUser | null {
  const claims = decodeJwtPayload(token);
  const id = jwtUserId(token);
  if (!claims || id === null) return user;
  const sameIdentity = user?.id === id && user?.shop_id === claims.shop_id;
  return {
    ...(sameIdentity ? user : {}),
    id,
    role: Array.isArray(claims.shop_roles) && typeof claims.shop_roles[0] === 'string'
      ? claims.shop_roles[0] : undefined,
    plan: typeof claims.tier === 'string' ? claims.tier : undefined,
    shop_id: Number.isSafeInteger(claims.shop_id) ? claims.shop_id : undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    first_name: typeof claims.first_name === 'string' ? claims.first_name : null,
  } as PublicUser;
}

// --- Create Provider Component ---
interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [authState, setAuthState] = useState<AuthState>({
    isLoggedIn: false,
    isLoading: true, // Start in loading state
    user: null,
    accessToken: null,
  });

  // Re-hydrate session from localStorage on app load
  React.useEffect(() => {

    // 🔐 OAUTH HANDOFF (URL → AUTH STATE)
    const params = new URLSearchParams(window.location.search);
    const tokenFromUrl = params.get('token');
    const connectParam = params.get('connect');
    
    // 'success' = direct/reconnect OAuth completion
    // 'app_store' = Shopify App Store install completion (handleShopifyInstall flow)
    if ((connectParam === 'success' || connectParam === 'app_store') && tokenFromUrl) {
      /* console.info('[AUTH][OAUTH_HANDOFF] token detected in URL'); */

      // Store token immediately
      advanceSessionGeneration();
      setToken(tokenFromUrl);

      // ⚠️ User must be fetched OR decoded (depending on your system)
      // TEMP: mark as logged in without user hydration
      // Decode JWT payload (base64) to extract shop_id and user claims.
      // No library needed — JWT payload is standard base64url.
      let decodedUser = null;
      const payload = decodeJwtPayload(tokenFromUrl);
      if (payload) {
        decodedUser = {
          id: jwtUserId(tokenFromUrl),
          shop_id: payload.shop_id ?? null,
          plan: payload.tier ?? null,
          trial_ends_at: payload.trial_ends_at ?? null,
          created_at: payload.created_at ?? null,
          role: Array.isArray(payload.shop_roles) && typeof payload.shop_roles[0] === 'string'
            ? payload.shop_roles[0] : undefined,
          email: payload.email ?? null,
          first_name: payload.first_name ?? null,
        } as unknown as PublicUser;
        // Persist so a hard reload rehydrates this identity, not a stale one.
        localStorage.setItem('user', JSON.stringify(decodedUser));
      } else {
        console.warn('[AUTH][OAUTH_HANDOFF] JWT decode failed — user will be null');
      }
      setAuthState({
        isLoggedIn: true,
        isLoading: false,
        user: decodedUser,
        accessToken: tokenFromUrl,
      });

      // Clean URL secrets while preserving the destination route and safe handoff params.
      params.delete('token');
      params.delete('connect');
      const search = params.toString();
      window.history.replaceState(
        {},
        document.title,
        `${window.location.pathname}${search ? `?${search}` : ''}${window.location.hash}`,
      );

      return;
    }
    /* console.log("AuthContext: Initializing..."); */
    try {
      // Playwright's storageState will inject these values
      const storedToken = getToken();
      const storedUser = localStorage.getItem('user');
      
      if (storedToken && storedUser) {
        const storedParsedUser = JSON.parse(storedUser);
        const parsedUser = storedParsedUser
          ? withTokenIdentity(storedParsedUser, storedToken)
          : storedParsedUser;
        if (parsedUser !== storedParsedUser) {
          localStorage.setItem('user', JSON.stringify(parsedUser));
        }
        setAuthState({
          isLoggedIn: true,
          isLoading: false,
          user: parsedUser,
          accessToken: storedToken,
        });

        /**
         * SESSION HYDRATION IDENTITY (PH-01)
         * ────────────────────────────────────
         * Returning user — re-identify on every page load so PostHog
         * maintains the link between the authenticated user and the
         * current anonymous session cookie.
         * Without this, a returning user who reloads the app loses
         * PostHog identity until they explicitly log in again.
         */
        if (parsedUser?.id) {
          identifyUser(parsedUser.id, parsedUser.shop_id, {
            plan: parsedUser.plan,
            trial_ends_at: parsedUser.trial_ends_at,
            created_at: parsedUser.created_at,
          });
          if (parsedUser.shop_id) groupByShop(parsedUser.shop_id);
        }
      } else {
        /* console.log("AuthContext: No stored session found."); */
        // No session, just finish loading
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      /* console.error("AuthContext: Failed to parse stored user. Logging out.", error); */
      // Clear corrupted storage and finish loading
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      setAuthState(prev => ({ ...prev, isLoading: false, isLoggedIn: false, user: null, accessToken: null }));
    }
  }, []);

  const setAccessToken = useCallback((token: string | null) => {
    setAuthState(prev => ({ ...prev, accessToken: token }));
    if (token) {
      setToken(token);
    } else {
      clearToken();
    }
    console.info('[AUTH] setAccessToken():', Boolean(token));
  }, []);

  /**
   * SILENT REFRESH BRIDGE
   * ──────────────────────
   * Wires axiosConfig's notifyTokenRefreshed() into React state.
   * Called by the Axios interceptor after every successful silent refresh
   * so AuthContext.accessToken stays in sync with authStore + the
   * Authorization header — without a full re-login or page reload.
   *
   * Mounted once; the callback ref in authStore is replaced on each
   * mount (safe — only one AuthProvider exists in the tree).
   */
  React.useEffect(() => {
    setOnTokenRefreshed((newToken, generation) => {
      if (generation !== getSessionGeneration()) return;
      setAuthState(prev => {
        if (generation !== getSessionGeneration()) return prev;
        if (!newToken) return { isLoggedIn: false, isLoading: false, user: null, accessToken: null };
        const user = projectRefreshedUser(prev.user, newToken);
        if (user) localStorage.setItem('user', JSON.stringify(user));
        else localStorage.removeItem('user');
        return { ...prev, isLoggedIn: true, user, accessToken: newToken };
      });
    });
    return () => setOnTokenRefreshed(null);
  }, []);

  const login = useCallback((suppliedUser: PublicUser, accessToken: string) => {
    advanceSessionGeneration();
    const user = withTokenIdentity(suppliedUser, accessToken);
    setAuthState({
      isLoggedIn: true,
      isLoading: false,
      user,
      accessToken,
    });
    setToken(accessToken);
    localStorage.setItem('user', JSON.stringify(user));
    console.info('[AUTH] login(): token stored via authStore');
  }, []);

  const logout = useCallback(async () => {
    advanceSessionGeneration();
    // Start revocation before clearing locally; its failure never retains credentials.
    const revocation = axiosInstance.post('/api/v1/auth/logout', {}, { withCredentials: true })
      .catch(() => { console.warn('[AUTH] Server logout unconfirmed; local session cleared'); });
    delete axiosInstance.defaults.headers.common.Authorization;
    resetAnalyticsIdentity();
    setAuthState({
      isLoggedIn: false,
      isLoading: false,
      user: null,
      accessToken: null,
    });
    clearToken();
    localStorage.removeItem('user');
    console.info('[AUTH] logout(): token cleared via authStore');
    await revocation;
  }, []);

  const value = {
    ...authState,
    login,
    logout,
    setAccessToken,
  };

  // Render children only after initial loading is false
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// --- Create Hook for easy access ---
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

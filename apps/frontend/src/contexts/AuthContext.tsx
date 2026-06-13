/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { PublicUser } from 'api-types';
import { getToken, setToken, clearToken, setOnTokenRefreshed } from 'utils/authStore';
import { identifyUser, groupByShop } from '../analytics/adapter';

// --- Define State Shape ---
interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean; // For initial auth check (e.g., checking refresh token)
  user: PublicUser | null;
  accessToken: string | null;
}

// --- Define Context Shape ---
interface AuthContextType extends AuthState {
  login: (user: PublicUser, accessToken: string) => void;
  logout: () => void;
  setAccessToken: (token: string | null) => void; // Needed for token refresh
}

// --- Create Context ---
export const AuthContext = createContext<AuthContextType | undefined>(undefined);

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
    const connectSuccess = params.get('connect');

    if (connectSuccess === 'success' && tokenFromUrl) {
      console.info('[AUTH][OAUTH_HANDOFF] token detected in URL');

      // Store token immediately
      setToken(tokenFromUrl);

      // ⚠️ User must be fetched OR decoded (depending on your system)
      // TEMP: mark as logged in without user hydration
      // Decode JWT payload (base64) to extract shop_id and user claims.
      // No library needed — JWT payload is standard base64url.
      let decodedUser = null;
      try {
        const payload = JSON.parse(atob(tokenFromUrl.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        decodedUser = {
          shop_id: payload.shop_id ?? null,
          userId: payload.user_id ?? null,
          role: payload.shop_roles?.[0] ?? 'owner',
          email: payload.email ?? null,
          first_name: payload.first_name ?? null,
        };
      } catch {
        console.warn('[AUTH][OAUTH_HANDOFF] JWT decode failed — user will be null');
      }
      setAuthState({
        isLoggedIn: true,
        isLoading: false,
        user: decodedUser,
        accessToken: tokenFromUrl,
      });

      // Clean URL (critical)
      window.history.replaceState({}, document.title, '/');

      return;
    }
    /* console.log("AuthContext: Initializing..."); */
    try {
      // Playwright's storageState will inject these values
      const storedToken = getToken();
      const storedUser = localStorage.getItem('user');
      
      if (storedToken && storedUser) {
        const parsedUser = JSON.parse(storedUser);
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
          identifyUser(parsedUser.id, parsedUser.shop_id);
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
    setOnTokenRefreshed((newToken: string) => {
      console.info('[AUTH] Silent refresh → React state synced');
      setAccessToken(newToken);
    });
  }, [setAccessToken]);

  const login = useCallback((user: PublicUser, accessToken: string) => {
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

  const logout = useCallback(() => {
    setAuthState({
      isLoggedIn: false,
      isLoading: false,
      user: null,
      accessToken: null,
    });
    clearToken();
    localStorage.removeItem('user');
    console.info('[AUTH] logout(): token cleared via authStore');
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
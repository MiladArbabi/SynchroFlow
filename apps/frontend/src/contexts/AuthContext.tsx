/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { PublicUser } from 'api-types';
import { getToken, setToken, clearToken } from 'utils/authStore';

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
      setAuthState({
        isLoggedIn: true,
        isLoading: false,
        user: null, // ← will explain below
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
        /* console.log("AuthContext: Found stored session. Re-hydrating state."); */
        setAuthState({
          isLoggedIn: true,
          isLoading: false,
          user: JSON.parse(storedUser), // Parse the user JSON string
          accessToken: storedToken,
        });
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



  const login = useCallback((user: PublicUser, accessToken: string) => {
  setAuthState({
    isLoggedIn: true,
    isLoading: false,
    user,
    accessToken,
  });

  // 🔑 SINGLE TOKEN AUTHORITY
  setToken(accessToken);

  // User stays in localStorage (non-sensitive)
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

  clearToken(); // 🔥 single source cleanup
  localStorage.removeItem('user');

  console.info('[AUTH] logout(): token cleared via authStore');
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
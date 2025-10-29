/* eslint-disable react-refresh/only-export-components */
// packages/ui/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { PublicUser } from '../../../api/src/types';
import { setToken, clearToken } from 'utils/authStore';

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
const AuthContext = createContext<AuthContextType | undefined>(undefined);

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

  // TODO: Add useEffect here later to check initial auth status
  // (e.g., call /refresh_token on load to see if session is valid)
  // For now, we'll just set loading to false immediately.
  React.useEffect(() => {
     setAuthState(prev => ({ ...prev, isLoading: false }));
  }, []);

  const login = useCallback((user: PublicUser, accessToken: string) => {
    setAuthState({
      isLoggedIn: true,
      isLoading: false,
      user,
      accessToken,
    });
    setToken(accessToken); // <-- WRITE to in-memory store
    console.log("AuthContext: User logged in, token stored in memory."); // Debug log
  }, []);

  const logout = useCallback(() => {
    setAuthState({
      isLoggedIn: false,
      isLoading: false,
      user: null,
      accessToken: null,
    });
    clearToken();
    console.log("AuthContext: User logged out, token cleared from memory."); // Debug log
    // Note: Calling the backend /logout endpoint happens separately
  }, []);

  const setAccessToken = useCallback((token: string | null) => {
      setAuthState(prev => ({ ...prev, accessToken: token }));
      setToken(token); // <-- UPDATE in-memory store
      console.log("AuthContext: Access token updated."); // Debug log
  }, []);

  const value = {
    ...authState,
    login,
    logout,
    setAccessToken,
  };

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
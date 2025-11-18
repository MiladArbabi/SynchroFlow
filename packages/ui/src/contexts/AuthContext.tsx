/* eslint-disable react-refresh/only-export-components */
// packages/ui/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, ReactNode, useCallback } from 'react';
import { PublicUser } from '../../../api/src/types';
import { usePostHog } from '@posthog/react';

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

  // --- [START POSTHOG HOOK] ---
  const posthog = usePostHog();

  // Re-hydrate session from localStorage on app load
  React.useEffect(() => {
    console.log("AuthContext: Initializing...");
    try {
      // Playwright's storageState will inject these values
      const storedToken = localStorage.getItem('accessToken');
      const storedUser = localStorage.getItem('user');
      
      if (storedToken && storedUser) {
        console.log("AuthContext: Found stored session. Re-hydrating state.");
        setAuthState({
          isLoggedIn: true,
          isLoading: false,
          user: JSON.parse(storedUser), // Parse the user JSON string
          accessToken: storedToken,
        });
      } else {
        console.log("AuthContext: No stored session found.");
        // No session, just finish loading
        setAuthState(prev => ({ ...prev, isLoading: false }));
      }
    } catch (error) {
      console.error("AuthContext: Failed to parse stored user. Logging out.", error);
      // Clear corrupted storage and finish loading
      localStorage.removeItem('accessToken');
      localStorage.removeItem('user');
      setAuthState(prev => ({ ...prev, isLoading: false, isLoggedIn: false, user: null, accessToken: null }));
    }
  }, []);

  // -- Save to localStorage on login ---
  const login = useCallback((user: PublicUser, accessToken: string) => {
    setAuthState({
      isLoggedIn: true,
      isLoading: false,
      user,
      accessToken,
    });
    // Save to localStorage so it persists across reloads/tests
    localStorage.setItem('accessToken', accessToken);
    localStorage.setItem('user', JSON.stringify(user));

    // --- [START ISSUE#442 User Identification] ---
    if (posthog) {
      posthog.identify(
        user.id.toString(), // Unique ID for the user
        {
          email: user.email,
          name: `${user.first_name} ${user.last_name}`,
        }
      );
    }
    console.log("AuthContext: User logged in and identified.");
  }, [posthog]);

  // --- Clear localStorage on logout ---
  const logout = useCallback(() => {
    setAuthState({
      isLoggedIn: false,
      isLoading: false,
      user: null,
      accessToken: null,
    });
    // Clear the persistent session
    localStorage.removeItem('accessToken');
    localStorage.removeItem('user');
    
    // --- [START POSTHOG RESET] ---
      if (posthog) {
        posthog.reset(); // Resets the user ID
      }
      // --- [END POSTHOG RESET] ---

      console.log("AuthContext: User logged out and PostHog reset.");
    }, [posthog]);

  // This function is for token refresh. It should also update localStorage.
  const setAccessToken = useCallback((token: string | null) => {
      setAuthState(prev => ({ ...prev, accessToken: token }));
      if (token) {
        localStorage.setItem('accessToken', token);
      } else {
        localStorage.removeItem('accessToken');
      }
      console.log("AuthContext: Access token updated in state and localStorage.");
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
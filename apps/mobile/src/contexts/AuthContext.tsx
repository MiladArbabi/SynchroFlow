// apps/mobile/src/contexts/AuthContext.tsx
import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@lasyncro/mobile-core';

const ACCESS_TOKEN_KEY = 'lasyncro_access_token';
const REFRESH_TOKEN_KEY = 'lasyncro_refresh_token';

type AuthState = {
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
  role: string | null;
  userId: number | null;
  roles: string[];
  email: string | null;
  firstName: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function decodeTokenClaims(token: string): { email: string | null; firstName: string | null } {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { email: payload.email ?? null, firstName: payload.first_name ?? null };
  } catch {
    return { email: null, firstName: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [firstName, setFirstName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const tryRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;
      const { data } = await apiClient.post('/api/v1/auth/refresh_token', { refreshToken });
      const newAccessToken: string = data.accessToken;
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, newAccessToken);
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
      const claims = decodeTokenClaims(newAccessToken);
      setEmail(claims.email);
      setFirstName(claims.firstName);
      setToken(newAccessToken);
      return newAccessToken;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        if (stored && !isTokenExpired(stored)) {
          // Token still valid — use it
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
          setToken(stored);
          const claims = decodeTokenClaims(stored);
          setEmail(claims.email);
          setFirstName(claims.firstName);
        } else {
          // Token missing or expired — try refresh
          const newToken = await tryRefresh();
          if (!newToken) {
            await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
            await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
            delete apiClient.defaults.headers.common['Authorization'];
          }
        }
      } catch {
        // SecureStore unavailable
      } finally {
        setIsLoading(false);
      }
    })();
  }, [tryRefresh]);

  useEffect(() => {
    const interceptor = apiClient.interceptors.response.use(
      (response) => response,
      async (error) => {
        const isExpired = error?.response?.data?.error === 'TOKEN_EXPIRED';
        const isUnauthorized = error?.response?.status === 401;
        if ((isExpired || isUnauthorized) && !error.config._retried) {
          error.config._retried = true;
          const newToken = await tryRefresh();
          if (newToken) {
            error.config.headers['Authorization'] = `Bearer ${newToken}`;
            return apiClient.request(error.config);
          }
          // Refresh failed — clear all tokens and reset state
          await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
          await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
          delete apiClient.defaults.headers.common['Authorization'];
          setToken(null);
          setRole(null);
          setUserId(null);
          setEmail(null);
          setFirstName(null);
        }
        return Promise.reject(error);
      }
    );
    return () => apiClient.interceptors.response.eject(interceptor);
  }, [tryRefresh]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { data } = await apiClient.post('/api/v1/auth/login', { email, password });
      const accessToken: string = data.accessToken;
      const refreshToken: string = data.refreshToken;
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, accessToken);
      await SecureStore.setItemAsync(REFRESH_TOKEN_KEY, refreshToken);
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
      setToken(accessToken);
      setRole(data.user?.role ?? null);
      setUserId(data.user?.id ?? null);
      const claims = decodeTokenClaims(accessToken);
      setEmail(claims.email);
      setFirstName(claims.firstName);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Login failed. Check your credentials.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
    await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
    delete apiClient.defaults.headers.common['Authorization'];
    setToken(null);
    setRole(null);
    setUserId(null);
    setEmail(null);
    setFirstName(null);
  }, []);

  return (
    <AuthContext.Provider value={{
      isAuthenticated: token !== null,
      isLoading,
      error,
      role,
      userId,
      roles: role ? [role] : [],
      email,
      firstName,
      login,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
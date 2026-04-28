// apps/mobile/src/hooks/useAuth.ts
import { useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@lasyncro/mobile-core';

const ACCESS_TOKEN_KEY = 'lasyncro_access_token';
const REFRESH_TOKEN_KEY = 'lasyncro_refresh_token';

/**
 * MOBILE AUTH HOOK
 * ----------------
 * Manages JWT session for the operator mobile app.
 *
 * - Access token: stored in SecureStore, injected into apiClient
 * - Refresh token: stored in SecureStore, used to get new access token
 * - Auto-refresh: axios interceptor retries on 401/TOKEN_EXPIRED
 * - Operators stay logged in for 7 days (refresh token lifetime)
 */

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Attempt silent token refresh using stored refresh token
  const tryRefresh = useCallback(async (): Promise<string | null> => {
    try {
      const refreshToken = await SecureStore.getItemAsync(REFRESH_TOKEN_KEY);
      if (!refreshToken) return null;

      const { data } = await apiClient.post('/api/v1/auth/refresh_token', {
        refreshToken,
      });

      const newAccessToken: string = data.accessToken;
      await SecureStore.setItemAsync(ACCESS_TOKEN_KEY, newAccessToken);
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${newAccessToken}`;
      setToken(newAccessToken);
      return newAccessToken;
    } catch {
      return null;
    }
  }, []);

  // Load token from SecureStore on mount, auto-refresh if expired
  useEffect(() => {
    (async () => {
      try {
        const stored = await SecureStore.getItemAsync(ACCESS_TOKEN_KEY);
        if (stored) {
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
          setToken(stored);
        } else {
          // Try refresh even if no access token — may have valid refresh token
          await tryRefresh();
        }
      } catch {
        // SecureStore unavailable
      } finally {
        setIsLoading(false);
      }
    })();
  }, [tryRefresh]);

  // Axios interceptor — auto-refresh on TOKEN_EXPIRED
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
          // Refresh failed — force logout
          await SecureStore.deleteItemAsync(ACCESS_TOKEN_KEY);
          await SecureStore.deleteItemAsync(REFRESH_TOKEN_KEY);
          delete apiClient.defaults.headers.common['Authorization'];
          setToken(null);
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
  }, []);

  return {
    isAuthenticated: token !== null,
    isLoading,
    error,
    login,
    logout,
    role,
    userId,
    roles: role ? [role] : [],
  };
}
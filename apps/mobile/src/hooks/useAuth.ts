// apps/mobile/src/hooks/useAuth.ts
import { useState, useCallback, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@lasyncro/mobile-core';

/**
 * MOBILE AUTH HOOK
 * ----------------
 * Manages JWT session for the operator mobile app.
 *
 * - Persists access token in SecureStore (encrypted on-device)
 * - Injects token into apiClient on every request via interceptor
 * - Exposes login / logout / isAuthenticated / isLoading
 *
 * Token key: 'lasyncro_access_token'
 */

const TOKEN_KEY = 'lasyncro_access_token';

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load token from SecureStore on mount
  useEffect(() => {
    SecureStore.getItemAsync(TOKEN_KEY)
      .then((stored) => {
        if (stored) {
          setToken(stored);
          apiClient.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
        }
      })
      .catch(() => {/* SecureStore unavailable — stay logged out */})
      .finally(() => setIsLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    try {
      const { data } = await apiClient.post('/api/v1/auth/login', { email, password });
      const accessToken: string = data.accessToken;

      await SecureStore.setItemAsync(TOKEN_KEY, accessToken);
      apiClient.defaults.headers.common['Authorization'] = `Bearer ${accessToken}`;
      setToken(accessToken);
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error
        ?? 'Login failed. Check your credentials.';
      setError(message);
      throw new Error(message);
    }
  }, []);

  const logout = useCallback(async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    delete apiClient.defaults.headers.common['Authorization'];
    setToken(null);
  }, []);

  return {
    isAuthenticated: token !== null,
    isLoading,
    error,
    login,
    logout,
  };
}
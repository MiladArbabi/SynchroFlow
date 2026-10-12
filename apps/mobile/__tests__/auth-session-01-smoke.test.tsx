import { render, act, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { apiClient } from '@lasyncro/mobile-core';
import { AuthProvider, useAuth } from '../src/contexts/AuthContext';

test('mobile harness mounts the real provider and intercepts login without network', async () => {
  const store = (SecureStore as any).__values as Map<string, string>;
  store.clear();
  jest.clearAllMocks();
  const token = `e30.${Buffer.from(JSON.stringify({
    user_id: 41, role: 'admin', email: 'smoke@example.test', first_name: 'Smoke',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64')}.signature`;
  const adapter = jest.fn(async (config) => ({
    config, status: 200, statusText: 'OK', headers: {},
    data: { accessToken: token, refreshToken: 'smoke-refresh', user: { id: 41, role: 'admin' } },
  }));
  apiClient.defaults.adapter = adapter;
  let auth!: ReturnType<typeof useAuth>;
  function Probe() { auth = useAuth(); return null; }
  render(<AuthProvider><Probe /></AuthProvider>);
  await waitFor(() => expect(auth.isLoading).toBe(false));
  expect(adapter).not.toHaveBeenCalled();
  await act(async () => { await auth.login('smoke@example.test', 'synthetic-password'); });
  expect(adapter).toHaveBeenCalledTimes(1);
  expect(adapter.mock.calls[0][0].url).toBe('/api/v1/auth/login');
  expect(auth).toMatchObject({ isAuthenticated: true, userId: 41, role: 'admin',
    email: 'smoke@example.test', firstName: 'Smoke' });
  expect(store.get('lasyncro_access_token')).toBe(token);
  expect(store.get('lasyncro_refresh_token')).toBe('smoke-refresh');
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('lasyncro_refresh_token', 'smoke-refresh');
});

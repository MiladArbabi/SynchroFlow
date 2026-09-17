// tests/unit/ui/AuthContext.test.tsx
import { renderHook, act, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from 'contexts/AuthContext'; // Use alias
import React from 'react';

function fakeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'none', typ: 'JWT' })}.${encode(payload)}.sig`;
}

describe('AuthContext', () => {
  // Helper to wrap the hook call with the provider
  const wrapper = ({ children }: { children: React.ReactNode }) => <AuthProvider>{children}</AuthProvider>;

  it('should provide default initial state', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    // --- RED TEST ---
    // Will fail initially if isLoading doesn't default correctly or useEffect runs sync
    expect(result.current.isLoading).toBe(false); // Expect loading to be false after initial effect
    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

  it('should update state on login', () => {
     const { result } = renderHook(() => useAuth(), { wrapper });
     const mockUser = { id: 1, email: 'test@example.com' }; // Use PublicUser shape
     const mockToken = 'test-token';

     act(() => {
       result.current.login(mockUser as any, mockToken); // Cast user for simplicity
     });

     expect(result.current.isLoggedIn).toBe(true);
     expect(result.current.user).toEqual(mockUser);
     expect(result.current.accessToken).toBe(mockToken);
     expect(result.current.isLoading).toBe(false);
  });

   it('should update state on logout', () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    const mockUser = { id: 1, email: 'test@example.com' };
    const mockToken = 'test-token';

    // First, log in
    act(() => {
      result.current.login(mockUser as any, mockToken);
    });

    // Then, log out
    act(() => {
      result.current.logout();
    });

    expect(result.current.isLoggedIn).toBe(false);
    expect(result.current.user).toBeNull();
    expect(result.current.accessToken).toBeNull();
  });

   it('should update accessToken state via setAccessToken', () => {
     const { result } = renderHook(() => useAuth(), { wrapper });
     const newToken = 'new-access-token';

     act(() => {
       result.current.setAccessToken(newToken);
     });

     expect(result.current.accessToken).toBe(newToken);
   });

   it('preserves billing handoff params while removing OAuth token from the URL', async () => {
     const token = fakeJwt({
       user_id: 42,
       shop_id: 77,
       plan: 'starter',
       shop_roles: ['owner'],
       email: 'owner@example.test',
     });
     window.history.replaceState(
       {},
       '',
       `/settings/billing?connect=app_store&token=${token}&billing_entry=required&safe=1#handoff`,
     );

     const { result } = renderHook(() => useAuth(), { wrapper });

     await waitFor(() => {
       expect(result.current.isLoggedIn).toBe(true);
     });
     expect(result.current.accessToken).toBe(token);
     expect(localStorage.getItem('accessToken')).toBe(token);
     expect(window.location.pathname).toBe('/settings/billing');
     expect(window.location.search).toContain('billing_entry=required');
     expect(window.location.search).toContain('safe=1');
     expect(window.location.search).not.toContain('token=');
     expect(window.location.search).not.toContain('connect=');
     expect(window.location.hash).toBe('#handoff');
   });
});

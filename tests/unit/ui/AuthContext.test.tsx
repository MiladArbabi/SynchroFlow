// tests/unit/ui/AuthContext.test.tsx
import { renderHook, act } from '@testing-library/react';
import { AuthProvider, useAuth } from 'contexts/AuthContext'; // Use alias
import React from 'react';

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
});
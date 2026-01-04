//tests/unit/ui/lifecycle/Lifecycle.boot-sequencing.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';

import { LifecycleProvider } from 'lifecycle/LifecycleProvider';
import { ShopLifecycleGate } from 'lifecycle/ShopLifecycleGate';
import { ShopLifecycleShell } from 'lifecycle/ShopLifecycleShell';

jest.mock('contexts/AuthContext', () => ({
   useAuth: () => ({
     isLoggedIn: true,
     isLoading: false,
     user: { id: 1 },
     accessToken: 'test',
     login: jest.fn(),
     logout: jest.fn(),
     setAccessToken: jest.fn(),
   }),
 }));

// Mock integration hook to simulate post-bootstrap truth
jest.mock('contexts/integration/useIntegration', () => ({
  useIntegration: () => ({
    bootResolved: true,
    hasIntegration: true,
    existence: 'EXISTS',
    syncStatus: 'COMPLETED',
    isSyncComplete: true,
    refresh: jest.fn(),
  }),
}));

describe('Lifecycle boot sequencing (no flash invariant)', () => {
  it('never renders FT_MINUS_ONE after integration truth is known', () => {
    renderWithProviders(
      <LifecycleProvider>
        <ShopLifecycleShell>
          <ShopLifecycleGate />
        </ShopLifecycleShell>
      </LifecycleProvider>
    );

    // Assert absence, not presence
    expect(screen.queryByText(/ft_minus_one/i)).toBeNull();
  });
});
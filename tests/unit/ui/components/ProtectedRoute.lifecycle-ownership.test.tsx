// tests/unit/ui/components/ProtectedRoute.lifecycle-ownership.test.tsx
import React from 'react';
import { renderWithProviders } from 'test-utils';
import ProtectedRoute from 'components/ProtectedRoute';

// 🔴 HARD FAIL if lifecycle or onboarding is accessed
jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    modules: [],
    flags: [],
    isLoading: false,
    hasResolved: true,

    get lifecyclePhase() {
      throw new Error('❌ ProtectedRoute must not read lifecyclePhase');
    },
    get ftPhase() {
      throw new Error('❌ ProtectedRoute must not read FT phases');
    },
    get readiness() {
      throw new Error('❌ ProtectedRoute must not read readiness');
    },
    get onboardingTier() {
      throw new Error('❌ ProtectedRoute must not read onboarding tier');
    },
  }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    isLoading: false,
  }),
}));

describe('ProtectedRoute — lifecycle ownership', () => {
  it('does not read lifecycle, FT phases, or onboarding-derived fields', () => {
    renderWithProviders(
      <ProtectedRoute>
        <div>ok</div>
      </ProtectedRoute>,
      {
        routerProps: { initialEntries: ['/dashboard'] },
      }
    );
  });
});

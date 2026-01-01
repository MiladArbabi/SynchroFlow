// tests/unit/ui/pages/dashboard/DashboardPage.ft1-platform.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import { DashboardPage } from 'pages/DashboardPage';

// --- Mock auth ---
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, shop_id: 42 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// --- Mock onboarding readiness (SOURCE OF TRUTH) ---
jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isLoading: false,
    data: {
      shopId: 42,
      modules: [
        {
          moduleId: 'platform',
          displayName: 'Store Connection',
          isReady: false,
          signals: [
            { name: 'integration.connected', value: false },
            { name: 'integration.syncCompleted', value: false },
          ],
          tasks: [
            {
              id: 'connect-store',
              label: 'Connect your Shopify store',
              required: true,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['platform'],
        readyModules: [],
      },
    },
  }),
}));

describe('DashboardPage — FT1 Platform diagnostics', () => {
  it('renders platform diagnostic card from readiness snapshot', () => {
    renderWithProviders(
      <DashboardPage handleSidenavToggle={() => {}} />
    );

    // 🔴 Diagnostic truth, not marketing copy
    expect(
      screen.getByText('Store Connection')
    ).toBeInTheDocument();

    // 🔴 Read-only diagnostic messaging (exact copy TBD by implementation)
    expect(
      screen.getByText('Connect your Shopify store')
    ).toBeInTheDocument();
  });
});
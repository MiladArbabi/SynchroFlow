//tests/unit/ui/pages/dashboard/DashboardPage.specter-ft1.test.tsx
import React from 'react';
import { renderWithProviders } from 'test-utils';
import { screen } from '@testing-library/react';
import { DashboardPage } from 'pages/DashboardPage';

// --- Mock auth ---
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, shop_id: 77 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// --- Mock onboarding readiness ---
jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isLoading: false,
    data: {
      shopId: 77,
      modules: [
        {
          moduleId: 'specter',
          isReady: false,
          signals: [
            { name: 'specter.sdkInstalled', value: false },
            { name: 'specter.sessionsKnown', value: false },
          ],
          tasks: [
            {
              id: 'specter-sdk-installed',
              label: 'Enable Specter tracking',
              required: false,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['specter'],
        readyModules: [],
      },
    },
  }),
}));

describe('DashboardPage — FT1 Specter surface wiring', () => {
  it('renders the Specter FT1 diagnostic surface when readiness is present', () => {
    renderWithProviders(
      <DashboardPage handleSidenavToggle={() => {}} />
    );

    expect(
      screen.getByTestId('specter-ft1-loading')
    ).toBeInTheDocument();
  });
});


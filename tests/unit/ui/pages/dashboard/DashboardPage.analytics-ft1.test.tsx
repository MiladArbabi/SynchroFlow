import React from 'react';
import { renderWithProviders } from 'test-utils';
import { screen } from '@testing-library/react';
import { DashboardPage } from 'pages/DashboardPage';

// --- Mock auth ---
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, shop_id: 55 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// --- Mock onboarding readiness ---
jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isLoading: false,
    data: {
      shopId: 55,
      modules: [
        {
          moduleId: 'analytics',
          isReady: false,
          signals: [
            { name: 'analytics.orderCount', value: 0 },
            { name: 'analytics.productCount', value: 0 },
            { name: 'analytics.baseSignalsReady', value: false },
          ],
          tasks: [
            {
              id: 'analytics-base-data',
              label: 'Prepare analytics data',
              required: true,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['analytics'],
        readyModules: [],
      },
    },
  }),
}));

describe('DashboardPage — FT1 Analytics surface wiring', () => {
  it('renders the Analytics FT1 diagnostic surface when readiness is present', () => {
    renderWithProviders(
      <DashboardPage handleSidenavToggle={() => {}} />
    );

    expect(
      screen.getByTestId('analytics-ft1-no-orders')
    ).toBeInTheDocument();
  });
});

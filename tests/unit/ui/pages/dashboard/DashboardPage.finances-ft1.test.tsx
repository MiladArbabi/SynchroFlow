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
          moduleId: 'finances',
          isReady: false,
          signals: [
            { name: 'finances.transactionCount', value: 10 },
            { name: 'finances.costDataReady', value: false },
            { name: 'finances.baseSignalsReady', value: false },
          ],
          tasks: [
            {
              id: 'finances.complete-cost-setup',
              label: 'Complete cost setup',
              required: false,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['finances'],
        readyModules: [],
      },
    },
  }),
}));

describe('DashboardPage — FT1 Finances surface wiring', () => {
  it('renders the Finances FT1 diagnostic surface when readiness is present', () => {
    renderWithProviders(
      <DashboardPage />
    );

    // ✅ Semantic FT1 surface — Finances missing costs
    expect(
      screen.getByTestId('finances-ft1-no-costs')
    ).toBeInTheDocument();
  });
});

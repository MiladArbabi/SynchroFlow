// tests/unit/ui/pages/dashboard/DashboardPage.order-nexus-ft1.test.tsx

import React from 'react';
import { renderWithProviders } from 'test-utils';
import { screen } from '@testing-library/react';
import { DashboardPage } from 'pages/DashboardPage';

// --- Mock auth ---
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, shop_id: 99 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// --- Mock onboarding readiness ---
jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isLoading: false,
    data: {
      shopId: 99,
      modules: [
        {
          moduleId: 'order-nexus',
          isReady: false,
          signals: [
            { name: 'orderNexus.ordersKnown', value: true },
            { name: 'orderNexus.ordersIngested', value: 5 },
            { name: 'orderNexus.missingCostCount', value: 2 },
            { name: 'orderNexus.hasNegativeMarginOrder', value: false },
          ],
          tasks: [
            {
              id: 'orderNexus.resolveMissingCosts',
              label: 'Complete cost setup',
              required: false,
              complete: false,
            },
          ],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['order-nexus'],
        readyModules: [],
      },
    },
  }),
}));

describe('DashboardPage — FT1 Order-Nexus surface wiring', () => {
  it('renders the Order-Nexus FT1 diagnostic surface when readiness is present', () => {
    renderWithProviders(
      <DashboardPage />
    );

    // ✅ Semantic FT1 surface — UNCERTAIN scenario
    expect(
      screen.getByTestId('orders-ft1-uncertain')
    ).toBeInTheDocument();
  });
});
import React from 'react';
import { renderWithProviders } from 'test-utils';
import { DashboardPage } from 'pages/DashboardPage';

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 123 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// 🔴 Mock the REAL dependency, not imaginary APIs
jest.mock('contexts/DashboardStateContext', () => {
  const actual = jest.requireActual('contexts/DashboardStateContext');

  return {
    ...actual,
    useDashboardState: () => ({
      userState: {
        user: {
            shopify_connected: false,
            first_insight_delivered: false,
        },

        // 🔴 forbidden legacy fields
        get tier() {
            throw new Error('❌ DashboardPage must not read onboarding tier');
        },
        get recommendedNextSteps() {
            throw new Error('❌ DashboardPage must not read recommendations');
        },
        get unlockedFeatures() {
            throw new Error('❌ DashboardPage must not read unlocked features');
        },
        },
      isLoading: false,
    }),
  };
});

describe('DashboardPage — lifecycle source of truth', () => {
  it('does not consume legacy onboarding or derived lifecycle fields', () => {
    renderWithProviders(<DashboardPage handleSidenavToggle={() => {}} />);
    });
});

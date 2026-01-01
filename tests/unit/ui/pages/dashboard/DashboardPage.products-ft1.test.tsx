import React from 'react';
import { renderWithProviders } from 'test-utils';
import { screen } from '@testing-library/react';
import { DashboardPage } from 'pages/DashboardPage';

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, shop_id: 88 },
    isAuthenticated: true,
    isLoading: false,
  }),
}));

jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    isLoading: false,
    data: {
      shopId: 88,
      modules: [
        {
          moduleId: 'sku-os',
          isReady: false,
          signals: [
            { name: 'sku-os.productsKnown', value: false },
          ],
          tasks: [],
        },
      ],
      ft1: {
        isComplete: false,
        blockingModules: ['sku-os'],
        readyModules: [],
      },
    },
  }),
}));

describe('DashboardPage — FT1 Products surface wiring', () => {
  it('renders the Products FT1 diagnostic surface when readiness is present', () => {
    renderWithProviders(
      <DashboardPage handleSidenavToggle={() => {}} />
    );

    expect(
      screen.getByTestId('products-ft1-incomplete')
    ).toBeInTheDocument();
  });
});
//tests/unit/ui/analytics/AnalyticsPage.readiness.test.tsx

// tests/unit/ui/analytics/AnalyticsPage.readiness.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from 'test-utils';

import AnalyticsPage from 'pages/AnalyticsPage';
import * as readiness from 'lifecycle/useOnboardingReadiness';

// ─── Mocks ────────────────────────────────────────────────────────────

// Mock AnalyticsModule so we can assert render boundary only
jest.mock('@lasyncro/analytics', () => ({
  __esModule: true,
  AnalyticsModule: () => (
    <div data-testid="analytics-module-mock" />
  ),
}));

// Mock lifecycle + auth to force FT1_READY + shopId
jest.mock('lifecycle/ShopLifecycleContext', () => ({
  useShopLifecycle: () => ({ phase: 'FT1_READY' }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { shop_id: 123 } }),
}));

jest.mock('lifecycle/useOnboardingReadiness');

const mockUseOnboardingReadiness =
  readiness.useOnboardingReadiness as jest.Mock;

// ─── Tests ────────────────────────────────────────────────────────────

describe('AnalyticsPage — readiness gating', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders loading state while readiness is loading', () => {
    mockUseOnboardingReadiness.mockReturnValue({
      isLoading: true,
      isSuccess: false,
      isError: false,
    });

    renderWithProviders(<AnalyticsPage />);

    expect(
      screen.getByText(/Loading analytics/i)
    ).toBeInTheDocument();
  });

  it('renders AnalyticsModule when readiness succeeds', () => {
    mockUseOnboardingReadiness.mockReturnValue({
      isLoading: false,
      isSuccess: true,
      isError: false,
      data: {
        modules: [
          {
            moduleId: 'analytics',
            signals: [],
          },
        ],
      },
    });

    renderWithProviders(<AnalyticsPage />);

    expect(
      screen.getByTestId('analytics-module-mock')
    ).toBeInTheDocument();
  });
});
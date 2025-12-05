// tests/unit/ui/components/OrdersPerMonthBanner.test.tsx
import React from 'react';
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import { OrdersPerMonthBanner } from 'components/OrdersPerMonthBanner';
import axios from 'axios';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(),
}));

jest.mock('contexts/DashboardStateContext', () => ({
  useDashboardState: jest.fn(),
}));

jest.mock('contexts/IntegrationContext', () => ({
  useIntegration: jest.fn(),
}));

import { useAuth } from 'contexts/AuthContext';
import { useDashboardState } from 'contexts/DashboardStateContext';
import { useIntegration } from 'contexts/IntegrationContext';

const mockedUseAuth = useAuth as jest.Mock;
const mockedUseDashboardState = useDashboardState as jest.Mock;
const mockedUseIntegration = useIntegration as jest.Mock;

describe('OrdersPerMonthBanner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAuth.mockReturnValue({ accessToken: 'test-token' });
    mockedUseIntegration.mockReturnValue({ syncStatus: 'COMPLETED' });

    mockedUseDashboardState.mockReturnValue({
      userState: {
        user: {
          id: 1,
          email: 'test@example.com',
          shopify_connected: true,
          stripe_connected: false,
          first_insight_delivered: false,
          orders_per_month_segment: null,
        },
      },
      refetchUserState: jest.fn(),
    });
  });

  it('does not render if Shopify is not connected', () => {
    mockedUseDashboardState.mockReturnValue({
      userState: {
        user: {
          id: 1,
          email: 'test@example.com',
          shopify_connected: false,
          stripe_connected: false,
          first_insight_delivered: false,
          orders_per_month_segment: null,
        },
      },
      refetchUserState: jest.fn(),
    });

    renderWithProviders(<OrdersPerMonthBanner />);

    expect(
      screen.queryByTestId('orders-per-month-banner')
    ).toBeNull();
  });

  it('does not render if sync is not completed', () => {
    mockedUseIntegration.mockReturnValue({ syncStatus: 'SYNCING_PRODUCTS' });

    renderWithProviders(<OrdersPerMonthBanner />);

    expect(
      screen.queryByTestId('orders-per-month-banner')
    ).toBeNull();
  });

  it('does not render if orders_per_month_segment is already set', () => {
    mockedUseDashboardState.mockReturnValue({
      userState: {
        user: {
          id: 1,
          email: 'test@example.com',
          shopify_connected: true,
          stripe_connected: false,
          first_insight_delivered: false,
          orders_per_month_segment: '51-200',
        },
      },
      refetchUserState: jest.fn(),
    });

    renderWithProviders(<OrdersPerMonthBanner />);

    expect(
      screen.queryByTestId('orders-per-month-banner')
    ).toBeNull();
  });

  it('renders options when Shopify is connected, sync is completed and no segment is set', () => {
    renderWithProviders(<OrdersPerMonthBanner />);

    expect(
      screen.getByTestId('orders-per-month-banner')
    ).toBeInTheDocument();

    // One sample option
    expect(
      screen.getByTestId('orders-per-month-option-51-200')
    ).toBeInTheDocument();
  });

  it('submits selected segment and refetches user state', async () => {
    const refetchUserState = jest.fn();

    mockedUseDashboardState.mockReturnValue({
      userState: {
        user: {
          id: 1,
          email: 'test@example.com',
          shopify_connected: true,
          stripe_connected: false,
          first_insight_delivered: false,
          orders_per_month_segment: null,
        },
      },
      refetchUserState,
    });

    mockedAxios.patch.mockResolvedValueOnce({ data: {} });

    renderWithProviders(<OrdersPerMonthBanner />);

    const option = screen.getByTestId('orders-per-month-option-51-200');
    fireEvent.click(option);

    await waitFor(() => {
      expect(mockedAxios.patch).toHaveBeenCalledWith(
        '/api/v1/user-state/state',
        { orders_per_month_segment: '51-200' },
        {
          headers: { Authorization: 'Bearer test-token' },
        }
      );
    });

    expect(refetchUserState).toHaveBeenCalled();
  });

  it('shows error text when update fails', async () => {
    mockedAxios.patch.mockRejectedValueOnce({
      response: { data: { error: 'Invalid orders_per_month_segment' } },
    });

    renderWithProviders(<OrdersPerMonthBanner />);

    const option = screen.getByTestId('orders-per-month-option-1-50');
    fireEvent.click(option);

    await waitFor(() => {
      expect(
        screen.getByTestId('orders-per-month-error')
      ).toHaveTextContent('Invalid orders_per_month_segment');
    });
  });
});

import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import BillingSettings from 'pages/account-settings/BillingSettings';
import { axiosInstance } from 'api/axiosConfig';

const mockRefreshEntitlements = jest.fn();

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'owner' } }),
}));

jest.mock('hooks/useBillingUsage', () => ({
  useBillingUsage: () => ({
    data: {
      tier: 'core',
      ingested_orders: 0,
      shipped_orders: 0,
      processed_orders: 0,
      included_allowance: 2000,
      remaining_included: 2000,
      usage_percent: 0,
      overage_units: 0,
      overage_rate_cents: 8,
      estimated_overage_cents: 0,
      period_starts_at: null,
      period_ends_at: null,
    },
  }),
}));

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => {
    const React = require('react');
    const [tier, setTier] = React.useState('starter');
    const refresh = React.useCallback(() => {
      mockRefreshEntitlements();
      setTier('core');
    }, []);

    return {
      tier,
      billingCurrency: 'USD',
      refresh,
    };
  },
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn((url: string) =>
      Promise.resolve({
        data: url.endsWith('/subscription')
          ? {
              tier: 'core',
              status: 'active',
              billing_interval: 'monthly',
              billing_provider: 'shopify',
              manage_billing_url: 'https://admin.shopify.com/store/test/charges',
            }
          : {
              tier: 'starter',
              ingested_orders: 0,
              shipped_orders: 0,
              period_starts_at: null,
            },
      }),
    ),
    post: jest.fn(() =>
      Promise.resolve({
        data: {
          tier: 'core',
          status: 'active',
          billing_provider: 'shopify',
          authoritative_plan_handle: 'core',
          expected_plan_handle: 'growth',
        },
      }),
    ),
  },
}));

const mockedAxios = axiosInstance as jest.Mocked<typeof axiosInstance>;

describe('MON-REM-01B-4 — BillingSettings Shopify App Pricing return reconciliation', () => {
  beforeEach(() => {
    mockedAxios.get.mockClear();
    mockedAxios.post.mockClear();
    mockRefreshEntitlements.mockClear();
    window.history.replaceState({}, '', '/settings/billing');
  });

  it('reconciles plan_handle returns, refreshes entitlements, then refetches billing state', async () => {
    window.history.replaceState({}, '', '/settings/billing?plan_handle=growth');

    render(<BillingSettings />);

    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/v1/billing/shopify/reconcile',
        { expected_plan_handle: 'growth' },
      );
    });
    await waitFor(() => {
      expect(mockRefreshEntitlements).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockedAxios.get.mock.calls.filter(([url]) => url === '/api/v1/billing/subscription')).toHaveLength(1);
    });
    expect(screen.getAllByText('Core').length).toBeGreaterThan(0);
    expect(window.location.search).not.toContain('plan_handle');
  });

  it('preserves ordinary page-load behavior when no plan_handle is present', async () => {
    render(<BillingSettings />);

    expect(await screen.findByText('Usage this period')).toBeInTheDocument();
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(mockRefreshEntitlements).not.toHaveBeenCalled();
    expect(mockedAxios.get.mock.calls.filter(([url]) => url === '/api/v1/billing/subscription')).toHaveLength(1);
  });
});

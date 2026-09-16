import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillingSettings from 'pages/account-settings/BillingSettings';

const mockPost = jest.fn();
let mockBillingProvider: 'stripe' | 'shopify' | null = null;
let mockUsage = {
  tier: 'core',
  ingested_orders: 0,
  shipped_orders: 1500,
  processed_orders: 1500,
  included_allowance: 2000,
  remaining_included: 500,
  usage_percent: 75,
  overage_units: 0,
  overage_rate_cents: 8,
  estimated_overage_cents: 0,
  period_starts_at: '2026-09-01T00:00:00Z',
  period_ends_at: '2026-10-01T00:00:00Z',
};

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    tier: 'starter',
    billingCurrency: 'USD',
  }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'owner' } }),
}));

jest.mock('hooks/useBillingUsage', () => ({
  useBillingUsage: () => ({ data: mockUsage }),
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn((url: string) =>
      Promise.resolve({
        data: url.endsWith('/subscription')
          ? {
              tier: 'starter',
              status: 'active',
              billing_interval: 'monthly',
              current_period_start: mockBillingProvider === 'stripe' ? '2026-09-01T00:00:00Z' : null,
              current_period_end: '2026-10-01T00:00:00Z',
              billing_provider: mockBillingProvider,
              manage_billing_url: mockBillingProvider === 'shopify'
                ? 'https://admin.shopify.com/store/test/charges/lasyncro/pricing_plans'
                : null,
            }
          : {},
      })
    ),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

describe('BillingSettings provider routing', () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockBillingProvider = null;
    mockUsage = {
      tier: 'core',
      ingested_orders: 0,
      shipped_orders: 1500,
      processed_orders: 1500,
      included_allowance: 2000,
      remaining_included: 500,
      usage_percent: 75,
      overage_units: 0,
      overage_rate_cents: 8,
      estimated_overage_cents: 0,
      period_starts_at: '2026-09-01T00:00:00Z',
      period_ends_at: '2026-10-01T00:00:00Z',
    };
  });

  it('does not start Stripe checkout when billing provider is unresolved', async () => {
    render(<BillingSettings />);

    const buttons = await screen.findAllByRole('button', {
      name: 'Upgrade to Core',
    });

    fireEvent.click(buttons[0]);

    await waitFor(() => {
      expect(mockPost).not.toHaveBeenCalled();
    });

    expect(
      await screen.findByText(
        /Billing setup incomplete/i
      )
    ).toBeInTheDocument();
  });

  it('shows canonical processed-order usage and automatic overage copy below 100%', async () => {
    mockBillingProvider = 'stripe';
    render(<BillingSettings />);

    expect(await screen.findByText(/1,500/i)).toBeInTheDocument();
    expect(screen.getByText(/500 included processed orders remaining/i)).toBeInTheDocument();
    expect(screen.getByText(/Overage billing/i)).toBeInTheDocument();
    expect(screen.getByText(/Automatic · \$0\.08 per additional processed order/i)).toBeInTheDocument();
    expect(screen.getByText(/Processing continues normally/i)).toBeInTheDocument();
  });

  it('shows overage units and estimate above 100%', async () => {
    mockBillingProvider = 'stripe';
    mockUsage = {
      ...mockUsage,
      shipped_orders: 2050,
      processed_orders: 2050,
      remaining_included: 0,
      usage_percent: 100,
      overage_units: 50,
      estimated_overage_cents: 400,
    };

    render(<BillingSettings />);

    expect(await screen.findByText(/Additional: 50/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated overage: \$4\.00/i)).toBeInTheDocument();
  });
});

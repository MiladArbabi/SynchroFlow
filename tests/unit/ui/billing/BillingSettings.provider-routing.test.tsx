import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import BillingSettings from 'pages/account-settings/BillingSettings';

const mockPost = jest.fn();

jest.mock('contexts/EntitlementsContext', () => ({
  useEntitlements: () => ({
    tier: 'starter',
    billingCurrency: 'USD',
  }),
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
              billing_provider: null,
              manage_billing_url: null,
            }
          : {
              tier: 'starter',
              ingested_orders: 0,
              shipped_orders: 0,
              period_starts_at: null,
            },
      })
    ),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

describe('BillingSettings provider routing', () => {
  beforeEach(() => {
    mockPost.mockReset();
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
        'Billing is temporarily unavailable. Please contact support.'
      )
    ).toBeInTheDocument();
  });
});

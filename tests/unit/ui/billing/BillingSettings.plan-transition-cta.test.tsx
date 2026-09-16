import React from 'react';
import { render, screen } from '@testing-library/react';
import type { Tier } from '@lasyncro/commercial-policy';
import BillingSettings from 'pages/account-settings/BillingSettings';

let mockTier: Tier = 'growth';
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'owner' } }),
}));
jest.mock('hooks/useBillingUsage', () => ({
  useBillingUsage: () => ({
    data: {
      tier: mockTier,
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
  useEntitlements: () => ({ tier: mockTier, billingCurrency: 'USD' }),
}));
jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn((url: string) => Promise.resolve({ data: url.endsWith('/subscription')
      ? { tier: mockTier, status: 'active', billing_interval: 'monthly', billing_provider: 'stripe' }
      : { tier: mockTier, ingested_orders: 0, shipped_orders: 0, period_starts_at: null } })),
  },
}));

describe('BillingSettings plan transition CTA semantics', () => {
  it('offers a downgrade to Core and upgrade to Scale from Growth', async () => {
    mockTier = 'growth';
    render(<BillingSettings />);
    expect(await screen.findByRole('button', { name: 'Downgrade to Core' })).toBeInTheDocument();
    expect(screen.getByText('Current plan')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Upgrade to Scale' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Upgrade to Core' })).toBeNull();
    expect(screen.queryByRole('button', { name: /(?:Upgrade|Downgrade) to Growth/ })).toBeNull();
  });

  it('offers a downgrade to Growth from Scale', async () => {
    mockTier = 'scale';
    render(<BillingSettings />);
    expect(await screen.findByRole('button', { name: 'Downgrade to Growth' })).toBeInTheDocument();
    expect(screen.getByText('Current plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Upgrade to Growth' })).toBeNull();
    expect(screen.queryByRole('button', { name: /(?:Upgrade|Downgrade) to Scale/ })).toBeNull();
  });

  it('offers an upgrade to Growth from Core', async () => {
    mockTier = 'core';
    render(<BillingSettings />);
    expect((await screen.findAllByRole('button', { name: 'Upgrade to Growth' })).length).toBeGreaterThan(0);
    expect(screen.getByText('Current plan')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /(?:Upgrade|Downgrade) to Core/ })).toBeNull();
  });
});

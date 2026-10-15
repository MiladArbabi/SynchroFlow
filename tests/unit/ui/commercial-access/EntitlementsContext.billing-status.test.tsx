import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

const mockGet = jest.fn();

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: (...args: unknown[]) => mockGet(...args),
  },
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    isLoggedIn: true,
    // GH-1247: unsigned JWT-shaped token for shop 11 ({ user_id: 1, shop_id: 11 }).
    accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyX2lkIjoxLCJzaG9wX2lkIjoxMX0.sig',
  }),
}));

import {
  EntitlementsProvider,
  useEntitlements,
} from 'contexts/EntitlementsContext';

function Probe() {
  const entitlement = useEntitlements() as ReturnType<typeof useEntitlements> & {
    subscriptionStatus?: string | null;
  };

  return (
    <div data-testid="subscription-status">
      {entitlement.subscriptionStatus ?? 'missing'}
    </div>
  );
}

describe('EntitlementsContext billing-status transport', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockGet.mockResolvedValue({
      data: {
        shopId: 11,
        modules: [],
        flags: [],
        tier: 'growth',
        trialEndsAt: null,
        displayCurrency: 'USD',
        locale: 'en-US',
        billingCurrency: 'USD',
        billingProvider: 'shopify',
        subscriptionStatus: 'active',
      },
    });
  });

  it('propagates authoritative subscription status from /entitlements/me', async () => {
    render(
      <EntitlementsProvider>
        <Probe />
      </EntitlementsProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('subscription-status')).toHaveTextContent(
        'active',
      );
    });

    expect(mockGet).toHaveBeenCalledWith('/api/v1/entitlements/me');
  });
});

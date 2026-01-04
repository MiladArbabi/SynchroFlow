//tests/unit/ui/lifecycle/LifecycleProvider.ft2-restore.test.tsx
import { render, waitFor } from '@testing-library/react';
import React from 'react';

import { LifecycleProvider } from 'lifecycle/LifecycleProvider';
import { ShopLifecycleContext } from 'lifecycle/ShopLifecycleContext';

// --- mocks ---
jest.mock('contexts/integration', () => ({
  useIntegration: () => ({
    bootResolved: true,
    existence: 'EXISTS',
    hasIntegration: true,
    syncStatus: 'COMPLETED',
  }),
}));

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { shop_id: 1 },
  }),
}));

jest.mock('lifecycle/useOnboardingReadiness', () => ({
  useOnboardingReadiness: () => ({
    data: {
      ft1: { isComplete: true },
    },
  }),
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn((url: string) => {
      if (url.includes('/lifecycle/ft2/evaluate')) {
        return Promise.resolve({
          data: { eligible: true },
        });
      }
      throw new Error('unexpected request');
    }),
  },
}));

// FT2 restore now requires a persisted FT2 seal.
// Backend eligibility alone must NOT force FT2 on load.
describe('LifecycleProvider — FT2 restore', () => {
  it('does NOT restore to FT2_READY on app load without FT2 seal, even if backend FT2 is eligible', async () => {
    let phase: any = null;

    render(
      <LifecycleProvider>
        <ShopLifecycleContext.Consumer>
          {(ctx) => {
            phase = ctx.phase;
            return null;
          }}
        </ShopLifecycleContext.Consumer>
      </LifecycleProvider>
    );

    await waitFor(() => {
      expect(['FT_MINUS_ONE', 'FT0_PREPARING', 'FT1_READY']).toContain(phase);
    });
  });
});

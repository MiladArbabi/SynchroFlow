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

describe('LifecycleProvider — FT2 restore', () => {
  it('restores directly to FT2_READY on app load when backend FT2 is complete', async () => {
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
      expect(phase).toBe('FT2_READY');
    });
  });
});

//tests/unit/ui/lifecycle/LifecycleProvider.ft2-hard-refresh.test.tsx

import React from 'react';
import { render, waitFor } from '@testing-library/react';

import { LifecycleProvider } from 'ui/src/lifecycle/LifecycleProvider';
import { ShopLifecycleContext } from 'ui/src/lifecycle/ShopLifecycleContext';

// --- mocks ---
jest.mock('contexts/integration', () => ({
  useIntegration: () => ({
    bootResolved: true,
    existence: 'EXISTS',
    hasIntegration: true,
    syncStatus: 'COMPLETED',
    refresh: jest.fn(),
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

// 🔴 critical: backend FT2 already complete on load
jest.mock('api/lifecycle', () => ({
  getFt2Status: () =>
    Promise.resolve({
      completed: true,
    }),
}));

describe('LifecycleProvider — FT2 hard refresh restore', () => {
  beforeEach(() => {
    localStorage.setItem('shop:1:ft2-seen', 'true');
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('restores directly to FT2_READY on hard refresh without passing FT0 or FT1', async () => {
    let observedPhase: string | null = null;

    function Probe() {
      const ctx = React.useContext(ShopLifecycleContext);
      observedPhase = ctx.phase;
      return null;
    }

    render(
      <LifecycleProvider>
        <Probe />
      </LifecycleProvider>
    );

    await waitFor(() => {
      expect(observedPhase).toBe('FT2_READY');
    });
  });
});
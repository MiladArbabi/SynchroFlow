import React from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CommerceActivationGate } from 'activation/CommerceActivationGate';

// 🔴 Lock lifecycle ownership at the activation surface boundary
jest.mock('@lasyncro/shared/ui/activation', () => ({
  useActivationSurface: () => ({
    moduleId: 'order-nexus',
    isActive: true,

    // ❌ Forbidden reads
    get lifecyclePhase() {
      throw new Error('❌ CommerceActivationGate must not read lifecyclePhase');
    },
    get ftPhase() {
      throw new Error('❌ CommerceActivationGate must not read FT phase');
    },
    get readiness() {
      throw new Error('❌ CommerceActivationGate must not infer readiness');
    },
  }),
}));

describe('CommerceActivationGate — lifecycle ownership', () => {
  it('does not read lifecycle, FT phases, or readiness', () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <CommerceActivationGate moduleId="order-nexus">
          <div>Child</div>
        </CommerceActivationGate>
      </QueryClientProvider>
    );
  });
});

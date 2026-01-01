// tests/unit/ui/lifecycle/ModuleContentHost.products-ft1-blocking.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ModuleContentHost } from 'ui/src/lifecycle/ModuleContentHost';

// IMPORTANT: virtual module registry already maps ProductsModule
// via virtual:lasyncro-modules in jest.setup.js

describe('ModuleContentHost — Products FT1 blocking behavior', () => {
  it('renders Products FT1 diagnostic AND onboarding gate when Products is FT1-blocking', () => {
    render(
      <ModuleContentHost
        moduleId="products"
        phase="FT1_READY"
        hasPaidEntitlement={false}
        onboarding={{
          ft1: {
            isComplete: false,
            blockingModules: ['products'],
          },
        }}
      />
    );

    // 🔴 EXPECTATION 1:
    // Products FT1 diagnostic card SHOULD be rendered
    expect(
      screen.getByTestId('products-ft1-incomplete')
    ).toBeInTheDocument();

    // 🔴 EXPECTATION 2:
    // Products CTA SHOULD be visible
    expect(
      screen.getByText('Complete product data')
    ).toBeInTheDocument();

    // 🔴 EXPECTATION 3:
    // FT1 onboarding gate SHOULD also be rendered
    expect(
      screen.getByTestId('ft1-onboarding-gate')
    ).toBeInTheDocument();
  });
});
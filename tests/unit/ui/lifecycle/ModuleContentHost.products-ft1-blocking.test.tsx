// tests/unit/ui/lifecycle/ModuleContentHost.products-ft1-blocking.test.tsx

import React from 'react';
import { render, screen } from '@testing-library/react';
import { ModuleContentHost } from 'ui/src/lifecycle/ModuleContentHost';

// IMPORTANT: virtual module registry already maps ProductsModule
// via virtual:lasyncro-modules in jest.setup.js

describe('ModuleContentHost — Products FT1 blocking behavior', () => {
  it('renders FT1 onboarding gate and core content when Products is FT1-blocking', () => {
    render(
      <ModuleContentHost
        moduleId="products"
        phase="FT1_CORE"
        hasPaidEntitlement={false}
        onboarding={{
          ft1: {
            isComplete: false,
            blockingModules: ['products'],
          },
        }}
      />
    );

    // Core module shell MUST still mount
    expect(
      screen.getByTestId('products-core')
    ).toBeInTheDocument();

    // 🔴 EXPECTATION 3:
    // FT1 onboarding gate SHOULD also be rendered
    expect(
      screen.getByTestId('ft1-onboarding-gate')
    ).toBeInTheDocument();
  });
});
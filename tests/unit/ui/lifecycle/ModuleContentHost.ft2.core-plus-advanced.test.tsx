//tests/unit/ui/lifecycle/ModuleContentHost.ft2.core-plus-advanced.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { ModuleContentHost } from 'lifecycle/ModuleContentHost';

describe('ModuleContentHost — FT2 (paid)', () => {
  it('mounts core and advanced module content', async () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT2_PAYWALL"
        hasPaidEntitlement={true}
      />
    );

    expect(
      await screen.findByTestId('order-nexus-core')
    ).toBeInTheDocument();

    expect(
      await screen.findByTestId('order-nexus-advanced')
    ).toBeInTheDocument();
  });
});
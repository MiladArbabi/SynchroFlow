//tests/unit/ui/lifecycle/ModuleContentHost.ft1.core-only.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { ModuleContentHost } from 'lifecycle/ModuleContentHost';

describe('ModuleContentHost — FT1', () => {
  it('mounts core module content only', async () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT1_READY"
        hasPaidEntitlement={false}
      />
    );

    // Core content should render
    expect(
      await screen.findByTestId('order-nexus-core')
    ).toBeInTheDocument();

    // Advanced content must NOT render
    expect(
      screen.queryByTestId('order-nexus-advanced')
    ).toBeNull();
  });
});

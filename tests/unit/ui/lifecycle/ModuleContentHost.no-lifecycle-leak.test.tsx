//tests/unit/ui/lifecycle/ModuleContentHost.no-lifecycle-leak.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { ModuleContentHost } from 'lifecycle/ModuleContentHost';

describe('ModuleContentHost — boundary safety', () => {
  it('does not expose lifecycle or entitlement data', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT1_READY"
        hasPaidEntitlement={false}
      />
    );

    const core = screen.getByTestId('order-nexus-core');

    // Ensure no lifecycle or entitlement data is leaked into DOM
    expect(core.getAttribute('data-phase')).toBeNull();
    expect(core.getAttribute('data-entitlement')).toBeNull();
    expect(core.getAttribute('data-ft')).toBeNull();
  });
});

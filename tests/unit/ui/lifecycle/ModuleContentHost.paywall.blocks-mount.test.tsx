//tests/unit/ui/lifecycle/ModuleContentHost.paywall.blocks-mount.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { ModuleContentHost } from 'lifecycle/ModuleContentHost';

describe('ModuleContentHost — FT2 (unpaid)', () => {
  it('does not mount any module content', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT2_PAYWALL"
        hasPaidEntitlement={false}
      />
    );

    expect(screen.queryByTestId('order-nexus-core')).toBeNull();
    expect(screen.queryByTestId('order-nexus-advanced')).toBeNull();
  });
});

// tests/unit/ui/lifecycle/ModuleContentHost.ft1-onboarding-gate.test.tsx
import { screen } from '@testing-library/react';

import { ModuleContentHost } from 'lifecycle/ModuleContentHost';
import { renderWithTheme } from 'test-utils';

describe('ModuleContentHost — FT1 Onboarding Gate', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('renders onboarding gate additively when module is FT1-blocking', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT1_CORE"
        hasPaidEntitlement={false}
        onboarding={{
            ft1: {
                isComplete: false,
                 blockingModules: ['order-nexus'],
            },
        }}
      />
    );

    // Core MUST still mount (additive rule)
    expect(
      screen.getByTestId('order-nexus-core')
    ).toBeInTheDocument();

    // Onboarding gate MUST mount
    expect(
      screen.getByTestId('ft1-onboarding-gate')
    ).toBeInTheDocument();
  });

  it('allows Order-Nexus core when onboarding is complete', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT1_CORE"
        hasPaidEntitlement={false}
        onboarding={{
            ft1: {
                isComplete: true,
                 blockingModules: [],
            },
        }}
      />
    );

    expect(
      screen.getByTestId('order-nexus-core')
    ).toBeInTheDocument();

    expect(
      screen.queryByTestId('ft1-onboarding-gate')
    ).not.toBeInTheDocument();
  });

  it('does not block other modules when only Order-Nexus is blocking', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="customers"
        phase="FT1_CORE"
        hasPaidEntitlement={false}
        onboarding={{
            ft1: {
                isComplete: true,
                 blockingModules: [],
            },
        }}
      />
    );

    expect(
      screen.getByTestId('customers-core')
    ).toBeInTheDocument();

    expect(
      screen.queryByTestId('ft1-onboarding-gate')
    ).not.toBeInTheDocument();
  });
});
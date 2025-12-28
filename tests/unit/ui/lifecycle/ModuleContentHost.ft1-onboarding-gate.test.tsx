// tests/unit/ui/lifecycle/ModuleContentHost.ft1-onboarding-gate.test.tsx
import { screen } from '@testing-library/react';

import { ModuleContentHost } from 'lifecycle/ModuleContentHost';
import { renderWithTheme } from 'test-utils';

describe('ModuleContentHost — FT1 Onboarding Gate', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('blocks Order-Nexus core when onboarding is incomplete and module is blocking', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT1_READY"
        hasPaidEntitlement={false}
        onboarding={{
            ft1: {
                isComplete: false,
                 blockingModules: ['order-nexus'],
            },
        }}
      />
    );

    // Core content must NOT mount
    expect(
      screen.queryByTestId('order-nexus-core')
    ).not.toBeInTheDocument();

    // FT1 onboarding gate must mount
    expect(
      screen.getByTestId('ft1-onboarding-gate')
    ).toBeInTheDocument();
  });

  it('allows Order-Nexus core when onboarding is complete', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT1_READY"
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
        phase="FT1_READY"
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

  it('does not apply onboarding gate outside FT1_READY', () => {
    renderWithTheme(
      <ModuleContentHost
        moduleId="order-nexus"
        phase="FT0_PREPARING"
        hasPaidEntitlement={false}
        onboarding={{
        ft1: {
            isComplete: false,
            blockingModules: ['order-nexus'],
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
});
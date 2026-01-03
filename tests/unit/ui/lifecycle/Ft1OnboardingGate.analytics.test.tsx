// tests/unit/ui/lifecycle/Ft1OnboardingGate.analytics.test.tsx
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';

import { renderWithTheme } from 'test-utils';
import { ModuleContentHost } from 'lifecycle/ModuleContentHost';

// ---- mock generic UI analytics hook ----
const mockEmit = jest.fn();

jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({
    emit: mockEmit,
  }),
}));

describe('Ft1OnboardingGate — analytics instrumentation', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('emits a generic ui.intent event when user clicks continue setup', () => {
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

    const button = screen.getByRole('button', {
      name: /continue setup/i,
    });

    fireEvent.click(button);

    expect(mockEmit).toHaveBeenCalledTimes(1);
    expect(mockEmit).toHaveBeenCalledWith({
      event: 'ui.intent',
      payload: {
        action: 'continue',
        surface: 'ft1_onboarding_gate',
        moduleId: 'order-nexus',
      },
    });
  });

  it('does not emit lifecycle or entitlement metadata', () => {
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

    fireEvent.click(
      screen.getByRole('button', { name: /continue setup/i })
    );

    const call = mockEmit.mock.calls[0][0];

    expect(call.payload.phase).toBeUndefined();
    expect(call.payload.entitlement).toBeUndefined();
    expect(call.payload.ft).toBeUndefined();
  });
});
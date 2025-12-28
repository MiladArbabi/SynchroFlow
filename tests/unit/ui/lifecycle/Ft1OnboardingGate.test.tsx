// tests/unit/ui/lifecycle/Ft1OnboardingGate.test.tsx

import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

// NOTE: component does not exist yet — this test MUST fail first
import { Ft1OnboardingGate } from 'lifecycle/Ft1OnboardingGate';

describe('Ft1OnboardingGate — FT1 onboarding surface', () => {
  it('renders the FT1 onboarding gate container', () => {
    renderWithTheme(
      <Ft1OnboardingGate moduleId="order-nexus" />
    );

    expect(
      screen.getByTestId('ft1-onboarding-gate')
    ).toBeInTheDocument();
  });

  it('shows explanatory onboarding copy', () => {
    renderWithTheme(
      <Ft1OnboardingGate moduleId="order-nexus" />
    );

    expect(
      screen.getByText(/complete onboarding to unlock/i)
    ).toBeInTheDocument();
  });

  it('renders a primary CTA to continue onboarding', () => {
    renderWithTheme(
      <Ft1OnboardingGate moduleId="order-nexus" />
    );

    expect(
      screen.getByRole('button', { name: /continue setup/i })
    ).toBeInTheDocument();
  });

  it('does not expose lifecycle or entitlement metadata', () => {
    renderWithTheme(
      <Ft1OnboardingGate moduleId="order-nexus" />
    );

    const gate = screen.getByTestId('ft1-onboarding-gate');

    expect(gate.getAttribute('data-phase')).toBeNull();
    expect(gate.getAttribute('data-entitlement')).toBeNull();
    expect(gate.getAttribute('data-ft')).toBeNull();
  });
});
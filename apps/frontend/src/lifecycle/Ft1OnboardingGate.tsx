// apps/frontend/src/lifecycle/Ft1OnboardingGate.tsx

import React from 'react';
import { useUiEvents } from '../analytics/useUiEvents';

interface Ft1OnboardingGateProps {
  moduleId: string;
}

/**
 * FT1 Onboarding Gate
 * -------------------
 * Shown when a module is blocked during FT1.
 *
 * Responsibilities:
 * - Explain why the module is locked
 * - Provide a clear CTA to continue onboarding
 *
 * HARD RULES:
 * - No lifecycle access
 * - No entitlement logic
 * - No data fetching
 * - No routing
 */

export function Ft1OnboardingGate({ moduleId }: Ft1OnboardingGateProps) {
  const { emit } = useUiEvents();

  const handleContinue = () => {
    emit({
      event: 'ui.intent',
      payload: {
        action: 'continue',
        surface: 'ft1_onboarding_gate',
        moduleId
      },
    });
  };

  return (
    <section data-testid="ft1-onboarding-gate">
      <h2>Complete onboarding to unlock this module</h2>

      <p>
        We detected insights for <strong>{moduleId}</strong>, but we need a
        one-time setup to make them accurate and actionable.
      </p>

      <button type="button" onClick={handleContinue}>
        Continue setup
      </button>
    </section>
  );
}
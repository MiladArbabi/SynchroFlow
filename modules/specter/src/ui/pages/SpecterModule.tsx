// modules/specter/src/ui/pages/SpecterModule.tsx

import { useSpecterFt1Scenario } from '../hooks/useSpecterFt1Scenario.js';
import { SpecterDiagnosticCard } from '../components/SpecterDiagnosticCard.js';
import type { SpecterUiIntent } from '../intents.js';

export interface SpecterModuleProps {
  sessionCount: number | null;
  signalConfidence: number | null;
  onIntent?: (intent: SpecterUiIntent) => void;
}

/**
 * SpecterModule — FT1 Diagnostic Surface
 *
 * HARD RULES:
 * - No data fetching
 * - No routing
 * - No lifecycle awareness
 * - One scenario → one card
 */
export default function SpecterModule(props: SpecterModuleProps) {
  const scenario = useSpecterFt1Scenario({
    sessionCount: props.sessionCount,
    signalConfidence: props.signalConfidence,
  });

  const emitStartOnboarding = (taskId?: string) => {
    props.onIntent?.({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {
    case 'LOADING':
      return (
        <SpecterDiagnosticCard
          testId="specter-ft1-loading"
          title="Analyzing customer activity…"
          message="We’re validating session data to understand customer behavior."
        />
      );

    case 'NO_SESSIONS':
      return (
        <SpecterDiagnosticCard
          testId="specter-ft1-no-sessions"
          title="No customer sessions detected"
          message="We haven’t observed any customer activity yet. Once sessions are detected, we can surface behavioral insights."
          ctaLabel={props.onIntent ? 'Activate session tracking' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('install-sdk')
              : undefined
          }
        />
      );

    case 'LOW_SIGNAL':
      return (
        <SpecterDiagnosticCard
          testId="specter-ft1-low-signal"
          title="Customer signals not ready yet"
          message="We’re collecting session data, but there isn’t enough signal yet to generate reliable insights."
          ctaLabel={props.onIntent ? 'Complete setup' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('verify-events')
              : undefined
          }
        />
      );

    case 'HEALTHY':
      return (
        <SpecterDiagnosticCard
          testId="specter-ft1-healthy"
          title="Customer behavior signals active"
          message="Specter is now tracking customer behavior and can surface safe, actionable insights."
        />
      );
  }
}
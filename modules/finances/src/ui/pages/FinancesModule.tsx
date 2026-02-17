// modules/finances/src/ui/pages/FinancesModule.tsx

import { useFinancesFt1Scenario } from '../hooks/useFinancesFt1Scenario.js';
import { FinancesDiagnosticCard } from '../components/FinancesDiagnosticCard.js';
import type { FinancesUiIntent } from '../intents.js';

export interface FinancesModuleProps {
  transactionCount: number | null;
  costDataReady: boolean | null;
  baseSignalsReady: boolean | null;
  onIntent?: (intent: FinancesUiIntent) => void;
}

/**
 * FinancesModule — FT1 Diagnostic Surface
 * --------------------------------------
 * Purpose:
 * - Truthfully report whether a cost model is configured and usable
 *
 * FT1 Invariants:
 * - No data fetching
 * - No lifecycle awareness
 * - No financial computation
 * - One scenario → one diagnostic card
 */

export default function FinancesModule(props: FinancesModuleProps) {
  const scenario = useFinancesFt1Scenario(props);

  const emitStartOnboarding = (taskId: string) => {
    props.onIntent?.({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {
    case 'NO_TRANSACTIONS':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-no-transactions"
          title="No transactions detected yet"
          message="Once transactions exist, a cost model will be required so the system can interpret costs correctly."
          ctaLabel={props.onIntent ? 'Prepare cost setup' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('finances.complete-cost-setup')
              : undefined
          }
        />
      );

    case 'NO_COSTS':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-no-costs"
          title="Cost model not configured"
          message="Transactions exist, but no active cost model is configured. Downstream systems cannot reliably interpret costs until this is completed."
          ctaLabel={props.onIntent ? 'Configure cost model' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('finances.complete-cost-setup')
              : undefined
          }
        />
      );

    case 'HEALTHY':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-healthy"
          title="Cost model configured"
          message="An active cost model is available. Other modules can now rely on your cost configuration."
        />
      );

    case 'LOADING':
    default:
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-loading"
          title="Checking cost configuration…"
          message="We’re verifying whether a cost model is configured for this store."
        />
      );
  }
}

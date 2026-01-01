// modules/finances/src/ui/pages/FinancesModule.tsx

import { useFinancesFt1Scenario } from '../hooks/useFinancesFt1Scenario';
import { FinancesDiagnosticCard } from '../components/FinancesDiagnosticCard';
import type { FinancesUiIntent } from '../intents';

export interface FinancesModuleProps {
  transactionCount: number | null;
  costDataReady: boolean | null;
  baseSignalsReady: boolean | null;
  onIntent?: (intent: FinancesUiIntent) => void;
}

/**
 * FinancesModule — FT1 Diagnostic Surface
 * --------------------------------------
 * Base data readiness for financial analysis.
 *
 * Invariants:
 * - No data fetching
 * - No lifecycle awareness
 * - No onboarding logic
 * - One scenario → one card
 */

export default function FinancesModule(props: FinancesModuleProps) {
  const scenario = useFinancesFt1Scenario(props);

  console.debug('[FT1][Finances][Scenario]', scenario);
  console.debug('[FT1][Finances][Props]', props);

  const emitStartOnboarding = (taskId?: string) => {
    if (!props.onIntent) return;

    props.onIntent({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {
    case 'NO_TRANSACTIONS':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-no-transactions"
          title="No financial transactions detected"
          message="We haven’t detected any completed transactions yet."
        />
      );

    case 'NO_COSTS':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-no-costs"
          title="Transaction costs missing"
          message="Transactions exist, but cost data is incomplete. Financial accuracy cannot be determined yet."
          ctaLabel={props.onIntent ? 'Complete cost setup' : undefined}
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
          title="Financial data ready"
          message="Minimum financial data requirements are met."
        />
      );

    case 'LOADING':
    default:
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-loading"
          title="Analyzing financial data…"
          message="Validating financial base signals."
        />
      );
  }
}

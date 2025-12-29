// modules/finances/src/ui/pages/FinancesModule.tsx

import { useFinancesFt1Scenario } from '../hooks/useFinancesFt1Scenario';
import { FinancesDiagnosticCard } from '../components/FinancesDiagnosticCard';
import type { FinancesUiIntent } from '../intents';

export interface FinancesModuleProps {
  orderCount: number | null;
  productCount: number | null;
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
    props.onIntent?.({
      type: 'START_ONBOARDING',
      taskId,
    });
  };

  switch (scenario) {
    case 'NO_BASE_DATA':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-no-base-data"
          title="No financial base data detected"
          message="Orders or products are missing. Financial insights require both to be available."
          ctaLabel={props.onIntent ? 'Complete base setup' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('connect-base-data')
              : undefined
          }
        />
      );

    case 'PARTIAL_DATA':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-partial-data"
          title="Financial data incomplete"
          message="Some base financial signals are not ready yet."
          ctaLabel={props.onIntent ? 'Finish setup' : undefined}
          onCtaClick={
            props.onIntent
              ? () => emitStartOnboarding('complete-base-signals')
              : undefined
          }
        />
      );

    case 'HEALTHY':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-healthy"
          title="Financial base signals ready"
          message="All required financial base data is available."
        />
      );

    case 'LOADING':
      return (
        <FinancesDiagnosticCard
          testId="finances-ft1-loading"
          title="Analyzing financial data…"
          message="We’re validating base financial signals."
        />
      );
  }
}

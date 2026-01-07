// apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts

import type { FinancesModuleFT2Props } from '@lasyncro/finances';

/**
 * Finances FT2 Backend Snapshot
 * -----------------------------
 * Canonical FT2 exposure emitted by backend.
 *
 * This snapshot contains:
 * - Observed financial surface only
 * - No intelligence
 * - No breakdowns
 * - No explanations
 */
type FinancesFt2Snapshot = {
  context?: {
    period?: {
      from: string;
      to: string;
    };
    netObserved?: number | null;
  };

  outcome?: {
    status: 'positive' | 'negative' | 'unknown';
  } | null;

  trend?: {
    direction: 'up' | 'down' | 'flat' | 'unknown';
  } | null;

  dataCoverage?: {
    completenessPct: number | null;
  };
};

/**
 * mapFinancesFt2Props
 * ------------------
 * Canonical FT2 adapter for Finances.
 *
 * Role:
 * - Normalize backend snapshot into a deterministic UI contract
 * - Preserve uncertainty explicitly via nulls
 *
 * This function is intentionally boring.
 * If you feel tempted to "enhance" it — stop.
 */
export function mapFinancesFt2Props(
  snapshot: FinancesFt2Snapshot
): FinancesModuleFT2Props {
  const props: FinancesModuleFT2Props = {
    context: {
      period: snapshot.context?.period ?? { from: '', to: '' },
      netObserved:
        snapshot.context?.netObserved === undefined
          ? null
          : snapshot.context.netObserved,
    },

    outcome:
      snapshot.outcome === undefined ? null : snapshot.outcome,

    trend:
      snapshot.trend === undefined ? null : snapshot.trend,

    dataCoverage:
      snapshot.dataCoverage === undefined
        ? null
        : snapshot.dataCoverage,
  };

  /**
   * Instrumentation (FT2 only)
   * -------------------------
   * Debug logging is allowed at FT2 to:
   * - Verify contract stability
   * - Detect unexpected backend shape changes
   *
   * This MUST remain console.debug (never info/warn/error).
   */
  console.debug('[FT2][Finances][Adapter] mapped props', props);

  return props;
}
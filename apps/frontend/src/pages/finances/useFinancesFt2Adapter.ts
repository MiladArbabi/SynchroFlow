// apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts

import type { FinancesModuleFT2Props } from '@lasyncro/finances';

/**
 * Finances FT2 Backend Snapshot (Observed Facts Only)
 * ---------------------------------------------------
 * This represents the raw, read-only data that MAY be emitted
 * by backend systems (MarginCore / Analytics Core).
 *
 * IMPORTANT:
 * - This is NOT a cost model
 * - This is NOT financial intelligence
 * - Presence does not imply correctness or quality
 */
type FinancesFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  transactionsObserved?: number | null;

  /**
   * Cost model presence & metadata ONLY.
   * No interpretation of impact, quality, or correctness.
   */
  costModelState?: {
    hasActiveModel?: boolean | null;
    updatedAt?: string | null;
    currency?: string | null;
  } | null;

  /**
   * Directional trend ONLY.
   * No magnitude, no explanation, no reasoning.
   */
  timeSignal?: {
    trend:
      | 'improving'
      | 'deteriorating'
      | 'stable'
      | 'volatile'
      | 'unknown';
    comparedPeriod?: {
      from: string;
      to: string;
    };
  } | null;
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
      period: snapshot.period ?? { from: '', to: '' },
      transactionsObserved:
        snapshot.transactionsObserved === undefined
          ? null
          : snapshot.transactionsObserved,
    },

    costModelState:
      snapshot.costModelState === undefined
        ? null
        : snapshot.costModelState === null
        ? null
        : {
            hasActiveModel:
              snapshot.costModelState.hasActiveModel === undefined
                ? null
                : snapshot.costModelState.hasActiveModel,
            updatedAt:
              snapshot.costModelState.updatedAt === undefined
                ? null
                : snapshot.costModelState.updatedAt,
            currency:
              snapshot.costModelState.currency === undefined
                ? null
                : snapshot.costModelState.currency,
          },

    timeSignal:
      snapshot.timeSignal === undefined
        ? null
        : snapshot.timeSignal === null
        ? null
        : {
            trend:
              snapshot.timeSignal.trend === 'volatile'
                ? 'unknown'
                : snapshot.timeSignal.trend,
            comparedPeriod: snapshot.timeSignal.comparedPeriod,
          },
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
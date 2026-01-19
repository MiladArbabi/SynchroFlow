// apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts

import type { FinancesModuleFT2Props } from '@lasyncro/finances';
import { FinancesFt2Snapshot } from './useFinancesFt2Snapshot';

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
      revenueObserved:
       snapshot.context?.revenueObserved === undefined
         ? null
         : snapshot.context.revenueObserved,
      netObserved:
        snapshot.context?.netObserved === undefined
          ? null
          : snapshot.context.netObserved,
    },

    timeAwareness:
      snapshot.timeAwareness === undefined
        ? null
        : snapshot.timeAwareness,

    timeline:
      snapshot.timeline === undefined
        ? null
        : snapshot.timeline,

    blindSpots:
      snapshot.blindSpots === undefined
        ? null
        : snapshot.blindSpots,

    decisionSafety:
      snapshot.decisionSafety === undefined
        ? null
        : snapshot.decisionSafety,

    profitPreconditions:
      snapshot.profitPreconditions === undefined
        ? null
        : snapshot.profitPreconditions,

    refundReality:
      snapshot.refundReality === undefined
        ? null
        : snapshot.refundReality,
    
    costReality:
      snapshot.costReality === undefined
        ? null
        : snapshot.costReality,

    refundImpact:
      snapshot.refundImpact === undefined
        ? null
        : snapshot.refundImpact,

    financialConsistency:
      snapshot.financialConsistency === undefined
        ? null
        : snapshot.financialConsistency,
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
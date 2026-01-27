import { extractOrderRevenueAllocationFacts } from
  'api-src/services/order-facts/orderRevenueAllocationFacts.service';
import type { FT2RangeInput } from 'api-src/utils/ft2Period';


/**
 * Phase 6 — Execution-Aware Revenue Resolver
 * -----------------------------------------
 * Adds execution-aware revenue as an explicit mode.
 *
 * Rules:
 * - NEVER used by FT2
 * - Explicitly preserves unknown
 * - Visibility communicates epistemic sufficiency
 */
export async function getExecutionAwareRevenueSnapshot(input: {
  shopId: number;
  range: FT2RangeInput;
}) {
  const { shopId, range } = input;

  const allocation = await extractOrderRevenueAllocationFacts(
    shopId,
    range
  );

  const hasAnyExecutionData =
    allocation.fulfilledRevenueTotal > 0 ||
    allocation.unfulfilledRevenueTotal > 0;

  const hasUnknown = allocation.unknownRevenueTotal > 0;

  return {
    mode: 'EXECUTION_AWARE' as const,

    revenue: {
      fulfilled: allocation.fulfilledRevenueTotal,
      unfulfilled: allocation.unfulfilledRevenueTotal,
      unknown: allocation.unknownRevenueTotal,
    },

    visibility: hasAnyExecutionData && !hasUnknown
      ? { status: 'sufficient' as const }
      : {
          status: 'insufficient' as const,
          reason: hasAnyExecutionData
            ? 'PARTIAL_LINKAGE'
            : 'NO_FULFILLMENT_DATA',
        },
  };
}

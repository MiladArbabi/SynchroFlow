import type { EpistemicValue } from '@lasyncro/epistemic';
/**
 * Order Revenue — Execution-Aware Epistemic Computation
 * ----------------------------------------------------
 * Single authority for mapping execution-aware revenue facts to epistemic truth.
 *
 * Inputs:
 * - Revenue facts (fulfilled, unfulfilled, unknown) — numeric, factual
 * - Visibility signal — sufficiency + reason (proto-epistemic)
 *
 * Outputs:
 * - EpistemicValue<number> for each revenue bucket
 *
 * Mapping Rules (Deterministic, Phase 2):
 * --------------------------------------
 * 1) visibility.status === 'sufficient'
 *    → state: KNOWN
 *
 * 2) visibility.status === 'insufficient' AND (fulfilled + unfulfilled) > 0
 *    → state: INCOMPLETE
 *    → completenessRatio = (fulfilled + unfulfilled) / total
 *
 * 3) visibility.status === 'insufficient' AND (fulfilled + unfulfilled) === 0
 *    → state: UNKNOWN
 *
 * Notes:
 * - No DB access
 * - No business logic
 * - No inference beyond provided facts + visibility
 * - evaluatedAt is always stamped
 */
type ExecutionAwareRevenueFacts = {
    revenue: {
        fulfilled: number;
        unfulfilled: number;
        unknown: number;
    };
    visibility: {
        status: 'sufficient' | 'insufficient';
        reason?: 'PARTIAL_LINKAGE' | 'NO_FULFILLMENT_DATA';
    };
};
/**
 * Public API — Epistemic Revenue Projection
 */
export declare function computeExecutionAwareRevenueEpistemic(facts: ExecutionAwareRevenueFacts): {
    fulfilled: EpistemicValue<number>;
    unfulfilled: EpistemicValue<number>;
    unknown: EpistemicValue<number>;
};
/**
 * Aggregate Revenue Epistemic
 * ---------------------------
 * Pure aggregation over execution-aware revenue buckets.
 *
 * Rules:
 * - Sum of values ONLY if epistemically allowed
 * - State derived strictly via epistemic rules
 * - No inference
 */
export declare function aggregateRevenueEpistemic(input: {
    fulfilled: EpistemicValue<number>;
    unfulfilled: EpistemicValue<number>;
    unknown: EpistemicValue<number>;
}): EpistemicValue<number>;
export {};

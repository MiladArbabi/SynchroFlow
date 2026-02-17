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

function nowISO(): string {
  return new Date().toISOString();
}

function computeCompletenessRatio(
  fulfilled: number,
  unfulfilled: number,
  unknown: number
): number | undefined {
  const knownTotal = fulfilled + unfulfilled;
  const total = knownTotal + unknown;
  if (total <= 0) return undefined;
  return knownTotal / total;
}

function toEpistemicNumber(
  value: number,
  facts: ExecutionAwareRevenueFacts
): EpistemicValue<number> {
  const { fulfilled, unfulfilled, unknown } = facts.revenue;
  const knownTotal = fulfilled + unfulfilled;

  if (facts.visibility.status === 'sufficient') {
    return {
      value,
      state: 'KNOWN',
      evaluatedAt: nowISO(),
    };
  }

  if (knownTotal > 0) {
    return {
      value,
      state: 'INCOMPLETE',
      explanation: facts.visibility.reason ?? 'INSUFFICIENT_EXECUTION_VISIBILITY',
      completenessRatio: computeCompletenessRatio(
        fulfilled,
        unfulfilled,
        unknown
      ),
      evaluatedAt: nowISO(),
    };
  }

  return {
    value: null,
    state: 'UNKNOWN',
    explanation: facts.visibility.reason ?? 'NO_EXECUTION_DATA',
    evaluatedAt: nowISO(),
  };
}

/**
 * Public API — Epistemic Revenue Projection
 */
export function computeExecutionAwareRevenueEpistemic(
  facts: ExecutionAwareRevenueFacts
): {
  fulfilled: EpistemicValue<number>;
  unfulfilled: EpistemicValue<number>;
  unknown: EpistemicValue<number>;
} {
  return {
    fulfilled: toEpistemicNumber(facts.revenue.fulfilled, facts),
    unfulfilled: toEpistemicNumber(facts.revenue.unfulfilled, facts),
    unknown: toEpistemicNumber(facts.revenue.unknown, facts),
  };
}

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
export function aggregateRevenueEpistemic(input: {
  fulfilled: EpistemicValue<number>;
  unfulfilled: EpistemicValue<number>;
  unknown: EpistemicValue<number>;
}): EpistemicValue<number> {
  const values = [input.fulfilled, input.unfulfilled, input.unknown];

  if (values.some(v => v.state === 'UNKNOWN')) {
    return {
      value: null,
      state: 'UNKNOWN',
      explanation: 'INSUFFICIENT_REVENUE_KNOWLEDGE',
      evaluatedAt: new Date().toISOString(),
    };
  }

  if (values.some(v => v.state === 'INCOMPLETE')) {
    return {
      value:
        (input.fulfilled.value ?? 0) +
        (input.unfulfilled.value ?? 0),
      state: 'INCOMPLETE',
      explanation: 'PARTIAL_REVENUE_KNOWLEDGE',
      evaluatedAt: new Date().toISOString(),
    };
  }

  return {
    value:
      (input.fulfilled.value ?? 0) +
      (input.unfulfilled.value ?? 0) +
      (input.unknown.value ?? 0),
    state: 'KNOWN',
    evaluatedAt: new Date().toISOString(),
  };
}
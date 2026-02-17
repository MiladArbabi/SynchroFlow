import type { EpistemicValue } from '@lasyncro/epistemic';

/**
 * Finances — Epistemic Computation
 * --------------------------------
 * Single authority for converting raw financial facts
 * into epistemic truth.
 *
 * HARD RULES:
 * - Facts in, EpistemicValue out
 * - No intelligence
 * - No decisions
 * - No thresholds beyond epistemic state
 * - Null-honest at all times
 */

export type FinancesEpistemicInput = {
  totalRevenue: number | null;
  totalCosts: number | null;
  netResult: number | null;
  refundsObserved: number | null;
  dataCoveragePct: number | null;
  timeSeriesPoints: number;
};

export type FinancesEpistemicOutput = {
  revenue: EpistemicValue<number>;
  netResult: EpistemicValue<number>;
  refunds: EpistemicValue<number>;
};

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Revenue epistemic rules
 * ----------------------
 * - null → UNKNOWN
 * - 100% coverage → KNOWN
 * - otherwise → INCOMPLETE
 */
function computeRevenueEpistemic(
  totalRevenue: number | null,
  dataCoveragePct: number | null
): EpistemicValue<number> {
  if (totalRevenue == null) {
    return {
      value: null,
      state: 'UNKNOWN',
      explanation: 'NO_REVENUE_EVIDENCE',
      evaluatedAt: nowISO(),
    };
  }

  if (dataCoveragePct === 100) {
    return {
      value: totalRevenue,
      state: 'KNOWN',
      evaluatedAt: nowISO(),
    };
  }

  return {
    value: totalRevenue,
    state: 'INCOMPLETE',
    explanation: 'PARTIAL_REVENUE_COVERAGE',
    evaluatedAt: nowISO(),
  };
}

/**
 * Net result epistemic rules
 * -------------------------
 * - revenue UNKNOWN → UNKNOWN
 * - costs null → INCOMPLETE
 * - revenue + costs known → KNOWN
 */
function computeNetResultEpistemic(
  netResult: number | null,
  revenueEpistemic: EpistemicValue<number>,
  totalCosts: number | null
): EpistemicValue<number> {
  if (revenueEpistemic.state === 'UNKNOWN') {
    return {
      value: null,
      state: 'UNKNOWN',
      explanation: 'REVENUE_UNKNOWN',
      evaluatedAt: nowISO(),
    };
  }

  if (totalCosts == null || netResult == null) {
    return {
      value: null,
      state: 'INCOMPLETE',
      explanation: 'COSTS_UNKNOWN',
      evaluatedAt: nowISO(),
    };
  }

  return {
    value: netResult,
    state: 'KNOWN',
    evaluatedAt: nowISO(),
  };
}

/**
 * Refund epistemic rules
 * ---------------------
 * - null → UNKNOWN
 * - >= 0 → KNOWN
 */
function computeRefundsEpistemic(
  refundsObserved: number | null
): EpistemicValue<number> {
  if (refundsObserved == null) {
    return {
      value: null,
      state: 'UNKNOWN',
      explanation: 'NO_REFUND_EVIDENCE',
      evaluatedAt: nowISO(),
    };
  }

  return {
    value: refundsObserved,
    state: 'KNOWN',
    evaluatedAt: nowISO(),
  };
}

/**
 * Public API
 * ----------
 * Deterministic, side-effect free epistemic projection.
 */
export function computeFinancesEpistemic(
  input: FinancesEpistemicInput
): FinancesEpistemicOutput {
  const revenue = computeRevenueEpistemic(
    input.totalRevenue,
    input.dataCoveragePct
  );

  const netResult = computeNetResultEpistemic(
    input.netResult,
    revenue,
    input.totalCosts
  );

  const refunds = computeRefundsEpistemic(input.refundsObserved);

  return {
    revenue,
    netResult,
    refunds,
  };
}

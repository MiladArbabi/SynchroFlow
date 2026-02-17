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
/**
 * Public API
 * ----------
 * Deterministic, side-effect free epistemic projection.
 */
export declare function computeFinancesEpistemic(input: FinancesEpistemicInput): FinancesEpistemicOutput;

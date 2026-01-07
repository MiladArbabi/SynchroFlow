import type { FinancesFacts } from 'api-src/services/finances-facts/FinancesFacts.types';

export type FinancesStatus = 'good' | 'bad' | 'unknown';
export type TrendDirection = 'up' | 'down' | 'flat' | 'unknown';

export interface FinancesIntelligence {
  netResult: {
    value: number | null;
    status: FinancesStatus;
  };

  trend: {
    direction: TrendDirection;
  };

  dataCoveragePct: number | null;

  // INTERNAL ONLY — MUST NEVER LEAK
  marginPct: number | null;
  lossReason: string | null;
}

/**
 * Finances Intelligence Service
 * ----------------------------
 * Converts raw financial facts into classified meaning.
 *
 * Rules:
 * - NO database access
 * - NO UI semantics
 * - NO explanations
 * - NO exposure guarantees
 *
 * Intelligence may decide.
 * Intelligence may NOT speak.
 */
export function buildFinancesIntelligence(
  facts: FinancesFacts
): FinancesIntelligence {
  const { totalRevenue, totalCosts, netResult, dataCoverage } = facts;

  // Status classification (pure)
  let status: FinancesStatus = 'unknown';

  if (netResult != null) {
    status = netResult >= 0 ? 'good' : 'bad';
  }

  // Trend — unknown by default (no historical comparison here)
  const trendDirection: TrendDirection = 'unknown';

  // Margin — internal only
  const marginPct =
    totalRevenue == null || totalRevenue === 0 || netResult == null
      ? null
      : (netResult / totalRevenue) * 100;

  // Loss reason — placeholder, classification-only
  const lossReason =
    netResult != null && netResult < 0 ? 'net_negative' : null;

  return {
    netResult: {
      value: netResult,
      status,
    },

    trend: {
      direction: trendDirection,
    },

    dataCoveragePct: dataCoverage.completenessPct,

    marginPct,
    lossReason,
  };
}

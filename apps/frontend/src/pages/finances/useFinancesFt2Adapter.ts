//apps/frontend/src/pages/finances/useFinancesFt2Adapter.ts
import type { FinancesModuleFT2Props } from '@lasyncro/finances';

type FinancesFt2Snapshot = {
  period?: {
    from: string;
    to: string;
  };

  transactionsAnalyzed?: number | null;

  costSummary?: {
    totalRevenue?: number | null;
    totalCost?: number | null;
    netResult?: number | null;
    currency?: string | null;
  };

  costBreakdown?: Array<{
    type:
      | 'cogs'
      | 'fulfillment'
      | 'fees'
      | 'overhead'
      | 'refunds'
      | 'other';
    amount?: number | null;
    pctOfRevenue?: number | null;
  }> | null;

  dominantPressure?: {
    type:
      | 'cogs'
      | 'fulfillment'
      | 'fees'
      | 'overhead'
      | 'refunds'
      | 'unknown';
    confidence: 'high' | 'medium' | 'low';
  } | null;

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
 * FT2 Finances Adapter
 * -------------------
 * Pure mapping from backend snapshot → FinancesModuleFT2Props
 *
 * Invariants:
 * - No inference
 * - No lifecycle
 * - No defaulting (undefined → null)
 * - Shape-stable
 */
export function mapFinancesFt2Props(
  snapshot: FinancesFt2Snapshot
): FinancesModuleFT2Props {
  return {
    context: {
      period: snapshot.period ?? { from: '', to: '' },
      transactionsAnalyzed:
        snapshot.transactionsAnalyzed === undefined
          ? null
          : snapshot.transactionsAnalyzed,
    },

    costSummary: {
      totalRevenue:
        snapshot.costSummary?.totalRevenue === undefined
          ? null
          : snapshot.costSummary.totalRevenue,
      totalCost:
        snapshot.costSummary?.totalCost === undefined
          ? null
          : snapshot.costSummary.totalCost,
      netResult:
        snapshot.costSummary?.netResult === undefined
          ? null
          : snapshot.costSummary.netResult,
      currency:
        snapshot.costSummary?.currency === undefined
          ? null
          : snapshot.costSummary.currency,
    },

    costBreakdown:
      snapshot.costBreakdown == null
        ? null
        : snapshot.costBreakdown.map((c) => ({
            type: c.type,
            amount: c.amount === undefined ? null : c.amount,
            pctOfRevenue:
              c.pctOfRevenue === undefined ? null : c.pctOfRevenue,
          })),

    dominantPressure:
      snapshot.dominantPressure === undefined
        ? null
        : snapshot.dominantPressure,

    timeSignal:
      snapshot.timeSignal === undefined ? null : snapshot.timeSignal,
  };
}
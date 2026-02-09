import { buildFinancesFacts } from 'api-src/services/finances-facts';
import { buildFinancesIntelligence } from 'api-src/services/finances-intelligence/FinancesIntelligence.service';
import { buildFinancesFtep } from 'api-src/services/finances-ftep';
import { computeFinancesEpistemic } from 'api-src/services/epistemic/finances.epistemic';

interface GetFinancesFt2SnapshotInput {
  shopId: number;
  period: {
    from: string;
    to: string;
  };
}

/**
 * Finances FT2 Provider
 * --------------------
 * Canonical FT2 snapshot builder.
 *
 * Strict pipeline:
 * Facts → Intelligence → FTEP
 *
 * No logic.
 * No mutation.
 * No interpretation.
 */
export async function getFinancesFt2Snapshot(
  input: GetFinancesFt2SnapshotInput
) {
  const facts = await buildFinancesFacts(input);
  const intelligence = buildFinancesIntelligence(facts);

  /**
   * Epistemic computation (Phase 10)
   * --------------------------------
   * Single aggregated revenue epistemic.
   * No decisions made here.
   */
  const epistemic = computeFinancesEpistemic({
    totalRevenue: facts.totalRevenue,
    totalCosts: facts.totalCosts,
    netResult: facts.netResult,
    refundsObserved: facts.refundsObserved,
    dataCoveragePct: facts.dataCoverage.completenessPct,
    timeSeriesPoints: facts.timeSeries.points.length,
  });

  return buildFinancesFtep({
    facts,
    intelligence,
    epistemic: {
      revenue: epistemic.revenue,
    },
  });
}
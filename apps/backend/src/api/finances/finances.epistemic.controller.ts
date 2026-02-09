import { buildFinancesFacts } from
  'api-src/services/finances-facts';

import { computeFinancesEpistemic } from
  'api-src/services/epistemic/finances.epistemic';

/**
 * Finances — Epistemic Endpoint (Phase 13)
 * ---------------------------------------
 * Purpose:
 * - Expose finances as EpistemicValue<T>
 * - Additive, non-FT2 surface
 * - No intelligence
 * - No decisions
 *
 * Contract:
 * - Facts → Epistemic only
 * - Null-honest
 * - evaluatedAt always present
 */
export default async function financesEpistemicController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const period = {
    from: req.query.from,
    to: req.query.to,
  };

  console.log('[finances:epistemic] handler entered', {
    shopId,
    period,
 });


  if (!period.from || !period.to) {
    return res.status(400).json({
      error: 'Missing period',
      required: ['from', 'to'],
    });
  }

  const facts = await buildFinancesFacts({
    shopId,
    period,
  });

  const epistemic = computeFinancesEpistemic({
    totalRevenue: facts.totalRevenue,
    totalCosts: facts.totalCosts,
    netResult: facts.netResult,
    refundsObserved: facts.refundsObserved,
    dataCoveragePct: facts.dataCoverage.completenessPct,
    timeSeriesPoints: facts.timeSeries.points.length,
  });

  return res.json({
    period,
    epistemic,
  });
}

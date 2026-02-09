import { resolveFt2RangeFromRequest } from
  'api-src/utils/resolveFt2RangeFromRequest';

import { getExecutionAwareRevenueSnapshot } from
  'api-src/services/order-revenue/orderRevenueExecutionAware.resolver';

import { computeExecutionAwareRevenueEpistemic } from
  'api-src/services/epistemic/orderRevenueExecutionAware.epistemic';

/**
 * Order-Nexus Revenue — Epistemic (Phase 3)
 * ----------------------------------------
 * Purpose:
 * - Expose execution-aware revenue as EpistemicValue<T>
 * - Preserve truth end-to-end without fabrication
 *
 * Contract:
 * - Additive endpoint
 * - No primitives collapsed
 * - No adapters
 * - evaluatedAt always present
 *
 * Migration:
 * - /order-nexus/revenue remains primitive
 * - This endpoint is the epistemic successor
 */
export default async function orderNexusRevenueEpistemicController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;
  const mode = req.query.mode;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (mode !== 'execution_aware') {
    return res.status(400).json({
      error: 'Invalid mode',
      allowed: ['execution_aware'],
    });
  }

  const range = resolveFt2RangeFromRequest(req);

  const snapshot = await getExecutionAwareRevenueSnapshot({
    shopId,
    range,
  });

  const epistemicRevenue =
    computeExecutionAwareRevenueEpistemic(snapshot);

  return res.json({
    mode: 'EXECUTION_AWARE',
    revenue: epistemicRevenue,
  });
}

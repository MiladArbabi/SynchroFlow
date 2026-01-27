import { resolveFt2RangeFromRequest } from
  'api-src/utils/resolveFt2RangeFromRequest';

import { getExecutionAwareRevenueSnapshot } from
  'api-src/services/order-revenue/orderRevenueExecutionAware.resolver';

/**
 * Order-Nexus Revenue — Phase 6
 * -----------------------------
 * Explicit execution-aware revenue endpoint.
 *
 * Hard rules:
 * - Requires mode=execution_aware
 * - Never falls back to FT2
 * - Never infers missing execution
 */
export default async function orderNexusRevenuePhase6Controller(
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

  return res.json(snapshot);
}

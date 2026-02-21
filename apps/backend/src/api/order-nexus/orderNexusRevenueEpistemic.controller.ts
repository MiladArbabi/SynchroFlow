import { computeExecutionAwareRevenueEpistemic } from "../../services/epistemic/orderRevenueExecutionAware.epistemic.js";
import { getExecutionAwareRevenueSnapshot } from "../../services/order-revenue/orderRevenueExecutionAware.resolver.js";

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

  const snapshot = await getExecutionAwareRevenueSnapshot({
    shopId,
  });

  const epistemicRevenue =
    computeExecutionAwareRevenueEpistemic(snapshot);

  return res.json({
    mode: 'EXECUTION_AWARE',
    revenue: epistemicRevenue,
  });
}

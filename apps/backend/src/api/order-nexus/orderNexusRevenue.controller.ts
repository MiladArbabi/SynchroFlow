import { resolveFt2RangeFromRequest } from
  'api-src/utils/resolveFt2RangeFromRequest';

import { getExecutionAwareRevenueSnapshot } from
  'api-src/services/order-revenue/orderRevenueExecutionAware.resolver';

/**
 * EPISTEMIC GUARD (Phase 1 — Containment)
 * --------------------------------------
 * This controller MUST NOT construct, adapt, or infer EpistemicValue.
 *
 * Rationale:
 * - Epistemic state must be computed exactly once, in a dedicated backend
 *   epistemic computation layer.
 * - Adapting primitives to EpistemicValue at the API boundary fabricates
 *   knowledge and violates the epistemic contract.
 *
 * Status:
 * - This endpoint intentionally returns primitives until the epistemic
 *   computation layer is introduced (Phase 2).
 * - See docs/epistemic/phase-1.md for details.
 */

/**
 * This controller MUST NOT construct, adapt, or infer EpistemicValue.
 * …
 * This endpoint intentionally returns primitives
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

  // Phase 1 containment:
  // Return snapshot unchanged to avoid epistemic fabrication.
  return res.json(snapshot);
}

// apps/backend/src/api/order-nexus/orders.operator.controller.ts

import { getOrdersOperatorSummary } from '../../services/orders-operator/OrdersOperatorSummary.provider.js';

/**
 * Orders Operator Summary Controller
 * -----------------------------------
 * HTTP handler for GET /api/v1/modules/order-nexus/operator-summary
 *
 * Rules:
 * - Authenticated (enforced at route level)
 * - Shop-scoped via req.user.shopId
 * - No FTEP constraints — purpose-built operator surface
 * - No business logic here — delegate entirely to provider
 */
export async function httpGetOrdersOperatorSummary(
  req: any,
  res: any
): Promise<void> {
  const shopId = req.user?.shopId;

  if (!shopId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    const summary = await getOrdersOperatorSummary(shopId);
    res.json(summary);
  } catch (err) {
    console.error('[orders.operator.controller] Failed to build operator summary', {
      shopId,
      error: err,
    });
    res.status(500).json({ error: 'Failed to load operator summary' });
  }
}
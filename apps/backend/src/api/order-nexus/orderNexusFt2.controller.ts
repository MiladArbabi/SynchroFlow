// apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts

import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';

/**
 * Order-Nexus FT2 Controller
 * -------------------------
 * Read-only FT2 exposure endpoint.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - No lifecycle logic
 * - No business logic
 */
export async function orderNexusFt2Controller(req: any, res: any) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const from = req.query?.from;
  const to = req.query?.to;

  if (typeof from !== 'string' || typeof to !== 'string') {
    return res.status(400).json({ error: 'Invalid period' });
  }

  const snapshot = await getOrderNexusFt2Snapshot({
    shopId,
    period: { from, to },
  });

  return res.json(snapshot);
}
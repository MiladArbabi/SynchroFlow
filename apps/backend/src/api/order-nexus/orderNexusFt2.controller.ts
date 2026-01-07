// apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts

import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';
import { getFt2Period } from 'api-src/utils/ft2Period';

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

  const period = getFt2Period();

  const snapshot = await getOrderNexusFt2Snapshot({
    shopId,
    period,
  });

  return res.json(snapshot);
}
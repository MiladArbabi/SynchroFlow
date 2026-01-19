// apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts

import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';
import { FT2DateRangePreset, getFt2Period, resolveFt2PeriodFromPreset } from 'api-src/utils/ft2Period';
import { resolveFt2RangeFromRequest } from 'api-src/utils/resolveFt2RangeFromRequest';

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
export default async function orderNexusFt2Controller(req: any, res: any) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const preset = req.query.preset as FT2DateRangePreset | undefined;

  const range = resolveFt2RangeFromRequest(req);

  const snapshot = await getOrderNexusFt2Snapshot({
    shopId,
    range,
  });

  return res.json(snapshot);
}
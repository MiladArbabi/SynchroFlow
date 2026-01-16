// apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts

import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';
import { FT2DateRangePreset, getFt2Period, resolveFt2PeriodFromPreset } from 'api-src/utils/ft2Period';

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

  const period = preset
    ? preset === 'custom'
      ? resolveFt2PeriodFromPreset({
          preset: 'custom',
          from: String(req.query.from),
          to: String(req.query.to),
        })
      : resolveFt2PeriodFromPreset({ preset })
    : getFt2Period();

  const snapshot = await getOrderNexusFt2Snapshot({
    shopId,
    period,
  });

  return res.json(snapshot);
}
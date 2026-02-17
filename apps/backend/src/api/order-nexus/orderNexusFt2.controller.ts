// apps/backend/src/api/order-nexus/orderNexusFt2.controller.ts

import { getOrderNexusFt2Snapshot } from "../../services/order-nexus-ft2/orderNexusFt2.resolver.js";
import { FT2DateRangePreset } from "@lasyncro/backend-core/utils/ft2Period.js";
import { resolveFt2RangeFromRequest } from "../../utils/resolveFt2RangeFromRequest.js";

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
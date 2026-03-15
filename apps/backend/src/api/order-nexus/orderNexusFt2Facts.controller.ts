/**
 * SERVICE IMPORTS
 * ---------------
 * Explicit separation of fact surfaces.
 *
 * distribution → categorical breakdown
 * coverage → operational coverage metrics
 *
 * NOTE:
 * Never reuse services across fact surfaces.
 * Each endpoint must map 1:1 to its projection service.
 */
import { getOrderNexusFt2Distribution } from '../../services/order-nexus-ft2/orderNexusFt2.distribution.js';
import { getOrderNexusFt2Coverage } from '../../services/order-nexus-ft2/orderNexusFt2.coverage.js';
import { getOrderNexusFt2Timeseries } from '../../services/order-nexus-ft2/orderNexusFt2.timeseries.js';
import { FT2DateRangePreset } from "@lasyncro/backend-core/utils/ft2Period.js";
import { resolveFt2RangeFromRequest } from "../../utils/resolveFt2RangeFromRequest.js";

/**
 * Order-Nexus FT2 Facts Controller
 * --------------------------------
 * Read-only fact surfaces.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - Backend-owned period
 * - No lifecycle logic
 * - No intelligence
 */
export async function orderNexusFt2TimeseriesController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const range = resolveFt2RangeFromRequest(req);

  const result = await getOrderNexusFt2Timeseries({
    shopId,
    range,
  });

  return res.json(result);
}

export async function orderNexusFt2DistributionController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const range = resolveFt2RangeFromRequest(req);

  /**
   * COVERAGE FACT SURFACE
   * ---------------------
   * Must call coverage projection service.
   * Prevents accidental cross-surface metric leakage.
   */
  const result = await getOrderNexusFt2Coverage({
    shopId,
    range,
  });

  return res.json(result);
}

export async function orderNexusFt2CoverageController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const range = resolveFt2RangeFromRequest(req);

  const result = await getOrderNexusFt2Distribution({
    shopId,
    range,
  });

  return res.json(result);
}
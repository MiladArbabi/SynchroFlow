import { getOrderNexusFt2Distribution } from '../../services/order-nexus-ft2/orderNexusFt2.disribution.js';
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

  const preset = req.query.preset as FT2DateRangePreset | undefined;

  const range = resolveFt2RangeFromRequest(req);
}

export async function orderNexusFt2DistributionController(
  req: any,
  res: any
) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const preset = req.query.preset as FT2DateRangePreset | undefined;

  const range = resolveFt2RangeFromRequest(req);

  const result = await getOrderNexusFt2Distribution({
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

  const preset = req.query.preset as FT2DateRangePreset | undefined;

  const range = resolveFt2RangeFromRequest(req);

  const result = await getOrderNexusFt2Distribution({
    shopId,
    range,
  });

  return res.json(result);
}
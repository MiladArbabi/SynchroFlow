import { FT2DateRangePreset, getFt2Period, resolveFt2PeriodFromPreset } from 'api-src/utils/ft2Period';

import {
  getOrderNexusFt2Timeseries,
  getOrderNexusFt2Distribution,
  getOrderNexusFt2Coverage,
} from 'api-src/services/order-nexus-ft2';
import { resolveFt2RangeFromRequest } from 'api-src/utils/resolveFt2RangeFromRequest';

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
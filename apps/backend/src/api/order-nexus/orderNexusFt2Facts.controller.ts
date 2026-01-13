import { getFt2Period } from 'api-src/utils/ft2Period';

import {
  getOrderNexusFt2Timeseries,
  getOrderNexusFt2Distribution,
  getOrderNexusFt2Coverage,
} from 'api-src/services/order-nexus-ft2';

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

  const period = getFt2Period();

  const result = await getOrderNexusFt2Timeseries({
    shopId,
    period,
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

  const period = getFt2Period();

  const result = await getOrderNexusFt2Distribution({
    shopId,
    period,
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

  const period = getFt2Period();

  const result = await getOrderNexusFt2Coverage({
    shopId,
    period,
  });

  return res.json(result);
}
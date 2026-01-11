// apps/backend/src/api/dashboard/dashboard.ft2.controller.ts

import { Request, Response } from 'express';
import { getFt2Period } from 'api-src/utils/ft2Period';

import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';
import { getProductsFt2Snapshot } from 'api-src/services/products-ft2.provider';

import { buildDashboardFt2Coverage } from './dashboardFt2Coverage';
import { buildDashboardFt2SystemHealth } from './dashboardFt2SystemHealth';

/**
 * GET /api/v1/dashboard/ft2
 *
 * System-level FT2 observability snapshot.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - Read-only
 * - Consumes FT2 exposures only (Layer 3)
 * - No facts / intelligence access
 * - No inference
 */
export async function getDashboardFt2Snapshot(
  req: Request,
  res: Response
): Promise<void> {
  const shopId = req.user?.shopId;

  if (!shopId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const period = getFt2Period();

  const [ordersFt2, productsFt2] = await Promise.all([
    getOrderNexusFt2Snapshot({ shopId, period }),
    getProductsFt2Snapshot({ shopId, period }),
  ]);

  const coverage = buildDashboardFt2Coverage({
    orders: ordersFt2,
    products: productsFt2,
  });

  res.status(200).json({
    observationWindow: period,
    coverage,
    systemHealth: buildDashboardFt2SystemHealth({
      orders: ordersFt2,
      products: productsFt2,
    }),
  });
}
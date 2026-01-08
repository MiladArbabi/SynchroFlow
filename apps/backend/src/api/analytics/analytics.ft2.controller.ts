// apps/backend/src/api/analytics/analytics.ft2.controller.ts

import { Request, Response } from 'express';
import { getAnalyticsFt2Snapshot } from 'api-src/services/analytics-ft2.provider';
import { getFt2Period } from 'api-src/utils/ft2Period';

/**
 * Analytics FT2 Controller
 *
 * * Read-only FT2 exposure endpoint.
 *
 * Rules:
 * - Authenticated
 * - Shop-scoped
 * - No lifecycle logic
 * - No business logic
 */
export async function analyticsFt2Controller(req: any, res: any) {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const period = getFt2Period();

  const snapshot = await getAnalyticsFt2Snapshot({
    shopId,
    period,
  });

  return res.json(snapshot);
}

// apps/backend/src/api/analytics/analytics.ft2.controller.ts

import { Request, Response } from 'express';
import { getAnalyticsFt2Snapshot } from 'api-src/services/analytics-ft2.provider';

/**
 * GET /api/v1/analytics/ft2
 *
 * FT2-only endpoint.
 *
 * Responsibilities:
 * - Authenticate user (handled upstream)
 * - Resolve lifecycle
 * - Hard-gate FT2
 * - Execute Facts → Intelligence → FTEP
 * - Return FT2 exposure only
 *
 * Forbidden:
 * - Business logic
 * - Aggregation
 * - Intelligence
 * - Lifecycle mutation
 */
export async function analyticsFt2Controller(
  req: Request,
  res: Response
): Promise<Response> {
  const shopId = req.user?.shopId;

  if (!shopId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { from, to } = req.query;

  if (typeof from !== 'string' || typeof to !== 'string') {
    return res.status(400).json({ error: 'Invalid period' });
  }

  const snapshot = await getAnalyticsFt2Snapshot({
    shopId,
    period: { from, to },
  });

  return res.json(snapshot);
}

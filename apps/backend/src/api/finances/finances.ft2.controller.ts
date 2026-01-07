// apps/backend/src/api/finances/finances.ft2.controller.ts

import { Request, Response } from 'express';
import { getFinancesFt2Snapshot } from 'api-src/services/finances-ft2.provider';

/**
 * GET /api/v1/finances/ft2
 *
 * FT2-only endpoint.
 *
 * Responsibilities:
 * - Authenticate user (handled upstream)
 * - Validate input
 * - Execute Facts → Intelligence → FTEP
 * - Return FT2 exposure only
 *
 * Forbidden:
 * - Business logic
 * - Aggregation
 * - Intelligence
 * - Lifecycle mutation
 */
export async function financesFt2Controller(
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

  const snapshot = await getFinancesFt2Snapshot({
    shopId,
    period: { from, to },
  });

  return res.json(snapshot);
}
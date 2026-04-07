// apps/backend/src/api/returns/returns.controller.ts

import { Request, Response } from 'express';
import { computeReturnsIntelligence } from '../../services/returns/returnsIntelligence.service.js';

/**
 * GET /api/v1/modules/returns
 * ----------------------------
 * Returns shop-level returns intelligence summary and per-variant breakdown.
 *
 * Sources:
 * - refund_executions (refund records)
 * - order_revenue_units (line item revenue and cost)
 * - inventory_movements (refund_return movements for restock rate)
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only — never mutates
 * - RLS enforced via computeReturnsIntelligence service
 */
export const httpGetReturns = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await computeReturnsIntelligence(shopId);

    return res.status(200).json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[RETURNS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch returns intelligence: ${message}`,
    });
  }
};
// apps/backend/src/api/cashflow/cashflow.controller.ts

import { Request, Response } from 'express';
import { computeCashFlowProjection } from '../../services/cashflow/cashFlowProjection.service.js';

/**
 * GET /api/v1/modules/cashflow
 * -----------------------------
 * Returns shop cash flow projection:
 * - Summary: realized, pending, at-risk, refunded, inventory value
 * - Buckets: revenue by fulfillment state
 * - By constraint: blocked revenue breakdown
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only
 * - Computed on demand — not cached
 */
export const httpGetCashFlow = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await computeCashFlowProjection(shopId);

    return res.status(200).json(result);

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CASHFLOW_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch cash flow projection: ${message}`,
    });
  }
};
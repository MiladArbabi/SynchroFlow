// apps/backend/src/api/orders/orders.decision.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/decision/operational-brief
 *
 * Purpose:
 * - Expose authoritative daily_operational_brief_snapshot
 * - Read-only
 * - No transformation
 * - No inference
 *
 * Contract:
 * - Returns latest snapshot row for authenticated shop
 * - Backend ordering authoritative
 */
export const httpGetDailyOperationalBrief = async (
  req: Request,
  res: Response
) => {
  try {
    /**
     * TENANT IDENTITY RESOLUTION
     * --------------------------
     * Operational brief must be scoped to authenticated tenant.
     */
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({
        error: 'Unauthorized: missing shop context',
      });
    }

    console.debug('[Decision][OperationalBrief] Fetch latest snapshot', {
        shopId,
    });

    const snapshot = await db('daily_operational_brief_snapshot')
        .where({ shop_id: shopId })
        /**
         * Ordering rule:
         * - Latest brief_date authoritative
         * - Replace-on-reconcile guarantees 1 row per (shop_id, brief_date)
         */
        .orderBy('brief_date', 'desc')
        .first();
        
    console.debug('[Decision][OperationalBrief] Result', {
        found: !!snapshot,
        briefDate: snapshot?.brief_date ?? null,
    });

    res.status(200).json(snapshot ?? null);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({
      error: `Failed to fetch operational brief snapshot: ${message}`,
    });
  }
};
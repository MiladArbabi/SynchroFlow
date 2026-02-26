// apps/backend/src/api/orders/orders.operational-control.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/operational-control
 * --------------------------------------
 * Phase 1 Control Tower Surface.
 *
 * Contract:
 * - Read-only
 * - Snapshot-backed only
 * - No aggregation
 * - No inference
 * - Replace-on-reconcile respected
 *
 * Returns:
 * - Latest (shop_id, snapshot_date) row
 * - Null if no snapshot exists
 */
export const httpGetOperationalControl = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const snapshot = await db('orders_operational_control_snapshot')
      .where({ shop_id: shopId })
      .orderBy('snapshot_date', 'desc')
      .first();

    return res.status(200).json(snapshot ?? null);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unknown error';

    return res.status(500).json({
      error: `Failed to fetch operational control snapshot: ${message}`,
    });
  }
};
// apps/backend/src/api/orders/orders.constrained.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/constrained
 * ------------------------------
 * Returns paginated list of constrained orders for the Fulfillment Queue UI.
 *
 * Source of truth:
 * - order_constraints (canonical, is_active per type)
 * - orders (revenue, identity)
 * - decisions (recommended_action)
 *
 * RULES:
 * - Read-only
 * - RLS enforced via app.current_tenant SET LOCAL
 * - Never compute constraints here — reads order_constraints only
 *
 * Query params:
 * - page (default 1)
 * - limit (default 50, max 100)
 * - constraint_type: 'operational' | 'inventory' | 'customer' (optional filter)
 */
export const httpGetConstrainedOrders = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;
    const constraintType = req.query.constraint_type as string | undefined;

    const rows = await db.transaction(async (trx) => {
      /**
       * RLS CONTEXT (CRITICAL)
       * ----------------------
       * Must be SET LOCAL inside transaction before any RLS-protected table access.
       * Canonical variable: app.current_tenant (integer)
       */
      await trx.raw(`SET LOCAL "app.current_tenant" = ?`, [shopId]);

      const query = trx('order_constraints as oc')
        .join('orders as o', 'o.lasyncro_order_id', 'oc.lasyncro_order_id')
        .leftJoin('decisions as d', function () {
          this.on('d.entity_id', '=', 'oc.lasyncro_order_id')
            .andOn('d.shop_id', '=', trx.raw('?', [shopId]));
        })
        .where('oc.is_active', true)
        .where('o.shop_id', shopId)
        .select(
          'oc.lasyncro_order_id as order_id',
          'oc.constraint_type',
          'oc.block_type',
          'oc.started_at as constrained_since',
          'o.total_price as revenue',
          'd.recommended_action',
          'd.priority',
          'd.id as decision_id'
        )
        .orderBy('d.priority', 'desc')
        .limit(limit)
        .offset(offset);

      if (constraintType) {
        query.where('oc.constraint_type', constraintType);
      }

      return query;
    });

    return res.status(200).json({
      data: rows,
      pagination: {
        page,
        limit,
        /**
         * NOTE: total count omitted for performance — use next page presence
         * to determine if more results exist. Add COUNT query if UI requires it.
         */
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[CONSTRAINED_ORDERS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch constrained orders: ${message}`,
    });
  }
};
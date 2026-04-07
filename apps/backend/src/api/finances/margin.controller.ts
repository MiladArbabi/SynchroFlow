// apps/backend/src/api/finances/margin.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/modules/finances/margin
 * -------------------------------------
 * Exposes margin intelligence for the finances module.
 *
 * Returns:
 * - Shop-level margin summary (avg, min, max, total)
 * - Per-order margin data (paginated, sorted by margin_pct)
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only — strict passthrough from order_margin_snapshot
 * - RLS enforced via SET LOCAL app.current_tenant
 * - No inference — raw projection data only
 *
 * Query params:
 * - limit: number (default 50, max 100)
 * - page: number (default 1)
 * - sort: 'margin_pct' | 'gross_margin' | 'gross_revenue' (default margin_pct)
 * - order: 'asc' | 'desc' (default asc — lowest margin first, needs attention)
 */
export const httpGetMargin = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;

    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const offset = (page - 1) * limit;

    const validSortFields = ['margin_pct', 'gross_margin', 'gross_revenue'];
    const sort = validSortFields.includes(req.query.sort as string)
      ? req.query.sort as string
      : 'margin_pct';

    const order = req.query.order === 'desc' ? 'desc' : 'asc';

    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      /**
       * SHOP-LEVEL SUMMARY
       * ------------------
       * Aggregate metrics for the finances module header.
       */
      const summary = await trx('order_margin_snapshot as oms')
        .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
          trx.raw('COUNT(*) as total_orders'),
          trx.raw('ROUND(AVG(oms.margin_pct) * 100, 1) as avg_margin_pct'),
          trx.raw('ROUND(MIN(oms.margin_pct) * 100, 1) as min_margin_pct'),
          trx.raw('ROUND(MAX(oms.margin_pct) * 100, 1) as max_margin_pct'),
          trx.raw('ROUND(SUM(oms.gross_revenue), 2) as total_revenue'),
          trx.raw('ROUND(SUM(oms.gross_margin), 2) as total_margin'),
          trx.raw('ROUND(SUM(oms.estimated_cost), 2) as total_cost'),
        )
        .first();

      /**
       * PER-ORDER MARGIN DATA
       * ---------------------
       * Sorted by margin_pct ascending by default —
       * lowest margin orders surface first (need attention).
       */
      const orders = await trx('order_margin_snapshot as oms')
        .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .select(
          'oms.lasyncro_order_id as order_id',
          'oms.gross_revenue',
          'oms.estimated_cost',
          'oms.gross_margin',
          trx.raw('ROUND(oms.margin_pct * 100, 1) as margin_pct'),
          'oms.aggregate_version',
          'oms.evaluated_at',
          'o.total_price',
        )
        .orderBy(`oms.${sort}`, order)
        .limit(limit)
        .offset(offset);

      return { summary, orders };
    });

    return res.status(200).json({
      summary: {
        total_orders: Number(result.summary?.total_orders ?? 0),
        avg_margin_pct: Number(result.summary?.avg_margin_pct ?? 0),
        min_margin_pct: Number(result.summary?.min_margin_pct ?? 0),
        max_margin_pct: Number(result.summary?.max_margin_pct ?? 0),
        total_revenue: Number(result.summary?.total_revenue ?? 0),
        total_margin: Number(result.summary?.total_margin ?? 0),
        total_cost: Number(result.summary?.total_cost ?? 0),
      },
      orders: result.orders,
      pagination: { page, limit },
    });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MARGIN_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch margin data: ${message}`,
    });
  }
};
// apps/backend/src/api/finances/finances.margin.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/modules/finances/margin
 * -------------------------------------
 * Returns shop-level margin summary and per-order margin breakdown.
 *
 * Sources:
 * - order_margin_snapshot (per-order margin)
 * - order_fulfillment_status (filter by status)
 *
 * Query params:
 * - status: 'all' | 'pending' | 'fulfilled' (default: 'all')
 * - limit: number (default 50, max 100)
 * - page: number (default 1)
 *
 * RULES:
 * - Authenticated + shop-scoped
 * - Read-only — passthrough from projection snapshot
 * - RLS enforced via SET LOCAL app.current_tenant
 * - Never recompute — snapshot is source of truth
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

    const status = req.query.status as string | undefined;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const offset = (page - 1) * limit;

    const result = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      /**
       * SHOP-LEVEL MARGIN SUMMARY
       * -------------------------
       * Aggregate across all orders with margin data.
       */
      const summaryQuery = trx('order_margin_snapshot as oms')
        .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
        .where('oms.shop_id', shopId)
        .select(
          trx.raw('COUNT(*) as order_count'),
          trx.raw('ROUND(SUM(oms.gross_revenue), 2) as total_revenue'),
          trx.raw('ROUND(SUM(oms.estimated_cost), 2) as total_cost'),
          trx.raw('ROUND(SUM(oms.gross_margin), 2) as total_margin'),
          trx.raw('ROUND(AVG(oms.margin_pct) * 100, 1) as avg_margin_pct'),
          trx.raw('ROUND(MIN(oms.margin_pct) * 100, 1) as min_margin_pct'),
          trx.raw('ROUND(MAX(oms.margin_pct) * 100, 1) as max_margin_pct'),
        )
        .first();

      /**
       * PER-ORDER MARGIN LIST
       * ---------------------
       * Paginated, joinable with fulfillment status for filtering.
       */
      const ordersQuery = trx('order_margin_snapshot as oms')
        .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
        .leftJoin('order_fulfillment_status as ofs', 'ofs.lasyncro_order_id', 'oms.lasyncro_order_id')
        .where('oms.shop_id', shopId)
        .select(
          'oms.lasyncro_order_id as order_id',
          'oms.gross_revenue',
          'oms.estimated_cost',
          'oms.gross_margin',
          trx.raw('ROUND(oms.margin_pct * 100, 1) as margin_pct'),
          'oms.aggregate_version',
          'ofs.status as fulfillment_status',
          'oms.evaluated_at',
        )
        .orderBy('oms.gross_margin', 'desc')
        .limit(limit)
        .offset(offset);

      if (status && status !== 'all') {
        ordersQuery.where('ofs.status', status);
      }

      const [summary, orders] = await Promise.all([
        summaryQuery,
        ordersQuery,
      ]);

      return { summary, orders };
    });

    return res.status(200).json({
      summary: {
        order_count: Number(result.summary?.order_count ?? 0),
        total_revenue: Number(result.summary?.total_revenue ?? 0),
        total_cost: Number(result.summary?.total_cost ?? 0),
        total_margin: Number(result.summary?.total_margin ?? 0),
        avg_margin_pct: Number(result.summary?.avg_margin_pct ?? 0),
        min_margin_pct: Number(result.summary?.min_margin_pct ?? 0),
        max_margin_pct: Number(result.summary?.max_margin_pct ?? 0),
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
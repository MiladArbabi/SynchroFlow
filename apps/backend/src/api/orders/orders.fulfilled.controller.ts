// apps/backend/src/api/orders/orders.fulfilled.controller.ts

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/orders/fulfilled
 * ----------------------------
 * Shipped orders ledger for the Outbound tab.
 *
 * Source of truth:
 * - order_fulfillment_status (status = 'fulfilled', fulfilled_at)
 * - orders (total_price, order_created_at)
 * - external_order_identity_map (human-readable Shopify order ID)
 *
 * RULES:
 * - Read-only
 * - RLS enforced via SET LOCAL app.current_tenant
 * - Returns fulfilled orders sorted by fulfilled_at DESC
 * - Derives hours_to_fulfil from order_created_at → fulfilled_at
 *
 * Query params:
 * - page (default 1)
 * - limit (default 50, max 100)
 */
export const httpGetFulfilledOrders = async (
  req: Request,
  res: Response
) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const page   = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 25));
    const offset = (page - 1) * limit;

    const SORT_FIELDS: Record<string, string> = {
      fulfilled_at:      'ofs.fulfilled_at',
      order_created_at:  'o.order_created_at',
      total_price:       'o.total_price',
      hours_to_fulfil:   db.raw(`EXTRACT(EPOCH FROM (ofs.fulfilled_at - o.order_created_at))`).toString(),
    };
    const sortField = SORT_FIELDS[req.query.sort as string] ?? 'ofs.fulfilled_at';
    const sortDir   = req.query.dir === 'asc' ? 'asc' : 'desc';

    const range = req.query.range as string;
    const rangeFilter: Record<string, number> = { week: 7, month: 30 };
    const rangeDays = rangeFilter[range] ?? null;

    const { rows, total } = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const rows = await trx('order_fulfillment_status as ofs')
        .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .leftJoin(
          'external_order_identity_map as eim',
          'eim.lasyncro_order_id',
          'o.lasyncro_order_id'
        )
        .where('ofs.status', 'fulfilled')
        .where('o.shop_id', shopId)
        .modify(qb => {
          if (rangeDays) {
            qb.where('ofs.fulfilled_at', '>=', new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000));
          }
        })
        .orderByRaw(`${sortField} ${sortDir}`)
        .limit(limit)
        .offset(offset)
        .select(
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'o.total_price',
          'o.order_created_at',
          'ofs.fulfilled_at',
          db.raw(`
            ROUND(
              EXTRACT(EPOCH FROM (ofs.fulfilled_at - o.order_created_at)) / 3600.0,
              1
            ) as hours_to_fulfil
          `)
        );

      const [{ count }] = await trx('order_fulfillment_status as ofs')
        .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
        .where('ofs.status', 'fulfilled')
        .where('o.shop_id', shopId)
        .modify(qb => {
          if (rangeDays) {
            qb.where('ofs.fulfilled_at', '>=', new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000));
          }
        })
        .count('* as count');

      return { rows, total: Number(count) };
    });

    return res.status(200).json({ orders: rows, total, page, limit });

  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[FULFILLED_ORDERS_FETCH_FAILED]', { error: message });
    return res.status(500).json({
      error: `Failed to fetch fulfilled orders: ${message}`,
    });
  }
};
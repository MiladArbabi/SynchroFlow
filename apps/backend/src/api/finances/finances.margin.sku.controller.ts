// apps/backend/src/api/finances/finances.margin.sku.controller.ts
//
// GET /api/v1/modules/finances/margin/sku
// ----------------------------------------
// Per-SKU margin breakdown aggregated from order_revenue_units.
//
// Aggregation:
//   revenue    = SUM(line_total)
//   cost       = SUM(estimated_unit_cost * quantity)
//   margin     = revenue - cost
//   margin_pct = margin / revenue * 100
//
// Sorted by gross_margin ascending by default —
// lowest margin SKUs surface first (need attention).

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetSkuMargin = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const sortOrder = req.query.order === 'desc' ? 'desc' : 'asc';

    const rows = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('order_revenue_units as ru')
        .join('orders as o', 'o.lasyncro_order_id', 'ru.lasyncro_order_id')
        .join('variants as v', 'v.lasyncro_variant_id', 'ru.lasyncro_variant_id')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where('o.shop_id', shopId)
        .whereNotNull('ru.lasyncro_variant_id')
        .whereNotIn('p.product_type', ['gift_card', 'digital', 'service']) // exclude non-physical — cost semantics don't apply
        .groupBy('ru.lasyncro_variant_id', 'ru.sku', 'ru.title')
        .select(
          'ru.lasyncro_variant_id',
          'ru.sku',
          'ru.title',
          trx.raw('SUM(ru.quantity) as total_units_sold'),
          trx.raw('ROUND(SUM(ru.line_total), 2) as gross_revenue'),
          trx.raw('ROUND(SUM(ru.estimated_unit_cost * ru.quantity), 2) as estimated_cost'),
          trx.raw('ROUND(SUM(ru.line_total) - SUM(ru.estimated_unit_cost * ru.quantity), 2) as gross_margin'),
          trx.raw(`
            CASE
              WHEN SUM(ru.line_total) > 0
              THEN ROUND(
                (SUM(ru.line_total) - SUM(ru.estimated_unit_cost * ru.quantity))
                / SUM(ru.line_total) * 100, 1
              )
              ELSE 0
            END as margin_pct
          `)
        )
        .orderBy('gross_margin', sortOrder)
        .limit(limit);
    });

    return res.status(200).json({ data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[SKU_MARGIN_FETCH_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch SKU margin: ${message}` });
  }
};
// apps/backend/src/api/finances/finances.margin.trend.controller.ts
//
// GET /api/v1/modules/finances/margin/trend
// ------------------------------------------
// Daily margin trend — avg margin_pct and total gross_margin per day.
// Used for the 30/90-day trend chart in FinancesModuleFT2.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetMarginTrend = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const days = Math.min(90, Math.max(7, parseInt(req.query.days as string) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const rows = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      return trx('order_margin_snapshot as oms')
        .join('orders as o', 'o.lasyncro_order_id', 'oms.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .where('oms.evaluated_at', '>=', since)
        .groupByRaw(`DATE(oms.evaluated_at)`)
        .select(
          trx.raw(`DATE(oms.evaluated_at) as date`),
          trx.raw(`ROUND(AVG(oms.margin_pct) * 100, 1) as avg_margin_pct`),
          trx.raw(`ROUND(SUM(oms.gross_margin), 2) as total_margin`),
          trx.raw(`ROUND(SUM(oms.gross_revenue), 2) as total_revenue`),
          trx.raw(`COUNT(*) as order_count`)
        )
        .orderBy('date', 'asc');
    });

    return res.status(200).json({ data: rows, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[MARGIN_TREND_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch margin trend: ${message}` });
  }
};
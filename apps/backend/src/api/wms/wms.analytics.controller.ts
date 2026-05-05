// apps/backend/src/api/wms/wms.analytics.controller.ts
//
// GET /api/v1/wms/analytics
// -------------------------
// Pick analytics dashboard — Growth tier gate enforced at route level.
//
// Four signal zones:
//   summary   — shop-level accuracy, velocity, throughput
//   operators — per-operator pick rate and accuracy
//   exceptions — error rate ranked by SKU
//   batches   — recent batch scan-to-ship times

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetPickAnalytics = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const days = Math.min(90, Math.max(1, parseInt(req.query.days as string) || 30));

    await db.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [summary, operators, exceptions, batches] = await Promise.all([

      // SHOP-LEVEL SUMMARY
      db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        const [scanStats, exceptionStats] = await Promise.all([
          trx('pick_scan_log')
            .where('shop_id', shopId)
            .where('scanned_at', '>=', since)
            .where('status', 'confirmed')
            .count('scan_id as confirmed_scans')
            .sum('quantity_confirmed as total_units')
            .first(),
          trx('pick_exceptions')
            .where('shop_id', shopId)
            .where('raised_at', '>=', since)
            .count('pick_exception_id as total_exceptions')
            .first(),
        ]);
        const confirmed = Number(scanStats?.confirmed_scans ?? 0);
        const exceptions = Number(exceptionStats?.total_exceptions ?? 0);
        const total = confirmed + exceptions;
        return {
          confirmed_scans: confirmed,
          total_exceptions: exceptions,
          total_units_picked: Number(scanStats?.total_units ?? 0),
          pick_accuracy_pct: total > 0 ? Math.round((confirmed / total) * 1000) / 10 : null,
        };
      }),

      // PER-OPERATOR STATS
      db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        return trx('pick_scan_log as psl')
          .where('psl.shop_id', shopId)
          .where('psl.scanned_at', '>=', since)
          .where('psl.status', 'confirmed')
          .groupBy('psl.scanned_by')
          .select(
            'psl.scanned_by as operator_id',
            trx.raw('COUNT(psl.scan_id) as scans'),
            trx.raw('SUM(psl.quantity_confirmed) as units_picked'),
          )
          .orderBy('units_picked', 'desc')
          .limit(10);
      }),

      // ERROR RATE BY SKU
      db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        return trx('pick_exceptions as pe')
          .leftJoin('variants as v', 'v.lasyncro_variant_id', 'pe.lasyncro_variant_id')
          .where('pe.shop_id', shopId)
          .where('pe.raised_at', '>=', since)
          .groupBy('pe.lasyncro_variant_id', 'v.title', 'v.sku')
          .select(
            'pe.lasyncro_variant_id',
            'v.title',
            'v.sku',
            trx.raw('COUNT(pe.pick_exception_id) as exception_count'),
            trx.raw(`
              ROUND(
                COUNT(pe.pick_exception_id)::numeric /
                NULLIF((
                  SELECT COUNT(*) FROM pick_scan_log psl
                  WHERE psl.lasyncro_variant_id = pe.lasyncro_variant_id
                  AND psl.shop_id = ${shopId}
                  AND psl.scanned_at >= '${since.toISOString()}'
                ), 0) * 100, 1
              ) as error_rate_pct
            `)
          )
          .orderBy('exception_count', 'desc')
          .limit(10);
      }),

      // RECENT BATCH TIMES
      db.transaction(async (trx) => {
        await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);
        return trx('pick_batches')
          .where('shop_id', shopId)
          .where('pick_completed_at', '>=', since)
          .whereNotNull('pick_claimed_at')
          .whereNotNull('pick_completed_at')
          .select(
            'pick_batch_id',
            'total_units',
            'units_picked',
            'pick_claimed_at',
            'pick_completed_at',
            'picked_by',
            trx.raw(`
              EXTRACT(EPOCH FROM (pick_completed_at - pick_claimed_at))::int
              as pick_duration_seconds
            `)
          )
          .orderBy('pick_completed_at', 'desc')
          .limit(20);
      }),
    ]);

    return res.status(200).json({ summary, operators, exceptions, batches, days });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PICK_ANALYTICS_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch pick analytics: ${message}` });
  }
};
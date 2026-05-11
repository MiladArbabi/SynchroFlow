// apps/backend/src/api/returns/returns.correlation.controller.ts
//
// GET /api/v1/modules/returns/correlation
// ----------------------------------------
// Supplier batch correlation — joins return events back to
// the receive job (batch) that supplied the returned variant.
//
// Signal: return rate grouped by (variant × supplier × receive_job)
//
// High return rate on a specific receive_job → bad batch from supplier.
// High return rate across all batches → product design issue.
//
// Only available when merchant uses WMS receive flow.
// Falls back to supplier-level correlation without batch granularity
// if no receive jobs exist for the returned variants.

import { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

export const httpGetReturnsCorrelation = async (req: Request, res: Response) => {
  try {
    const shopId = req.user?.shopId;
    if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

    const rows = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      /**
       * CORRELATION QUERY
       * -----------------
       * Join returns → revenue units → receive job lines → receive jobs
       * → purchase orders → suppliers.
       *
       * Aggregates per (variant, supplier, receive_job):
       * - total units sold from that batch
       * - total units returned from that batch
       * - return rate = returned / sold * 100
       */
      return trx('refund_execution_line_items as rel')
        .join('refund_executions as re', 're.lasyncro_refund_execution_id', 'rel.lasyncro_refund_execution_id')
        .join('order_revenue_units as oru', 'oru.lasyncro_revenue_unit_id', 'rel.lasyncro_revenue_unit_id')
        .join('orders as o', 'o.lasyncro_order_id', 're.lasyncro_order_id')
        .leftJoin('receive_job_lines as rjl', 'rjl.lasyncro_variant_id', 'oru.lasyncro_variant_id')
        .leftJoin('receive_jobs as rj', function() {
          this.on('rj.receive_job_id', '=', 'rjl.receive_job_id')
              .andOn('rj.shop_id', '=', trx.raw('?', [shopId]));
        })
        .leftJoin('purchase_orders as po', 'po.id', 'rj.po_id')
        .leftJoin('suppliers as s', function() {
          this.on('s.id', '=', 'po.supplier_id')
              .andOn('s.shop_id', '=', trx.raw('?', [shopId]));
        })
        .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oru.lasyncro_variant_id')
        .where('o.shop_id', shopId)
        .groupBy(
          'oru.lasyncro_variant_id', 'v.title', 'v.sku',
          'rj.receive_job_id', 'rj.closed_at',
          's.id', 's.name'
        )
        .select(
          'oru.lasyncro_variant_id',
          'v.title as variant_title',
          'v.sku',
          'rj.receive_job_id',
          'rj.closed_at as batch_received_at',
          's.id as supplier_id',
          's.name as supplier_name',
          trx.raw('SUM(rel.refunded_quantity) as units_returned'),
          /**
           * BATCH DENOMINATOR (A-013 FIX)
           * ------------------------------
           * Use quantity_accepted from the receive job line — units physically
           * received and accepted into inventory for this batch.
           *
           * Previous approach (SUM(oru.quantity)) used all units ever sold of
           * this variant across all batches, making per-batch return rates
           * meaningless — a faulty batch would appear healthy because its
           * returns were divided by the entire variant's sales history.
           *
           * PHASE 2: replace with lot-scoped sales count once lot tracking
           * (A-014) is implemented — that will give exact sold-from-this-batch counts.
           */
          trx.raw('COALESCE(MAX(rjl.quantity_accepted), 0) as units_received'),
          trx.raw(`
            CASE WHEN COALESCE(MAX(rjl.quantity_accepted), 0) > 0
            THEN ROUND(SUM(rel.refunded_quantity)::numeric / MAX(rjl.quantity_accepted) * 100, 1)
            ELSE NULL END as return_rate_pct
          `),
          trx.raw('SUM(rel.refunded_amount) as revenue_lost'),
        )
        .orderBy('return_rate_pct', 'desc')
        .limit(50);
    });

    return res.status(200).json({ data: rows });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[RETURNS_CORRELATION_FAILED]', { error: message });
    return res.status(500).json({ error: `Failed to fetch returns correlation: ${message}` });
  }
};
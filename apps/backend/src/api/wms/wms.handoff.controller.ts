import type { Request, Response } from 'express';
import db from '@lasyncro/backend-core/db.js';

/**
 * GET /api/v1/wms/outbound/handoff-queue
 *
 * Packed orders remain here until a carrier webhook or manual handoff
 * converts warehouse truth from packed to shipped.
 */
export async function httpGetPackedHandoffQueue(req: Request, res: Response) {
  const shopId = req.user?.shopId;
  if (!shopId) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const orders = await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

      const latestTracking = trx('order_shipment_tracking')
        .distinctOn('lasyncro_order_id')
        .orderBy('lasyncro_order_id')
        .orderBy('created_at', 'desc')
        .select(
          'lasyncro_order_id',
          'carrier_code',
          'tracking_number',
          'latest_status'
        )
        .as('ost');

      const rows = await trx('order_warehouse_status as ows')
        .join('orders as o', 'o.lasyncro_order_id', 'ows.lasyncro_order_id')
        .leftJoin(
          'external_order_identity_map as eim',
          'eim.lasyncro_order_id',
          'o.lasyncro_order_id'
        )
        .leftJoin(latestTracking, 'ost.lasyncro_order_id', 'o.lasyncro_order_id')
        .where('o.shop_id', shopId)
        .where('ows.status', 'packed')
        .orderBy('ows.packed_at', 'asc')
        .select(
          'o.lasyncro_order_id',
          'eim.external_order_id',
          'ows.pick_batch_id',
          'ows.packed_at',
          'o.total_price',
          'o.currency',
          'ost.carrier_code',
          'ost.tracking_number',
          'ost.latest_status'
        );

      return rows;
    });

    return res.status(200).json({ orders, total: orders.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[WMS_HANDOFF_QUEUE_FETCH_FAILED]', { shopId, error: message });
    return res.status(500).json({ error: 'Failed to fetch carrier handoff queue' });
  }
}
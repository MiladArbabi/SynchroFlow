// apps/backend/src/services/wms/carrierStallDetection.service.ts
//
// WM-40 — Carrier stall detection.
// Two distinct triggers write the same is_stalled flag:
//   1. Immediate — sendcloud.tracking.handler.ts sets it on a carrier
//      'exception' event and raises the alert directly (real-time).
//   2. Silent — this service catches shipments that simply stop
//      reporting (no exception, no further scans) past a fixed
//      threshold. Carriers never proactively flag this; only a sweep
//      can catch it.
// Both paths write to the same alert_key so the UI shows one signal
// regardless of which trigger fired, and the webhook handler clears
// the alert on any subsequent non-exception event (shipment resumed).

import db, { systemQuery, withTenant } from '@lasyncro/backend-core/db.js';

export async function runCarrierStallDetectionCycle(): Promise<void> {
  const locatorResult = await systemQuery(
    db.raw('SELECT * FROM public.list_stalled_shipment_tenants()')
  );
  const rows: Array<{
    id: string;
    shop_id: number;
    lasyncro_order_id: string;
    tracking_number: string | null;
    carrier_code: string;
    latest_event_at: string;
  }> = [];

  for (const locator of locatorResult.rows as Array<{
    id: string;
    shop_id: number;
  }>) {
    const row = await withTenant(locator.shop_id, (trx) =>
      trx('order_shipment_tracking')
        .where({ id: locator.id, shop_id: locator.shop_id })
        .select(
          'id',
          'shop_id',
          'lasyncro_order_id',
          'tracking_number',
          'carrier_code',
          'latest_event_at'
        )
        .first()
    );
    if (row) rows.push(row);
  }

  if (rows.length === 0) {
    console.info('[CARRIER_STALL_DETECTION_OK]', { newly_stalled: 0 });
    return;
  }

  for (const row of rows) {
    try {
      await flagShipmentStalled(row);
    } catch (error) {
      console.error('[CARRIER_STALL_DETECTION_ROW_FAILED]', {
        shipmentTrackingId: row.id,
        error: error instanceof Error ? error.message : error,
      });
    }
  }

  console.warn('[CARRIER_STALL_DETECTION_FLAGGED]', { newly_stalled: rows.length });
}

async function flagShipmentStalled(row: {
  id: string;
  shop_id: number;
  lasyncro_order_id: string;
  tracking_number: string | null;
  carrier_code: string;
  latest_event_at: string;
}): Promise<void> {
  const idleHours = Math.round((Date.now() - new Date(row.latest_event_at).getTime()) / 3_600_000);

  await withTenant(row.shop_id, async (trx) => {
    await trx('order_shipment_tracking').where({ id: row.id }).update({ is_stalled: true });

    await trx('alerts')
      .insert({
        shop_id: row.shop_id,
        alert_key: `carrier_webhook:${row.id}:carrier_stalled`,
        source: 'carrier_webhook',
        alert_type: 'carrier_stalled',
        severity: 'critical',
        title: 'Shipment stalled',
        message: `Tracking ${row.tracking_number ?? row.id} (${row.carrier_code}) has had no carrier update in ${idleHours}h.`,
        entity_id: row.lasyncro_order_id,
        entity_type: 'order',
        category: 'revenue_at_risk',
        audience: 'all',
        is_active: true,
      })
      .onConflict(['shop_id', 'alert_key'])
      .merge(['is_active', 'message', 'severity', 'updated_at']);
  });

  console.warn('[CARRIER_STALL_FLAGGED]', {
    shopId: row.shop_id,
    shipmentTrackingId: row.id,
    trackingNumber: row.tracking_number,
    idleHours,
  });
}

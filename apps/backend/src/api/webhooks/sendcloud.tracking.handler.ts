// WM-40 — Sendcloud parcel status ingestion handler.
// Registered with WebhookRouter on import (side effect), matching the
// shopify.webhook.js self-registration pattern.
import db from '@lasyncro/backend-core/db.js';
import { WebhookRouter } from './webhookRouter.js';
import { WebhookEnvelope } from './types.js';

const STALL_THRESHOLD_DAYS = 3;

WebhookRouter.register({
  integration: 'sendcloud',
  eventType: 'parcel_status_changed',
  handle: async (envelope: WebhookEnvelope) => {
    const shopId = envelope.shopId;
    if (!shopId) throw new Error('[SENDCLOUD_TRACKING_MISSING_SHOP_ID]');

    await db.raw(`SET app.current_tenant = '${shopId}'`);

    const payload = envelope.rawPayload as any;
    const parcel = payload.parcel;
    const trackingNumber: string | undefined = parcel?.tracking_number;
    const rawStatus: string = parcel?.status?.message ?? String(parcel?.status?.id ?? '');
    const eventTimestamp = new Date(); // Sendcloud does not include a per-event timestamp; use receipt time
    const location: string | null = parcel?.status?.location ?? null;

    if (!trackingNumber) {
      console.warn('[SENDCLOUD_TRACKING_NO_TRACKING_NUMBER]', { shopId, parcelId: parcel?.id });
      return;
    }

    const shipment = await db('order_shipment_tracking')
      .where({ shop_id: shopId, tracking_number: trackingNumber })
      .first();

    if (!shipment) {
      console.warn('[SENDCLOUD_TRACKING_NO_MATCHING_SHIPMENT]', { shopId, trackingNumber });
      return;
    }

    const statusMap = await db('carrier_status_map')
      .where({ carrier_code: 'sendcloud', raw_status: rawStatus })
      .first();

    const eventType = statusMap?.event_type ?? 'in_transit'; // unmapped codes default to in_transit rather than dropping the event

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);

      // Idempotent insert — unique on (shipment_tracking_id, event_type, event_timestamp)
      await trx('parcel_tracking_events')
        .insert({
          shop_id: shopId,
          lasyncro_order_id: shipment.lasyncro_order_id,
          shipment_tracking_id: shipment.id,
          carrier_code: 'sendcloud',
          event_type: eventType,
          raw_status: rawStatus,
          event_timestamp: eventTimestamp,
          location,
          raw_payload: payload,
        })
        .onConflict(['shipment_tracking_id', 'event_type', 'event_timestamp'])
        .ignore();

      const isStalled = eventType === 'exception';

      await trx('order_shipment_tracking')
        .where({ id: shipment.id })
        .update({
          latest_status: eventType,
          latest_location: location,
          latest_event_at: eventTimestamp,
          is_stalled: isStalled,
        });

      if (eventType === 'returned') {
        // Return signal — alerts table is source-agnostic by design (source |
        // alert_type | category taxonomy already covers WMS/constraint/decision
        // signals). Using source: 'carrier_webhook', alert_type: 'carrier_return'
        // — both new values, but the column is free-text (no DB enum), consistent
        // with how alert_type values like 'sla_breach' were introduced originally.
        // category: 'supplier_inbound' is the closest existing taxonomy bucket
        // (the return is inbound-adjacent even though no PO exists behind it yet
        // — see note above on receive_jobs' po_id NOT NULL constraint).
        await trx('alerts')
            .insert({
                shop_id: shopId,
                alert_key: `carrier_webhook:${shipment.id}:carrier_return`,
                source: 'carrier_webhook',
                alert_type: 'carrier_return',
                severity: 'warning',
                title: 'Carrier reported a return',
                message: `Order tracking ${trackingNumber} was reported as returned by the carrier.`,
                entity_id: shipment.lasyncro_order_id,
                entity_type: 'order',
                category: 'supplier_inbound',
                audience: 'all',
                is_active: true,
            })
            .onConflict(['shop_id', 'alert_key'])
            .merge({ is_active: true, resolved_at: null, updated_at: new Date() });
        }
    });

    console.log('[SENDCLOUD_TRACKING_EVENT_INGESTED]', {
      shopId,
      trackingNumber,
      eventType,
      shipmentTrackingId: shipment.id,
    });
  },
});
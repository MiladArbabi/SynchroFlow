import db from '@lasyncro/backend-core/db.js';
import { WebhookRouter } from './webhookRouter.js';
import { WebhookEnvelope } from './types.js';

WebhookRouter.register({
  integration: 'shippo',
  eventType: 'track_updated',
  handle: async (envelope: WebhookEnvelope) => {
    const shopId = envelope.shopId;
    if (!shopId) throw new Error('[SHIPPO_TRACKING_MISSING_SHOP_ID]');

    await db.raw(`SET app.current_tenant = '${shopId}'`);

    const payload = envelope.rawPayload as any;
    const data = payload.data;
    const trackingNumber: string | undefined = data?.tracking_number;
    const rawStatus: string = data?.tracking_status?.status ?? 'UNKNOWN';
    const location: string | null = data?.tracking_status?.location
      ? [data.tracking_status.location.city, data.tracking_status.location.state, data.tracking_status.location.country]
          .filter(Boolean).join(', ') || null
      : null;
    const eventTimestamp = data?.tracking_status?.status_date
      ? new Date(data.tracking_status.status_date)
      : new Date();

    if (!trackingNumber) {
      console.warn('[SHIPPO_TRACKING_NO_TRACKING_NUMBER]', { shopId });
      return;
    }

    const shipment = await db('order_shipment_tracking')
      .where({ shop_id: shopId, tracking_number: trackingNumber })
      .first();

    if (!shipment) {
      console.warn('[SHIPPO_TRACKING_NO_MATCHING_SHIPMENT]', { shopId, trackingNumber });
      return;
    }

    const statusMap = await db('carrier_status_map')
      .where({ carrier_code: 'shippo', raw_status: rawStatus })
      .first();

    const eventType = statusMap?.event_type ?? 'in_transit';

    await db.transaction(async (trx) => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);

      await trx('parcel_tracking_events')
        .insert({
          shop_id: shopId,
          lasyncro_order_id: shipment.lasyncro_order_id,
          shipment_tracking_id: shipment.id,
          carrier_code: 'shippo',
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

      if (eventType === 'exception') {
        await trx('alerts')
          .insert({
            shop_id: shopId,
            alert_key: `carrier_webhook:${shipment.id}:carrier_stalled`,
            source: 'carrier_webhook',
            alert_type: 'carrier_stalled',
            severity: 'critical',
            title: 'Shipment stalled',
            message: `Carrier reported an exception (${rawStatus}) for tracking ${trackingNumber}.`,
            entity_id: shipment.lasyncro_order_id,
            entity_type: 'order',
            category: 'revenue_at_risk',
            audience: 'all',
            is_active: true,
          })
          .onConflict(['shop_id', 'alert_key'])
          .merge(['is_active', 'message', 'severity', 'updated_at']);
      } else if (shipment.is_stalled) {
        await trx('alerts')
          .where({ shop_id: shopId, alert_key: `carrier_webhook:${shipment.id}:carrier_stalled` })
          .update({ is_active: false, resolved_at: new Date(), updated_at: new Date() });
      }

      if (eventType === 'returned') {
        // RET-AUD-08 fix (2026-07-04): surface carrier_status_map's
        // fault_category (0123_carrier_status_fault_category) in the
        // alert message instead of a fixed generic string. No `metadata`
        // column exists on `alerts` (confirmed via schema check before
        // this edit) — the fault signal is carried in `message` text
        // only, not stored structured, until/unless a future task adds
        // one. Per 0123's documented limit, faultCategory is almost
        // always 'unknown' today — raw carrier status strings don't
        // encode true cause at this API tier — but saying so explicitly
        // is still more honest than the previous message, which implied
        // nothing either way.
        const faultCategory = statusMap?.fault_category ?? 'unknown';
        const faultLabel =
          faultCategory === 'carrier_fault'
            ? 'likely carrier mishandling'
            : faultCategory === 'customer_fault'
            ? 'likely customer-side cause'
            : 'cause unknown from carrier data';

        const returnMessage = `Order tracking ${trackingNumber} was reported as returned by the carrier (${faultLabel}).`;

        await trx('alerts')
          .insert({
            shop_id: shopId,
            alert_key: `carrier_webhook:${shipment.id}:carrier_return`,
            source: 'carrier_webhook',
            alert_type: 'carrier_return',
            severity: 'warning',
            title: 'Carrier reported a return',
            message: returnMessage,
            entity_id: shipment.lasyncro_order_id,
            entity_type: 'order',
            category: 'supplier_inbound',
            audience: 'all',
            is_active: true,
          })
          .onConflict(['shop_id', 'alert_key'])
          .merge({
            is_active: true,
            resolved_at: null,
            updated_at: new Date(),
            message: returnMessage,
          });
        }
    });

    console.log('[SHIPPO_TRACKING_EVENT_INGESTED]', { shopId, trackingNumber, eventType, shipmentTrackingId: shipment.id });
  },
});
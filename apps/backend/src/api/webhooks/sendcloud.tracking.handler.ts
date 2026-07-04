// WM-40 — Sendcloud parcel status ingestion handler.
// Registered with WebhookRouter on import (side effect), matching the
// shopify.webhook.js self-registration pattern.
import db from '@lasyncro/backend-core/db.js';
import { WebhookRouter } from './webhookRouter.js';
import { WebhookEnvelope } from './types.js';
import { createReturnJobFromCarrierEvent } from '../../services/returns/returnJobs.service.js';

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
      // .returning('id') added (RET-AUD service-layer task, 2026-07-04):
      // needed to pass this specific event's id as
      // triggering_parcel_tracking_event_id when a 'returned' event
      // creates a return_jobs row (see below). On the .ignore() conflict
      // path (a genuine duplicate delivery) this returns [] — handled
      // below by falling back to a lookup rather than assuming a row.
      const [insertedEvent] = await trx('parcel_tracking_events')
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
        .ignore()
        .returning('id');

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
        // Immediate stall signal — same alert_key the sweep job would use,
        // so the UI shows one consistent signal regardless of which trigger fired.
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
        // Shipment resumed reporting (or moved past the exception) — clear
        // whichever trigger raised the alert (immediate exception or sweep-
        // detected silence, indistinguishable here and don't need to be).
        await trx('alerts')
          .where({ shop_id: shopId, alert_key: `carrier_webhook:${shipment.id}:carrier_stalled` })
          .update({ is_active: false, resolved_at: new Date(), updated_at:new Date() });
      }

      if (eventType === 'returned') {
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

        // RET-AUD service-layer task (2026-07-04): the alert alone was
        // the only signal before today — nothing turned an RTS event
        // into an actual return_jobs row. This closes that gap.
        // insertedEvent may be [] on the .ignore() duplicate-delivery
        // path (see insert comment above) — fall back to a lookup by
        // the natural unique key rather than assuming a fresh row.
        let triggeringEventId = insertedEvent?.id;
        if (!triggeringEventId) {
          const existingEvent = await trx('parcel_tracking_events')
            .where({ shipment_tracking_id: shipment.id, event_type: eventType, event_timestamp: eventTimestamp })
            .select('id')
            .first();
          triggeringEventId = existingEvent?.id;
        }

        if (triggeringEventId) {
          await createReturnJobFromCarrierEvent(
            {
              shopId,
              lasyncroOrderId: shipment.lasyncro_order_id,
              triggeringParcelTrackingEventId: triggeringEventId,
            },
            trx
          );
        } else {
          // Should not happen — the unique key above matches the
          // insert's own conflict target exactly. Logged, not thrown:
          // the alert above already fired, and a missing job here
          // still leaves the alert as a fallback signal for the owner.
          console.error('[SENDCLOUD_RETURN_JOB_SKIPPED_NO_EVENT_ID]', {
            shopId,
            shipmentId: shipment.id,
            trackingNumber,
          });
        }
      }

      console.log('[SENDCLOUD_TRACKING_EVENT_INGESTED]', {
        shopId,
        trackingNumber,
        eventType,
        shipmentTrackingId: shipment.id,
      });
    },
  )}
});
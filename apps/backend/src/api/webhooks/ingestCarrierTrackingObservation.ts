// apps/backend/src/api/webhooks/ingestCarrierTrackingObservation.ts
//
// #1114 STEP 3 — Shared carrier tracking ingestion boundary.
// -------------------------------------------------------------------------
// Extracted from shippo.tracking.handler.ts and sendcloud.tracking.handler.ts,
// which independently re-implemented the exact same post-payload-extraction
// sequence (shipment lookup, carrier_status_map lookup, evidence insertion,
// projection guard, handoff confirmation, stall/unknown/return alerts,
// Return Job creation). Both webhook handlers are now thin adapters that
// parse their own provider payload into a provider-neutral observation and
// call this function; carrierTrackingNormalization.ts remains pure (no DB),
// and this module is its sole DB-bound caller alongside the two handlers.
//
// CRITICAL IDENTITY SEPARATION (#1114 ratified):
//   businessCarrierCode — persisted business identity
//     (parcel_tracking_events.carrier_code, and by extension every
//     downstream artifact that traces back to it — alerts.source and
//     return_jobs.source stay the existing fixed 'carrier_webhook' literal,
//     unrelated to this value, per the #1114 workshop's provenance ruling).
//   statusNamespace — carrier_status_map lookup key ONLY.
// These are independent on purpose: today both webhook paths use the same
// value for both (Shippo: 'shippo'/'shippo'; Sendcloud: 'sendcloud'/
// 'sendcloud'), but future Sendcloud v3 reconciliation will look up
// 'sendcloud_v3' while still persisting business identity as 'sendcloud' —
// 'sendcloud_v3' must never leak into a business-facing carrier/source
// value. Collapsing these two into one parameter would make that leak a
// single accidental line away.
//
// Runs entirely on the caller-provided transaction (the router's
// tenant-scoped trx for webhooks) — never opens a second transaction.

import type { Knex } from 'knex';
import { confirmShipmentFromCarrierHandoff } from '../../services/wms/shipConfirmation.service.js';
import { createReturnJobFromCarrierEvent } from '../../services/returns/returnJobs.service.js';
import {
  CARRIER_HANDOFF_EVENTS,
  resolveCanonicalEventType,
  shouldUpdateShipmentTruth,
  toAuditEventType,
  toProjectionStatus,
  type CanonicalEventType,
} from './carrierTrackingNormalization.js';

export interface CarrierTrackingObservation {
  shopId: number;
  /** Persisted business identity — see module header. */
  businessCarrierCode: string;
  /** carrier_status_map lookup key ONLY — see module header. */
  statusNamespace: string;
  trackingNumber: string;
  rawStatus: string;
  eventTimestamp: Date;
  location: string | null;
  rawPayload: unknown;
}

export interface CarrierTrackingIngestionResult {
  /** false when no order_shipment_tracking row matched (shop_id, tracking_number). */
  matched: boolean;
  shipmentTrackingId: string | null;
  mappedEventType: CanonicalEventType | null;
}

export async function ingestCarrierTrackingObservation(
  trx: Knex.Transaction,
  observation: CarrierTrackingObservation
): Promise<CarrierTrackingIngestionResult> {
  const {
    shopId,
    businessCarrierCode,
    statusNamespace,
    trackingNumber,
    rawStatus,
    eventTimestamp,
    location,
    rawPayload,
  } = observation;

  const shipment = await trx('order_shipment_tracking')
    .where({ shop_id: shopId, tracking_number: trackingNumber })
    .first();

  if (!shipment) {
    console.warn('[CARRIER_TRACKING_NO_MATCHING_SHIPMENT]', { shopId, businessCarrierCode, trackingNumber });
    return { matched: false, shipmentTrackingId: null, mappedEventType: null };
  }

  const statusMap = await trx('carrier_status_map')
    .where({ carrier_code: statusNamespace, raw_status: rawStatus })
    .first();

  // DR-02 (#1114): null means genuinely unmapped/unknown — never coerced
  // to 'in_transit' or 'exception' outside of toAuditEventType's single,
  // documented, schema-constrained exception (see that function's comment).
  const mappedEventType = resolveCanonicalEventType(statusMap);
  const auditEventType = toAuditEventType(mappedEventType);
  const projectionStatus = toProjectionStatus(mappedEventType);

  // Idempotent insert — unique on (shipment_tracking_id, event_type, event_timestamp).
  // .returning('id') needed for the returned-event Return Job path below.
  // On the .ignore() conflict path (a genuine duplicate delivery) this
  // returns [] — handled below by falling back to a lookup rather than
  // assuming a fresh row.
  const [insertedEvent] = await trx('parcel_tracking_events')
    .insert({
      shop_id: shopId,
      lasyncro_order_id: shipment.lasyncro_order_id,
      shipment_tracking_id: shipment.id,
      carrier_code: businessCarrierCode,
      event_type: auditEventType,
      raw_status: rawStatus,
      event_timestamp: eventTimestamp,
      location,
      raw_payload: rawPayload,
    })
    .onConflict(['shipment_tracking_id', 'event_type', 'event_timestamp'])
    .ignore()
    .returning('id');

  // DR-02 invariants 5 & 6: a terminal canonical state (delivered/returned)
  // must never regress, and a non-terminal state must never move backward
  // in time because a stale/out-of-order event arrived late. This gates
  // ONLY the order_shipment_tracking current-state projection (and every
  // projection-dependent effect below it) — the raw event above was
  // already persisted unconditionally.
  const applyProjection = shouldUpdateShipmentTruth(
    { latestStatus: shipment.latest_status, latestEventAt: shipment.latest_event_at },
    { mappedEventType, eventTimestamp }
  );

  if (applyProjection) {
    const isStalled = mappedEventType === 'exception';

    await trx('order_shipment_tracking')
      .where({ id: shipment.id })
      .update({
        latest_status: projectionStatus,
        latest_location: location,
        latest_event_at: eventTimestamp,
        is_stalled: isStalled,
      });

    // Only explicitly mapped physical-movement statuses prove carrier handoff.
    if (mappedEventType && CARRIER_HANDOFF_EVENTS.has(mappedEventType)) {
      await confirmShipmentFromCarrierHandoff(trx, {
        lasyncroOrderId: shipment.lasyncro_order_id,
        shopId,
        partialShipment: false,
        shippedAt: eventTimestamp,
      });
    }

    if (mappedEventType === 'exception') {
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

    if (mappedEventType === null) {
      // DR-02 (#1114): honest "reason unclear" surface for a raw status
      // carrier_status_map has no row for — never silently treated as
      // healthy in_transit, never fabricated into a specific exception
      // cause. alerts.alert_type is an unconstrained varchar so this needs
      // no schema change.
      await trx('alerts')
        .insert({
          shop_id: shopId,
          alert_key: `carrier_webhook:${shipment.id}:carrier_unknown_status`,
          source: 'carrier_webhook',
          alert_type: 'carrier_unknown_status',
          severity: 'warning',
          title: 'Delivery problem — reason unclear',
          message: `Carrier reported an unmapped status (${rawStatus}) for tracking ${trackingNumber}. Cause unknown from carrier data.`,
          entity_id: shipment.lasyncro_order_id,
          entity_type: 'order',
          category: 'revenue_at_risk',
          audience: 'all',
          is_active: true,
        })
        .onConflict(['shop_id', 'alert_key'])
        .merge(['is_active', 'message', 'updated_at']);
    }
  } else {
    console.warn('[CARRIER_TRACKING_PROJECTION_SKIPPED_STALE_OR_TERMINAL]', {
      shopId,
      businessCarrierCode,
      trackingNumber,
      shipmentTrackingId: shipment.id,
      currentLatestStatus: shipment.latest_status,
      incomingMappedEventType: mappedEventType,
    });
  }

  // #1114: a mapped 'returned' event creates the carrier_return alert and
  // the Return Job UNCONDITIONALLY — this branch must never move inside
  // `if (applyProjection)` above. A package can genuinely be reported
  // returned after the projection already reflects a later/terminal state
  // (e.g. an out-of-order 'returned' event arriving after 'delivered' with
  // an older timestamp): the projection correctly stays put, but the raw
  // evidence, the alert, and the Return Job must still exist — the
  // recovery workflow does not depend on winning the projection race.
  if (mappedEventType === 'returned') {
    // RET-AUD-08 fix (2026-07-04): surface carrier_status_map's
    // fault_category in the alert message instead of a fixed generic
    // string. No `metadata` column exists on `alerts` — the fault signal
    // is carried in `message` text only. Per that fix's documented limit,
    // faultCategory is almost always 'unknown' today — raw carrier status
    // strings don't encode true cause at this API tier.
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

    // RET-AUD service-layer task (2026-07-04): closes the "an RTS event
    // produced only an alert, no return_jobs row" gap. Reuses the existing
    // Returns service — no second implementation. insertedEvent may be []
    // on the .ignore() duplicate-delivery path — fall back to a lookup by
    // the natural unique key rather than assuming a fresh row.
    let triggeringEventId: string | undefined = insertedEvent?.id;
    if (!triggeringEventId) {
      const existingEvent = await trx('parcel_tracking_events')
        .where({ shipment_tracking_id: shipment.id, event_type: auditEventType, event_timestamp: eventTimestamp })
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
      // Should not happen — the unique key above matches the insert's own
      // conflict target exactly. Logged, not thrown: the alert above
      // already fired, and a missing job here still leaves the alert as a
      // fallback signal for the owner.
      console.error('[CARRIER_TRACKING_RETURN_JOB_SKIPPED_NO_EVENT_ID]', {
        shopId,
        businessCarrierCode,
        shipmentId: shipment.id,
        trackingNumber,
      });
    }
  }

  console.log('[CARRIER_TRACKING_EVENT_INGESTED]', {
    shopId,
    businessCarrierCode,
    trackingNumber,
    mappedEventType,
    shipmentTrackingId: shipment.id,
  });

  return { matched: true, shipmentTrackingId: shipment.id, mappedEventType };
}

// ISS-RLS3: previously used a bare, non-transactional
// db.raw('SET app.current_tenant = ...') before two bare db() reads,
// then opened a SEPARATE correctly-scoped db.transaction() for writes
// — same anti-pattern as ISS-SEC1/RLS2. Now uses the router's
// tenant-scoped trx throughout; no inner transaction needed.
//
// #1114 STEP 3: this handler is now a thin adapter — parse the Shippo
// payload into a provider-neutral observation, then delegate every
// carrier-truth behavior (shipment lookup, normalization, evidence,
// projection, alerts, Return Job creation) to the shared
// ingestCarrierTrackingObservation seam. See that module for the full
// behavior contract.
import type { Knex } from 'knex';
import { WebhookRouter } from './webhookRouter.js';
import { WebhookEnvelope } from './types.js';
import { ingestCarrierTrackingObservation } from './ingestCarrierTrackingObservation.js';

WebhookRouter.register({
  integration: 'shippo',
  eventType: 'track_updated',
  handle: async (envelope: WebhookEnvelope, trx: Knex.Transaction) => {
    const shopId = envelope.shopId;
    if (!shopId) throw new Error('[SHIPPO_TRACKING_MISSING_SHOP_ID]');

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

    // Business identity and status-map lookup namespace are both 'shippo'
    // for the webhook path today — see ingestCarrierTrackingObservation.ts's
    // header for why these are kept as independent parameters regardless.
    await ingestCarrierTrackingObservation(trx, {
      shopId,
      businessCarrierCode: 'shippo',
      statusNamespace: 'shippo',
      trackingNumber,
      rawStatus,
      eventTimestamp,
      location,
      rawPayload: payload,
    });
  },
});

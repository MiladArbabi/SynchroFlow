// WM-40 — Sendcloud parcel status ingestion handler.
// Registered with WebhookRouter on import (side effect), matching the
// shopify.webhook.js self-registration pattern.
//
// ISS-RLS3: previously used a bare, non-transactional
// db.raw('SET app.current_tenant = ...') before two bare db() reads,
// then opened a SEPARATE correctly-scoped db.transaction() for writes
// — same anti-pattern as ISS-SEC1/RLS2. Now uses the router's
// tenant-scoped trx throughout; no inner transaction needed.
//
// #1114 STEP 3: this handler is now a thin adapter — parse the Sendcloud
// payload into a provider-neutral observation, then delegate every
// carrier-truth behavior (shipment lookup, normalization, evidence,
// projection, alerts, Return Job creation) to the shared
// ingestCarrierTrackingObservation seam. See that module for the full
// behavior contract.
import type { Knex } from 'knex';
import { WebhookRouter } from './webhookRouter.js';
import { WebhookEnvelope } from './types.js';
import { ingestCarrierTrackingObservation } from './ingestCarrierTrackingObservation.js';

const STALL_THRESHOLD_DAYS = 3; // eslint-disable-line @typescript-eslint/no-unused-vars -- pre-existing, unrelated to DR-02; preserved not to widen this slice's diff (DR-01 audit flagged it as dead code, but removing it is out of DR-02 scope)

WebhookRouter.register({
  integration: 'sendcloud',
  eventType: 'parcel_status_changed',
  handle: async (envelope: WebhookEnvelope, trx: Knex.Transaction) => {
    const shopId = envelope.shopId;
    if (!shopId) throw new Error('[SENDCLOUD_TRACKING_MISSING_SHOP_ID]');

    const payload = envelope.rawPayload as any;
    const parcel = payload.parcel;
    const trackingNumber: string | undefined = parcel?.tracking_number;
    const rawStatus: string = parcel?.status?.message ?? String(parcel?.status?.id ?? '');
    // DR-02-CORRECTION-B (#1114): Sendcloud's webhook payload carries no
    // per-event timestamp (confirmed absent during the DR-01 audit) — a
    // prior 5-minute same-raw-status dedup heuristic built around this gap
    // was removed as unsafe (two legitimate events can share a raw_status
    // within 5 minutes). Receipt time is used honestly here; it is NOT
    // fabricated as a substitute for a real provider event timestamp
    // reconciliation will supply (Sendcloud v3 `event_at`).
    const eventTimestamp = new Date();
    const location: string | null = parcel?.status?.location ?? null;

    if (!trackingNumber) {
      console.warn('[SENDCLOUD_TRACKING_NO_TRACKING_NUMBER]', { shopId, parcelId: parcel?.id });
      return;
    }

    // Business identity and status-map lookup namespace are both
    // 'sendcloud' for the webhook path today — see
    // ingestCarrierTrackingObservation.ts's header for why these are kept
    // as independent parameters regardless (future Sendcloud v3
    // reconciliation will look up 'sendcloud_v3' while still persisting
    // business identity as 'sendcloud').
    await ingestCarrierTrackingObservation(trx, {
      shopId,
      businessCarrierCode: 'sendcloud',
      statusNamespace: 'sendcloud',
      trackingNumber,
      rawStatus,
      eventTimestamp,
      location,
      rawPayload: payload,
    });
  },
});

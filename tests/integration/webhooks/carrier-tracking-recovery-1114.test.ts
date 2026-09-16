// tests/integration/webhooks/carrier-tracking-recovery-1114.test.ts
//
// DR-02 (#1114) — Carrier Truth Foundation
// -----------------------------------------
// Real-Postgres regression contract for the permanent invariants listed in
// the DR-02 brief. Exercises the actual registered webhook handlers via
// WebhookRouter.dispatch (not direct handler invocation) so router-level
// idempotency (the content-hash ledger) is genuinely in the loop.
//
// Covers:
//  1. Shippo/Sendcloud returned-event parity (invariant 1)
//  2. Duplicate returned event does not duplicate return_jobs or the
//     returned_undelivered guard (invariants 8, 9)
//  3. Exact duplicate webhook does not duplicate parcel_tracking_events
//     (invariant 7, enforced by the router's content-hash ledger)
//  4. Unmapped raw status never silently becomes in_transit and never
//     fabricates a cause (invariants 3, 4; raw evidence preserved — invariant 2)
//  5. Explicit delivered/returned transition rules (invariants 5, 6) —
//     DR-02-CORRECTION-C replaced blanket terminal locking with these
//  6. Normal forward-progressing mapped sequence is unchanged (invariant 11)
//  7. Tenant isolation (invariant 12)
//
// DR-02-CORRECTION-A: the "unmapped raw status" case below now also asserts
// parcel_tracking_events.event_type = 'unknown' (migration 0176), not just
// the order_shipment_tracking projection.
//
// DR-02-CORRECTION-B: the 5-minute Sendcloud same-raw-status dedup heuristic
// was removed as unsafe (it could suppress two legitimate distinct events).
// A dedicated test below proves two non-identical Sendcloud deliveries
// sharing a raw_status are BOTH persisted, and the byte-identical-replay
// test (content-hash ledger) proves true duplicates are still deduped.
//
// Invariant 10 (existing returned_undelivered Order Pool guard) is already
// covered by tests/integration/returns/returned-undelivered-contract.test.ts
// and is untouched by this slice — not re-proven here beyond the minimal
// constraint-row assertions needed for the parity/dedup cases above.

import crypto from 'crypto';
import { withTenant, setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { WebhookRouter } from 'api-src/api/webhooks/webhookRouter';
import { buildWebhookEnvelope } from 'api-src/api/webhooks/buildWebhookEnvelope';

// Side-effect imports — registers the handlers under test with WebhookRouter.
import 'api-src/api/webhooks/shippo.tracking.handler';
import 'api-src/api/webhooks/sendcloud.tracking.handler';

const now = new Date('2026-09-15T12:00:00.000Z');

async function createShop(): Promise<{ shopId: number }> {
  const unique = crypto.randomBytes(6).toString('hex');
  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `dr02-carrier-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
  return { shopId };
}

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  const externalOrderId = String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });

    // Required by confirmShipmentFromCarrierHandoff, invoked whenever a
    // dispatched event maps to a CARRIER_HANDOFF_EVENTS type.
    await trx('order_warehouse_status').insert({
      lasyncro_order_id: orderId,
      status: 'packed',
      status_updated_at: now,
    });
  });

  return orderId;
}

async function seedShipmentTracking(input: {
  shopId: number;
  orderId: string;
  carrierCode: 'shippo' | 'sendcloud';
  trackingNumber: string;
  latestStatus?: string | null;
  latestEventAt?: Date | null;
  isStalled?: boolean;
}): Promise<string> {
  const id = crypto.randomUUID();
  await withTenant(input.shopId, (trx) =>
    trx('order_shipment_tracking').insert({
      id,
      shop_id: input.shopId,
      lasyncro_order_id: input.orderId,
      carrier_code: input.carrierCode,
      tracking_number: input.trackingNumber,
      latest_status: input.latestStatus ?? null,
      latest_event_at: input.latestEventAt ?? null,
      is_stalled: input.isStalled ?? false,
      created_at: now,
    })
  );
  return id;
}

async function getShipment(shopId: number, id: string) {
  return withTenant(shopId, (trx) => trx('order_shipment_tracking').where({ id }).first());
}

async function trackingEvents(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('parcel_tracking_events').where({ shipment_tracking_id: shipmentTrackingId }).select('*')
  );
}

async function returnJobsForOrder(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('return_jobs').where({ lasyncro_order_id: orderId, origin: 'undelivered_return' }).select('*')
  );
}

async function activeReturnedUndeliveredConstraints(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({
        lasyncro_order_id: orderId,
        constraint_type: 'operational',
        block_type: 'returned_undelivered',
        is_active: true,
      })
      .select('*')
  );
}

async function unknownStatusAlert(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts')
      .where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentTrackingId}:carrier_unknown_status` })
      .first()
  );
}

async function stalledAlert(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts')
      .where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentTrackingId}:carrier_stalled` })
      .first()
  );
}

async function returnAlert(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('alerts')
      .where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentTrackingId}:carrier_return` })
      .first()
  );
}

function shippoEnvelope(input: {
  shopId: number;
  trackingNumber: string;
  status: string;
  statusDate?: string;
  eventIdSuffix?: string;
}) {
  return buildWebhookEnvelope({
    integration: 'shippo',
    eventType: 'track_updated',
    shopId: input.shopId,
    // Distinct eventId per logical test case so unrelated assertions don't
    // collide on the router's content-hash ledger; omit to test genuine
    // exact-duplicate redelivery (same payload → same derived hash).
    eventId: input.eventIdSuffix ? `shippo-test-${input.eventIdSuffix}` : undefined,
    rawPayload: {
      event: 'track_updated',
      data: {
        tracking_number: input.trackingNumber,
        tracking_status: {
          status: input.status,
          status_date: input.statusDate,
        },
      },
    },
  });
}

function sendcloudEnvelope(input: {
  shopId: number;
  trackingNumber: string;
  status: string;
  eventIdSuffix?: string;
}) {
  return buildWebhookEnvelope({
    integration: 'sendcloud',
    eventType: 'parcel_status_changed',
    shopId: input.shopId,
    eventId: input.eventIdSuffix ? `sendcloud-test-${input.eventIdSuffix}` : undefined,
    rawPayload: {
      action: 'parcel_status_changed',
      parcel: {
        id: crypto.randomUUID(),
        tracking_number: input.trackingNumber,
        status: { message: input.status },
      },
    },
  });
}

describe('DR-02 (#1114) — carrier truth foundation', () => {
  it('Shippo returned event creates a return_jobs row and an active returned_undelivered constraint (parity fix)', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', eventIdSuffix: 'parity-01' })
    );

    const jobs = await returnJobsForOrder(shopId, orderId);
    const constraints = await activeReturnedUndeliveredConstraints(shopId, orderId);
    const shipment = await getShipment(shopId, shipmentId);

    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toEqual(expect.objectContaining({ origin: 'undelivered_return', source: 'carrier_webhook' }));
    expect(constraints).toHaveLength(1);
    expect(constraints[0].target_id).toBe(jobs[0].return_job_id);
    expect(shipment.latest_status).toBe('returned');
  });

  it('Sendcloud returned event still creates a return_jobs row and an active returned_undelivered constraint (regression)', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SENDCLOUD-${crypto.randomBytes(5).toString('hex')}`;
    await seedShipmentTracking({ shopId, orderId, carrierCode: 'sendcloud', trackingNumber });

    await WebhookRouter.dispatch(
      sendcloudEnvelope({ shopId, trackingNumber, status: 'returned_to_sender', eventIdSuffix: 'regression-01' })
    );

    const jobs = await returnJobsForOrder(shopId, orderId);
    const constraints = await activeReturnedUndeliveredConstraints(shopId, orderId);

    expect(jobs).toHaveLength(1);
    expect(constraints).toHaveLength(1);
  });

  it('does not create a duplicate return_jobs row or a duplicate active constraint when the same returned event is dispatched twice', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    // Two logically-distinct webhook deliveries (different eventId, as a
    // real carrier redelivery with a slightly different envelope would be)
    // both reporting the same underlying 'returned' fact.
    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', eventIdSuffix: 'dup-a' })
    );
    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', statusDate: '2026-09-15T12:05:00.000Z', eventIdSuffix: 'dup-b' })
    );

    const jobs = await returnJobsForOrder(shopId, orderId);
    const constraints = await activeReturnedUndeliveredConstraints(shopId, orderId);

    expect(jobs).toHaveLength(1);
    expect(constraints).toHaveLength(1);
  });

  it('does not duplicate parcel_tracking_events when the exact same webhook is redelivered byte-for-byte', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    const envelope = shippoEnvelope({ shopId, trackingNumber, status: 'TRANSIT', statusDate: '2026-09-15T10:00:00.000Z' });

    // Same envelope object dispatched twice — buildWebhookEnvelope derives
    // the same content-hash eventId both times (no eventIdSuffix given),
    // so the router's ledger must block the second dispatch entirely.
    await WebhookRouter.dispatch(envelope);
    await WebhookRouter.dispatch({ ...envelope, receivedAt: new Date() });

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);
  });

  it('treats an unmapped raw status as unknown — never in_transit, never a fabricated exception — and preserves the raw status', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SENDCLOUD-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'sendcloud', trackingNumber });

    const unmappedRawStatus = 'dr02_unmapped_test_status';
    await WebhookRouter.dispatch(
      sendcloudEnvelope({ shopId, trackingNumber, status: unmappedRawStatus, eventIdSuffix: 'unknown-01' })
    );

    const shipment = await getShipment(shopId, shipmentId);
    const events = await trackingEvents(shopId, shipmentId);
    const alert = await unknownStatusAlert(shopId, shipmentId);

    expect(shipment.latest_status).toBe('unknown');
    expect(shipment.latest_status).not.toBe('in_transit');
    expect(shipment.latest_status).not.toBe('exception');
    expect(events).toHaveLength(1);
    expect(events[0].raw_status).toBe(unmappedRawStatus);
    expect(events[0].raw_payload).toEqual(expect.objectContaining({
      parcel: expect.objectContaining({ status: expect.objectContaining({ message: unmappedRawStatus }) }),
    }));
    expect(alert).toBeTruthy();
    expect(alert.severity).toBe('warning');
  });

  it('DR-02-CORRECTION-A: parcel_tracking_events.event_type is also honestly "unknown" for an unmapped status', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'DR02_UNMAPPED_SHIPPO_STATUS', eventIdSuffix: 'audit-unknown-01' })
    );

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('unknown');
    expect(events[0].event_type).not.toBe('in_transit');
    expect(events[0].event_type).not.toBe('exception');
    expect(events[0].raw_status).toBe('DR02_UNMAPPED_SHIPPO_STATUS');
  });

  it('DR-02-CORRECTION-B: two non-identical Sendcloud events sharing the same raw status are BOTH persisted', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SENDCLOUD-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'sendcloud', trackingNumber });

    // Two genuinely distinct webhook deliveries (different eventId — as two
    // real, separate carrier scans would be), both reporting 'en_route'.
    // Pre-correction, the removed 5-minute heuristic would have silently
    // dropped the second one.
    await WebhookRouter.dispatch(
      sendcloudEnvelope({ shopId, trackingNumber, status: 'en_route', eventIdSuffix: 'no-fabricated-dedup-a' })
    );
    await WebhookRouter.dispatch(
      sendcloudEnvelope({ shopId, trackingNumber, status: 'en_route', eventIdSuffix: 'no-fabricated-dedup-b' })
    );

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.raw_status === 'en_route')).toBe(true);
  });

  it('DR-02-CORRECTION-C: delivered advances to returned when a genuinely later returned event arrives', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'DELIVERED', statusDate: '2026-09-15T10:00:00.000Z', eventIdSuffix: 'advance-a' })
    );
    let shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('delivered');

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', statusDate: '2026-09-15T14:00:00.000Z', eventIdSuffix: 'advance-b' })
    );
    shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('returned');

    // The recovery flow (return_jobs + guard) fires on this genuinely later returned event too.
    const jobs = await returnJobsForOrder(shopId, orderId);
    expect(jobs).toHaveLength(1);
  });

  it('DR-02-CORRECTION-C: delivered stays delivered against a NEWER non-returned event (only returned may advance it)', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'DELIVERED', statusDate: '2026-09-15T10:00:00.000Z', eventIdSuffix: 'noadvance-a' })
    );

    // Newer timestamp, but not 'returned' — must not move delivered backward.
    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'TRANSIT', statusDate: '2026-09-15T11:00:00.000Z', eventIdSuffix: 'noadvance-b' })
    );

    const shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('delivered');
  });

  it('prevents a stale in_transit webhook from regressing an already-delivered shipment (delivered + older in_transit -> stays delivered)', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'DELIVERED', statusDate: '2026-09-15T12:00:00.000Z', eventIdSuffix: 'terminal-a' })
    );

    const afterDelivered = await getShipment(shopId, shipmentId);
    expect(afterDelivered.latest_status).toBe('delivered');

    // Late-arriving, older-timestamped in_transit webhook (e.g. delayed queue redelivery).
    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'TRANSIT', statusDate: '2026-09-15T11:00:00.000Z', eventIdSuffix: 'terminal-b' })
    );

    const afterStale = await getShipment(shopId, shipmentId);
    expect(afterStale.latest_status).toBe('delivered');
    expect(new Date(afterStale.latest_event_at).toISOString()).toBe('2026-09-15T12:00:00.000Z');

    // Raw evidence for the stale event is still preserved, never discarded.
    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(2);
  });

  it('prevents a stale webhook from regressing an already-returned shipment', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', statusDate: '2026-09-15T12:00:00.000Z', eventIdSuffix: 'ret-terminal-a' })
    );

    const afterReturned = await getShipment(shopId, shipmentId);
    expect(afterReturned.latest_status).toBe('returned');

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'TRANSIT', statusDate: '2026-09-15T09:00:00.000Z', eventIdSuffix: 'ret-terminal-b' })
    );

    const afterStale = await getShipment(shopId, shipmentId);
    expect(afterStale.latest_status).toBe('returned');
  });

  it('still applies a normal forward-progressing mapped sequence unchanged (in_transit → out_for_delivery → delivered)', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'TRANSIT', statusDate: '2026-09-15T08:00:00.000Z', eventIdSuffix: 'fwd-a' })
    );
    let shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('in_transit');

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId, trackingNumber, status: 'DELIVERED', statusDate: '2026-09-15T10:00:00.000Z', eventIdSuffix: 'fwd-b' })
    );
    shipment = await getShipment(shopId, shipmentId);
    expect(shipment.latest_status).toBe('delivered');

    const events = await trackingEvents(shopId, shipmentId);
    expect(events).toHaveLength(2);
  });

  it('keeps carrier tracking updates tenant-isolated', async () => {
    const shopA = await createShop();
    const shopB = await createShop();
    const orderA = await seedOrder(shopA.shopId);
    const orderB = await seedOrder(shopB.shopId);
    const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;

    const shipmentA = await seedShipmentTracking({ shopId: shopA.shopId, orderId: orderA, carrierCode: 'shippo', trackingNumber });
    const shipmentB = await seedShipmentTracking({ shopId: shopB.shopId, orderId: orderB, carrierCode: 'shippo', trackingNumber });

    await WebhookRouter.dispatch(
      shippoEnvelope({ shopId: shopA.shopId, trackingNumber, status: 'DELIVERED', eventIdSuffix: 'tenant-a' })
    );

    const afterA = await getShipment(shopA.shopId, shipmentA);
    const afterB = await getShipment(shopB.shopId, shipmentB);

    expect(afterA.latest_status).toBe('delivered');
    expect(afterB.latest_status).toBeNull();
  });

  // ── #1114 IMPLEMENTATION-CORRECTION test-strategy phase — pre-refactor ──
  // characterization contracts for the missing matrix (mapped exception's
  // carrier_stalled alert; Shippo's carrier_unknown_status alert; the
  // carrier_return alert on a returned event; the returned-artifact path's
  // independence from the projection guard). These lock CURRENT observable
  // behavior of the still-duplicated handlers so the upcoming shared
  // ingestCarrierTrackingObservation refactor cannot silently drop any of
  // it. They are expected to be GREEN today — that is intentional (per the
  // brief: "These are characterization tests and may be GREEN today").
  describe('#1114 pre-refactor characterization — alert semantics not yet covered above', () => {
    it('Shippo mapped exception inserts evidence, updates the projection, and raises carrier_stalled with the exact existing key/source', async () => {
      const { shopId } = await createShop();
      const orderId = await seedOrder(shopId);
      const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
      const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

      await WebhookRouter.dispatch(
        shippoEnvelope({ shopId, trackingNumber, status: 'FAILURE', statusDate: '2026-09-15T10:00:00.000Z', eventIdSuffix: 'char-exc-shippo' })
      );

      const shipment = await getShipment(shopId, shipmentId);
      const events = await trackingEvents(shopId, shipmentId);
      const alert = await stalledAlert(shopId, shipmentId);

      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('exception');
      expect(shipment.latest_status).toBe('exception');
      expect(shipment.is_stalled).toBe(true);
      expect(alert).toBeTruthy();
      expect(alert.source).toBe('carrier_webhook');
      expect(alert.alert_type).toBe('carrier_stalled');
      expect(alert.severity).toBe('critical');
      expect(alert.is_active).toBe(true);
    });

    it('Sendcloud mapped exception inserts evidence, updates the projection, and raises carrier_stalled with the exact existing key/source', async () => {
      const { shopId } = await createShop();
      const orderId = await seedOrder(shopId);
      const trackingNumber = `SENDCLOUD-${crypto.randomBytes(5).toString('hex')}`;
      const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'sendcloud', trackingNumber });

      await WebhookRouter.dispatch(
        sendcloudEnvelope({ shopId, trackingNumber, status: 'delivery_attempt_failed', eventIdSuffix: 'char-exc-sendcloud' })
      );

      const shipment = await getShipment(shopId, shipmentId);
      const events = await trackingEvents(shopId, shipmentId);
      const alert = await stalledAlert(shopId, shipmentId);

      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('exception');
      expect(shipment.latest_status).toBe('exception');
      expect(shipment.is_stalled).toBe(true);
      expect(alert).toBeTruthy();
      expect(alert.source).toBe('carrier_webhook');
      expect(alert.alert_type).toBe('carrier_stalled');
      expect(alert.severity).toBe('critical');
      expect(alert.is_active).toBe(true);
    });

    it('Shippo unmapped status raises carrier_unknown_status with the exact existing key/source (Sendcloud parity — see the DR-02 test above)', async () => {
      const { shopId } = await createShop();
      const orderId = await seedOrder(shopId);
      const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
      const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

      await WebhookRouter.dispatch(
        shippoEnvelope({ shopId, trackingNumber, status: 'CHAR_UNMAPPED_SHIPPO', eventIdSuffix: 'char-unknown-shippo' })
      );

      const alert = await unknownStatusAlert(shopId, shipmentId);
      expect(alert).toBeTruthy();
      expect(alert.source).toBe('carrier_webhook');
      expect(alert.alert_type).toBe('carrier_unknown_status');
      expect(alert.severity).toBe('warning');
      expect(alert.is_active).toBe(true);
    });

    it('Shippo returned event raises the carrier_return alert with the exact existing key/source', async () => {
      const { shopId } = await createShop();
      const orderId = await seedOrder(shopId);
      const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
      const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

      await WebhookRouter.dispatch(
        shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', eventIdSuffix: 'char-return-shippo' })
      );

      const alert = await returnAlert(shopId, shipmentId);
      expect(alert).toBeTruthy();
      expect(alert.source).toBe('carrier_webhook');
      expect(alert.alert_type).toBe('carrier_return');
      expect(alert.severity).toBe('warning');
      expect(alert.is_active).toBe(true);
    });

    it('Sendcloud returned event raises the carrier_return alert with the exact existing key/source', async () => {
      const { shopId } = await createShop();
      const orderId = await seedOrder(shopId);
      const trackingNumber = `SENDCLOUD-${crypto.randomBytes(5).toString('hex')}`;
      const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'sendcloud', trackingNumber });

      await WebhookRouter.dispatch(
        sendcloudEnvelope({ shopId, trackingNumber, status: 'returned_to_sender', eventIdSuffix: 'char-return-sendcloud' })
      );

      const alert = await returnAlert(shopId, shipmentId);
      expect(alert).toBeTruthy();
      expect(alert.source).toBe('carrier_webhook');
      expect(alert.alert_type).toBe('carrier_return');
      expect(alert.severity).toBe('warning');
      expect(alert.is_active).toBe(true);
    });

    it('the returned-artifact path (alert + return job) fires even when the projection guard REJECTS the update', async () => {
      const { shopId } = await createShop();
      const orderId = await seedOrder(shopId);
      const trackingNumber = `SHIPPO-${crypto.randomBytes(5).toString('hex')}`;
      const shipmentId = await seedShipmentTracking({ shopId, orderId, carrierCode: 'shippo', trackingNumber });

      // Deliver at a LATER timestamp first, so a subsequently-dispatched
      // 'returned' event with an OLDER timestamp is REJECTED by
      // shouldUpdateShipmentTruth's delivered-transition guard (it only
      // accepts a strictly newer 'returned' event) — applyProjection is
      // false for the second dispatch below, independent of mappedEventType.
      await WebhookRouter.dispatch(
        shippoEnvelope({ shopId, trackingNumber, status: 'DELIVERED', statusDate: '2026-09-15T12:00:00.000Z', eventIdSuffix: 'char-indep-a' })
      );
      let shipment = await getShipment(shopId, shipmentId);
      expect(shipment.latest_status).toBe('delivered');

      await WebhookRouter.dispatch(
        shippoEnvelope({ shopId, trackingNumber, status: 'RETURNED', statusDate: '2026-09-15T09:00:00.000Z', eventIdSuffix: 'char-indep-b' })
      );

      shipment = await getShipment(shopId, shipmentId);
      // Projection was rejected — the shipment stays 'delivered', proving
      // applyProjection was false for this dispatch.
      expect(shipment.latest_status).toBe('delivered');

      // The returned-artifact path is unconditional in the current handlers
      // (its `if (mappedEventType === 'returned')` block is not gated by
      // applyProjection) — both the alert and the Return Job still fire.
      const alert = await returnAlert(shopId, shipmentId);
      const jobs = await returnJobsForOrder(shopId, orderId);
      expect(alert).toBeTruthy();
      expect(jobs).toHaveLength(1);
    });
  });
});

// tests/integration/webhooks/carrier-tracking-namespace-separation-1114.test.ts
//
// #1114 STEP 3 — permanent regression contract for the CRITICAL IDENTITY
// SEPARATION rule: ingestCarrierTrackingObservation must accept
// businessCarrierCode (persisted business identity) independently from
// statusNamespace (carrier_status_map lookup key only).
//
// This is the lowest honest layer for this behavior — it is genuinely
// DB-bound (the assertion is about what actually gets looked up in, and
// persisted from, real Postgres), so it belongs in the real-Postgres
// integration project, not a mock-based unit test.
//
// carrier_status_map is @rls-exempt shared reference data with no shop_id
// (migration 0118) — this test seeds its OWN 'carrier_1114_ns_test'
// namespace fixture rows directly (cleaned up afterward) rather than
// depending on production 'sendcloud_v3' seed data: migration 0180 (which
// would seed the real sendcloud_v3 rows per the #1114 workshop's Sendcloud
// v3 mapping strategy) is explicitly out of scope for this implementation
// slice. This keeps the test fully self-contained and independent of when
// that migration lands, while still proving the exact mechanism migration
// 0180 will rely on: the lookup is genuinely keyed by statusNamespace, not
// by businessCarrierCode.

import crypto from 'crypto';
import { withTenant, setTenantContext, systemTransaction } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { ingestCarrierTrackingObservation } from 'api-src/api/webhooks/ingestCarrierTrackingObservation';

const now = new Date('2026-09-16T12:00:00.000Z');
const FIXTURE_NAMESPACE = 'carrier_1114_ns_test';
const FIXTURE_RAW_STATUS = 'CARRIER_1114_NAMESPACE_ONLY_STATUS';

async function createShop(): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `ns1114-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('orders').insert({
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
    })
  );
  return orderId;
}

async function seedShipment(shopId: number, orderId: string, trackingNumber: string): Promise<string> {
  const id = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('order_shipment_tracking').insert({
      id,
      shop_id: shopId,
      lasyncro_order_id: orderId,
      carrier_code: 'sendcloud',
      tracking_number: trackingNumber,
      created_at: now,
    })
  );
  return id;
}

// Test-fixture-only carrier_status_map row, seeded and torn down per test —
// carrier_status_map is shared reference data (no shop_id), so this uses
// systemTransaction directly rather than a tenant-scoped trx.
// event_type 'announced' deliberately, not a CARRIER_HANDOFF_EVENTS member
// (in_transit/out_for_delivery/delivered/returned) — this test is about the
// namespace-separation mechanism, not shipment handoff confirmation
// (covered elsewhere), so it avoids needing an order_warehouse_status
// fixture row.
async function seedFixtureMapping(): Promise<void> {
  await systemTransaction((trx) =>
    trx('carrier_status_map')
      .insert({ carrier_code: FIXTURE_NAMESPACE, raw_status: FIXTURE_RAW_STATUS, event_type: 'announced' })
      .onConflict(['carrier_code', 'raw_status'])
      .ignore()
  );
}

async function removeFixtureMapping(): Promise<void> {
  await systemTransaction((trx) =>
    trx('carrier_status_map').where({ carrier_code: FIXTURE_NAMESPACE, raw_status: FIXTURE_RAW_STATUS }).delete()
  );
}

async function latestEvent(shopId: number, shipmentTrackingId: string) {
  return withTenant(shopId, (trx) =>
    trx('parcel_tracking_events')
      .where({ shipment_tracking_id: shipmentTrackingId })
      .orderBy('created_at', 'desc')
      .first()
  );
}

describe('#1114 CRITICAL IDENTITY SEPARATION — businessCarrierCode vs statusNamespace', () => {
  beforeAll(seedFixtureMapping);
  afterAll(removeFixtureMapping);

  it('resolves the mapping via statusNamespace but persists parcel_tracking_events.carrier_code as businessCarrierCode', async () => {
    const shopId = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SENDCLOUD-NS-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipment(shopId, orderId, trackingNumber);

    await withTenant(shopId, (trx) =>
      ingestCarrierTrackingObservation(trx, {
        shopId,
        businessCarrierCode: 'sendcloud',
        statusNamespace: FIXTURE_NAMESPACE,
        trackingNumber,
        rawStatus: FIXTURE_RAW_STATUS,
        eventTimestamp: new Date('2026-09-16T12:05:00.000Z'),
        location: null,
        rawPayload: { fixture: 'namespace-separation-1114' },
      })
    );

    const event = await latestEvent(shopId, shipmentId);
    expect(event).toBeTruthy();

    // The lookup genuinely used the FIXTURE_NAMESPACE: this raw_status has
    // NO row under 'sendcloud' at all — if the seam had silently used
    // businessCarrierCode ('sendcloud') for the lookup instead of
    // statusNamespace, this would resolve to nothing and event_type would
    // be 'unknown', not 'announced'.
    expect(event.event_type).toBe('announced');
    expect(event.raw_status).toBe(FIXTURE_RAW_STATUS);

    // The PERSISTED business identity is 'sendcloud' — the lookup
    // namespace must never leak into a business-facing carrier/source value.
    expect(event.carrier_code).toBe('sendcloud');
    expect(event.carrier_code).not.toBe(FIXTURE_NAMESPACE);

    const shipment = await withTenant(shopId, (trx) => trx('order_shipment_tracking').where({ id: shipmentId }).first());
    expect(shipment.carrier_code).toBe('sendcloud');
    expect(shipment.latest_status).toBe('announced');
  });

  it('confirms the fixture raw_status has no mapping at all under the real business carrier_code namespace (proves the lookup is namespace-specific, not coincidental)', async () => {
    const { rows } = await systemTransaction((trx) =>
      trx.raw(
        `SELECT 1 FROM carrier_status_map WHERE carrier_code = 'sendcloud' AND raw_status = ?`,
        [FIXTURE_RAW_STATUS]
      )
    );
    expect(rows).toHaveLength(0);
  });

  it('never persists the lookup namespace into order_shipment_tracking.carrier_code or alerts.source, even on a mapped exception observation', async () => {
    const shopId = await createShop();
    const orderId = await seedOrder(shopId);
    const trackingNumber = `SENDCLOUD-NS-${crypto.randomBytes(5).toString('hex')}`;
    const shipmentId = await seedShipment(shopId, orderId, trackingNumber);

    // Seed a second fixture mapping to 'exception' so this test can prove
    // the alert-creation path also never leaks the namespace value.
    const exceptionRawStatus = `${FIXTURE_RAW_STATUS}_EXC`;
    await systemTransaction((trx) =>
      trx('carrier_status_map')
        .insert({ carrier_code: FIXTURE_NAMESPACE, raw_status: exceptionRawStatus, event_type: 'exception' })
        .onConflict(['carrier_code', 'raw_status'])
        .ignore()
    );

    try {
      await withTenant(shopId, (trx) =>
        ingestCarrierTrackingObservation(trx, {
          shopId,
          businessCarrierCode: 'sendcloud',
          statusNamespace: FIXTURE_NAMESPACE,
          trackingNumber,
          rawStatus: exceptionRawStatus,
          eventTimestamp: new Date('2026-09-16T12:10:00.000Z'),
          location: null,
          rawPayload: { fixture: 'namespace-separation-1114-exception' },
        })
      );

      const shipment = await withTenant(shopId, (trx) => trx('order_shipment_tracking').where({ id: shipmentId }).first());
      const alerts = await withTenant(shopId, (trx) =>
        trx('alerts').where({ shop_id: shopId, alert_key: `carrier_webhook:${shipmentId}:carrier_stalled` }).select('*')
      );

      expect(shipment.carrier_code).toBe('sendcloud');
      expect(shipment.latest_status).toBe('exception');
      expect(alerts).toHaveLength(1);
      expect(alerts[0].source).toBe('carrier_webhook');

      const values = [shipment.carrier_code, ...alerts.map((a) => a.source)];
      expect(values).not.toContain(FIXTURE_NAMESPACE);
    } finally {
      await systemTransaction((trx) =>
        trx('carrier_status_map').where({ carrier_code: FIXTURE_NAMESPACE, raw_status: exceptionRawStatus }).delete()
      );
    }
  });
});

// apps/backend/scripts/seed-outbound-demo-data.ts
// THROWAWAY — populates realistic Outbound module state for visual
// verification. Run once, delete after.
// Run: node --loader ts-node/esm apps/backend/scripts/seed-outbound-demo-data.ts

import 'dotenv/config';
import db from '@lasyncro/backend-core/db.js';
import { encrypt } from '../src/security/encryption.service.js';

const SHOP_ID = 1;

async function main() {
  await db.raw(`SET app.current_tenant = '${SHOP_ID}'`);

  // 1. Connect a carrier so "carrier not configured" flips off
  const existingCarrier = await db('shop_carrier_settings')
    .where({ shop_id: SHOP_ID, carrier_code: 'sendcloud' })
    .first();

  if (!existingCarrier) {
    await db('shop_carrier_settings').insert({
      shop_id: SHOP_ID,
      carrier_code: 'sendcloud',
      public_key: encrypt('demo_public_key'),
      private_key: encrypt('demo_private_key'),
      is_active: true,
    });
    console.log('Carrier connected for shop', SHOP_ID);
  } else {
    await db('shop_carrier_settings')
      .where({ shop_id: SHOP_ID, carrier_code: 'sendcloud' })
      .update({ is_active: true });
    console.log('Carrier reactivated for shop', SHOP_ID);
  }

  // 2. Get fulfilled orders for this shop, most recent first — matches
  // exactly what the Outbound ledger queries
  const fulfilled = await db('order_fulfillment_status as ofs')
    .join('orders as o', 'o.lasyncro_order_id', 'ofs.lasyncro_order_id')
    .where({ 'ofs.status': 'fulfilled', 'o.shop_id': SHOP_ID })
    .orderBy('ofs.fulfilled_at', 'desc')
    .select('o.lasyncro_order_id')
    .limit(10);

  if (fulfilled.length < 6) {
    throw new Error(`Need at least 6 fulfilled orders, found ${fulfilled.length}. Seed more orders first.`);
  }

  const orderIds = fulfilled.map((r) => r.lasyncro_order_id);

  // Scenario plan — deliberately varied to exercise every visual state:
  const scenarios = [
    { idx: 0, tracking: 'SC-STALLED-001', status: 'in_transit', location: 'Malmö',      hoursAgo: 96,  stalled: true  }, // silent >72h — sweep-flagged
    { idx: 1, tracking: 'SC-EXCEPT-002',  status: 'exception',  location: 'Gothenburg', hoursAgo: 20,  stalled: true  }, // carrier exception
    { idx: 2, tracking: 'SC-TRANSIT-003', status: 'in_transit', location: 'Stockholm',  hoursAgo: 2,   stalled: false }, // healthy in transit
    { idx: 3, tracking: 'SC-OFD-004',     status: 'out_for_delivery', location: 'Uppsala', hoursAgo: 0.5, stalled: false },
    { idx: 4, tracking: 'SC-DELIV-005',   status: 'delivered',  location: 'Stockholm',  hoursAgo: 30,  stalled: false },
    { idx: 5, tracking: 'SC-DELIV-006',   status: 'delivered',  location: 'Örebro',     hoursAgo: 50,  stalled: false },
    // idx 6+ intentionally left with no tracking at all — keeps the
    // "missing tracking" tier and stat card meaningful for comparison
  ];

  for (const s of scenarios) {
    const lasyncroOrderId = orderIds[s.idx];
    if (!lasyncroOrderId) continue;

    const eventTimestamp = new Date(Date.now() - s.hoursAgo * 3_600_000);

    // Clear any prior seed run on this order
    const existing = await db('order_shipment_tracking')
      .where({ shop_id: SHOP_ID, lasyncro_order_id: lasyncroOrderId })
      .first();
    if (existing) {
      await db('parcel_tracking_events').where({ shipment_tracking_id: existing.id }).delete();
      await db('order_shipment_tracking').where({ id: existing.id }).delete();
    }

    const [shipment] = await db('order_shipment_tracking')
      .insert({
        shop_id: SHOP_ID,
        lasyncro_order_id: lasyncroOrderId,
        carrier_code: 'sendcloud',
        tracking_number: s.tracking,
        tracking_url: `https://tracking.sendcloud.sc/${s.tracking}`,
        latest_status: s.status,
        latest_location: s.location,
        latest_event_at: eventTimestamp,
        is_stalled: s.stalled,
      })
      .returning(['id']);

    await db('parcel_tracking_events').insert({
      shop_id: SHOP_ID,
      lasyncro_order_id: lasyncroOrderId,
      shipment_tracking_id: shipment.id,
      carrier_code: 'sendcloud',
      event_type: s.status,
      raw_status: s.status,
      event_timestamp: eventTimestamp,
      location: s.location,
      raw_payload: { seeded: true, scenario: s.tracking },
    });

    if (s.stalled) {
      await db('alerts')
        .insert({
          shop_id: SHOP_ID,
          alert_key: `carrier_webhook:${shipment.id}:carrier_stalled`,
          source: 'carrier_webhook',
          alert_type: 'carrier_stalled',
          severity: 'critical',
          title: 'Shipment stalled',
          message: `Tracking ${s.tracking} (sendcloud) — seeded demo alert.`,
          entity_id: lasyncroOrderId,
          entity_type: 'order',
          category: 'revenue_at_risk',
          audience: 'all',
          is_active: true,
        })
        .onConflict(['shop_id', 'alert_key'])
        .merge(['is_active', 'message', 'updated_at']);
    }

    console.log(`Seeded ${s.tracking} → order ${lasyncroOrderId} (${s.status}${s.stalled ? ', STALLED' : ''})`);
  }

  console.log('=== SEED COMPLETE ===');
  console.log(`${scenarios.length} shipments seeded, ${orderIds.length - scenarios.length} orders left with no tracking.`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
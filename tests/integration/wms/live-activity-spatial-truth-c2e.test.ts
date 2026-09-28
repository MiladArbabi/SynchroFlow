// tests/integration/wms/live-activity-spatial-truth-c2e.test.ts
//
// C2E — live-activity spatial truth (real Postgres, disposable DB only).
//
// getLiveActivity() feeds both /live-activity (Overview) and
// /orders-live-activity (Orders). A physical operator position may only come
// from physical evidence: the picker's latest CONFIRMED scan location. Batch
// phase proves workflow state, never location. So:
//   A. an observed picker is placed at exactly its latest scan location;
//   B. an unscanned picker is NOT anchored to the first pick zone — omitted
//      from pickerPositions while its batch stays in activeBatches;
//   C. (no explicit packer location exists in the data model — see report);
//   D. a packer is NOT anchored to the first pack zone — omitted, while the
//      packing batch stays in activeBatches;
//   E. several candidate pick/pack zones exist; none is used for an
//      unlocated operator;
//   F. a located picker keeps its freshness facts (last_scan_at,
//      batch_activity_at) verbatim;
//   plus: a real scan at a lane/frame is preserved verbatim, not remapped.

import crypto from 'crypto';
import db, {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { getLiveActivity } from 'api-src/services/wms/liveActivity.service';

jest.setTimeout(60000);

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

let shopId: number;
const users: Record<'observed' | 'unscanned' | 'packer' | 'lane', number> = {
  observed: 0,
  unscanned: 0,
  packer: 0,
  lane: 0,
};
const batches = {
  observed: crypto.randomUUID(),
  unscanned: crypto.randomUUID(),
  packing: crypto.randomUUID(),
  lane: crypto.randomUUID(),
};
const observedLatestScanAt = minutesAgo(2);
const observedBatchActivityAt = minutesAgo(1);

beforeAll(async () => {
  const unique = crypto.randomBytes(6).toString('hex');
  shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `live-activity-c2e-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, async (trx) => {
    for (const key of Object.keys(users) as Array<keyof typeof users>) {
      const [row] = await trx('users')
        .insert({
          shop_id: shopId,
          email: `c2e-${key}-${unique}@test.example`,
          password_hash: 'not-a-real-hash',
          first_name: key,
          role: 'operator',
        })
        .returning('id');
      users[key] = row.id;
    }

    const [warehouse] = await trx('warehouses')
      .insert({ shop_id: shopId, name: 'C2E', root_location_code: `WH-${shopId}-ROOT` })
      .returning('warehouse_id');

    // E: several candidate zones. The old fallback picked the FIRST active
    // pick / pack location by location_code ('A' lane, 'PACK-0').
    const locations: Array<[string, string, string]> = [
      ['A', 'lane', 'pick'],
      ['A-1', 'bin', 'pick'],
      ['Z-1', 'bin', 'pick'],
      ['PACK-0', 'bin', 'pack'],
      ['PACK-1', 'bin', 'pack'],
    ];
    for (const [location_code, type, zone_type] of locations) {
      await trx('warehouse_locations').insert({
        shop_id: shopId,
        warehouse_id: warehouse.warehouse_id,
        location_code,
        type,
        zone_type,
        active: true,
      });
    }

    const productId = crypto.randomUUID();
    const variantId = crypto.randomUUID();
    await trx('products').insert({ lasyncro_product_id: productId, shop_id: shopId });
    const orderId = crypto.randomUUID();
    const lineItemId = crypto.randomUUID();
    const now = new Date();
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      currency: 'USD',
      total_price: '10.00',
      subtotal_price: '10.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });
    await trx('order_line_items').insert({
      lasyncro_line_item_id: lineItemId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      title: 'C2E fixture line',
      quantity: 1,
      unit_price: '10.00',
      line_total: '10.00',
      created_at: now,
      updated_at: now,
    });

    const batch = (id: string, status: string, extra: Record<string, unknown>) => ({
      pick_batch_id: id,
      shop_id: shopId,
      status,
      release_trigger: 'manual',
      max_line_items: 10,
      total_line_items: 1,
      total_units: 1,
      released_at: minutesAgo(30),
      ...extra,
    });
    await trx('pick_batches').insert([
      batch(batches.observed, 'picking', {
        picked_by: users.observed,
        pick_last_activity_at: observedBatchActivityAt,
      }),
      batch(batches.unscanned, 'picking', {
        picked_by: users.unscanned,
        pick_last_activity_at: minutesAgo(3),
      }),
      batch(batches.packing, 'packing', {
        packed_by: users.packer,
        pick_last_activity_at: minutesAgo(20),
        pack_last_activity_at: minutesAgo(4),
      }),
      batch(batches.lane, 'picking', {
        picked_by: users.lane,
        pick_last_activity_at: minutesAgo(5),
      }),
    ]);

    const scan = (batchId: string, by: number, location_code: string, scanned_at: Date) => ({
      shop_id: shopId,
      pick_batch_id: batchId,
      lasyncro_line_item_id: lineItemId,
      lasyncro_variant_id: variantId,
      location_code,
      quantity_confirmed: 1,
      status: 'confirmed',
      scanned_by: by,
      scanned_at,
    });
    await trx('pick_scan_log').insert([
      // Observed picker: an older scan, then the latest at a non-first bin.
      scan(batches.observed, users.observed, 'A-1', minutesAgo(10)),
      scan(batches.observed, users.observed, 'Z-1', observedLatestScanAt),
      // A real scan recorded against a lane/frame location.
      scan(batches.lane, users.lane, 'A', minutesAgo(6)),
    ]);
  });
});

afterAll(async () => {
  await db.destroy();
});

describe('C2E getLiveActivity — spatial truth for operator positions', () => {
  it('A/F — an observed picker is placed at exactly its latest confirmed scan location, with freshness facts verbatim', async () => {
    const payload = await getLiveActivity(shopId);
    const observed = payload.pickerPositions.filter(p => p.operator_id === String(users.observed));

    expect(observed).toHaveLength(1);
    expect(observed[0].location_code).toBe('Z-1');
    expect(observed[0].batch_id).toBe(batches.observed);
    expect(new Date(observed[0].last_scan_at as string).getTime()).toBe(observedLatestScanAt.getTime());
    expect(new Date(observed[0].batch_activity_at as string).getTime()).toBe(observedBatchActivityAt.getTime());
  });

  it('B/E — an unscanned picker is omitted from positions (no first-pick-zone anchor) while its batch stays active', async () => {
    const payload = await getLiveActivity(shopId);

    expect(payload.pickerPositions.some(p => p.operator_id === String(users.unscanned))).toBe(false);
    expect(payload.activeBatches).toContainEqual(
      expect.objectContaining({ batch_id: batches.unscanned, status: 'picking' })
    );
  });

  it('D/E — a packer is omitted from positions (no first-pack-zone anchor) while the packing batch stays active', async () => {
    const payload = await getLiveActivity(shopId);

    expect(payload.pickerPositions.some(p => p.operator_id === String(users.packer))).toBe(false);
    expect(payload.pickerPositions.some(p => ['PACK-0', 'PACK-1'].includes(String(p.location_code)))).toBe(false);
    expect(payload.activeBatches).toContainEqual(
      expect.objectContaining({ batch_id: batches.packing, status: 'packing' })
    );
  });

  it('preserves a real lane/frame scan location verbatim rather than remapping it', async () => {
    const payload = await getLiveActivity(shopId);
    const lane = payload.pickerPositions.filter(p => p.operator_id === String(users.lane));

    expect(lane).toHaveLength(1);
    expect(lane[0].location_code).toBe('A');
  });

  it('emits only evidence-backed positions and keeps every active batch in workflow state', async () => {
    const payload = await getLiveActivity(shopId);

    expect(payload.pickerPositions.map(p => [String(p.operator_id), p.location_code]).sort()).toEqual(
      [
        [String(users.observed), 'Z-1'],
        [String(users.lane), 'A'],
      ].sort()
    );
    expect(payload.activeBatches.map(b => b.batch_id).sort()).toEqual(
      [batches.observed, batches.unscanned, batches.packing, batches.lane].sort()
    );
  });
});

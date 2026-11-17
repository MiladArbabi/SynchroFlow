/**
 * SF-PICK-ASSIGN-01 Correction 007 (REVIEW-005 H-1) — the exact mobile Pick
 * scan payload against an allocation-backed batch. Real routes via createApp +
 * supertest; disposable DB only (fixture() asserts a synchroflow_test_* DB).
 *
 * The pick task is read from GET /batch/:id/line-items — the same endpoint and
 * fields PickBriefScreen uses — and the request body is built field-for-field
 * as PickBriefScreen builds it (asserted on the device side by
 * apps/mobile/__tests__/pick-allocation-scan-c007.test.tsx AS-01). No fixture
 * helper adds or fills reservation_allocation_id.
 */
import request from 'supertest';
import crypto from 'crypto';
import { app, fixture, release, claim, evidence } from './pick-assign-sf-01.fixture';

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

type MobileItem = {
  reservation_allocation_id?: string | null;
  lasyncro_line_item_id: string;
  lasyncro_variant_id: string;
  location_code: string;
  quantity: number | string;
};

const lineItems = async (token: string, batchId: string): Promise<MobileItem[]> => {
  const res = await request(app).get(`/api/v1/wms/batch/${batchId}/line-items`).set('Authorization', `Bearer ${token}`);
  expect(res.status).toBe(200);
  return res.body.line_items;
};

/** Field-for-field the body PickBriefScreen.handleProductResolve sends (C007). */
const mobileBody = (batchId: string, item: MobileItem, generation: string, deviceEventId: string) => ({
  pick_batch_id:             batchId,
  lasyncro_line_item_id:     item.lasyncro_line_item_id,
  lasyncro_variant_id:       item.lasyncro_variant_id,       // barcode resolve returns the matching variant
  lasyncro_unit_id:          null,                           // resolver found no LSU for a plain barcode
  reservation_allocation_id: item.reservation_allocation_id ?? undefined,
  location_code:             item.location_code,
  quantity_confirmed:        item.quantity,
  device_event_id:           deviceEventId,
  scan_source:               'camera',
  pick_claim_generation:     generation,
});

const post = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/wms/pick/scan').set('Authorization', `Bearer ${token}`).send(body);

type Evidence = Awaited<ReturnType<typeof evidence>>;
const addedBy = <T>(before: T[], after: T[], id: (r: any) => string) => {
  const seen = new Set(before.map(id));
  return after.filter((r) => !seen.has(id(r)));
};

function expectOneScanApplied(before: Evidence, after: Evidence, res: request.Response, a: any, operatorId: number, batchId: string) {
  const qty = Number(a.quantity);
  expect(after.movements.length).toBe(before.movements.length + 2);
  const added = addedBy(before.movements, after.movements, (m) => m.lasyncro_inventory_movement_id);
  expect(added.map((m: any) => m.movement_type).sort()).toEqual(['pick_removal', 'reservation_release']);
  const removal = added.find((m: any) => m.movement_type === 'pick_removal');
  const rel = added.find((m: any) => m.movement_type === 'reservation_release');
  expect(removal.lasyncro_inventory_movement_id).toBe(res.body.inventory_movement_id);
  for (const m of [removal, rel]) {
    expect({ v: m.lasyncro_variant_id, loc: m.location_code, op: m.operator_id, d: Number(m.quantity_delta) })
      .toEqual({ v: a.lasyncro_variant_id, loc: a.location_code, op: operatorId, d: -qty });
  }
  expect({ t: rel.reference_type, id: rel.reference_id }).toEqual({ t: 'pick_reservation_allocation', id: a.allocation_id });

  const scans = addedBy(before.scans, after.scans, (s) => s.scan_id);
  expect(scans).toHaveLength(1);
  expect({
    scan_id: scans[0].scan_id, pick_batch_id: scans[0].pick_batch_id, scanned_by: scans[0].scanned_by,
    reservation_allocation_id: scans[0].reservation_allocation_id, inventory_movement_id: scans[0].inventory_movement_id,
    location_code: scans[0].location_code, quantity_confirmed: Number(scans[0].quantity_confirmed), status: scans[0].status,
  }).toEqual({
    scan_id: res.body.scan_id, pick_batch_id: batchId, scanned_by: operatorId,
    reservation_allocation_id: a.allocation_id, inventory_movement_id: removal.lasyncro_inventory_movement_id,
    location_code: a.location_code, quantity_confirmed: qty, status: 'confirmed',
  });

  // Truth: on_hand and reserved drop by qty at the scanned (variant, location) only.
  const key = (t: any) => `${t.lasyncro_variant_id}|${t.location_code}`;
  const q = (rows: any[]) => new Map(rows.map((t) => [key(t), { on_hand: Number(t.on_hand_quantity), reserved: Number(t.reserved_quantity) }]));
  const tb = q(before.truth); const ta = q(after.truth);
  expect([...ta.keys()].sort()).toEqual([...tb.keys()].sort());
  for (const [k, v] of tb) {
    const exp = k === key(a) ? { on_hand: v.on_hand - qty, reserved: v.reserved - qty } : v;
    expect({ k, ...ta.get(k)! }).toEqual({ k, ...exp });
  }
  // The allocation row itself is the persisted task identity and is not rewritten.
  expect(after.allocations).toEqual(before.allocations);
}

test('MA-01 the exact mobile payload records an allocation-backed scan; a replay is idempotent', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation as string;

  const items = await lineItems(fx.A.token, batchId);
  expect(items.length).toBe(allocations.length);
  for (const it of items) expect(typeof it.reservation_allocation_id).toBe('string'); // allocation-backed batch

  const item = items[0];
  const a = allocations.find((x: any) => x.allocation_id === item.reservation_allocation_id);
  expect(a).toBeDefined();
  const body = mobileBody(batchId, item, gen, crypto.randomUUID());
  expect(body.reservation_allocation_id).toBe(a.allocation_id);

  const before = await evidence(shopId, batchId);
  const res = await post(fx.A.token, body);
  expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
  const after = await evidence(shopId, batchId);
  expectOneScanApplied(before, after, res, a, fx.A.userId, batchId);
  expect(after.unitsPicked).toBe(before.unitsPicked + Number(a.quantity));

  // The task is consumed: it no longer appears in the operator's list.
  expect((await lineItems(fx.A.token, batchId)).map((i) => i.reservation_allocation_id)).not.toContain(a.allocation_id);

  // Offline replay of the identical queued body (same device_event_id, allocation, generation).
  const replay = await post(fx.A.token, body);
  expect({ status: replay.status, body: replay.body }).toMatchObject({
    status: 409,
    body: { code: 'PICK_SCAN_ALREADY_RECORDED', recorded_by_requester: true, scan_id: res.body.scan_id, reservation_allocation_id: a.allocation_id },
  });
  expect(await evidence(shopId, batchId)).toEqual(after);
});

test('MA-02 every allocation of the batch can be picked with mobile payloads', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation as string;
  const items = await lineItems(fx.A.token, batchId);
  const before = await evidence(shopId, batchId);
  for (const it of items) {
    const res = await post(fx.A.token, mobileBody(batchId, it, gen, crypto.randomUUID()));
    expect({ status: res.status, body: res.body }).toMatchObject({ status: 201 });
  }
  const after = await evidence(shopId, batchId);
  expect(after.scans.map((s: any) => s.reservation_allocation_id).sort())
    .toEqual(allocations.map((x: any) => x.allocation_id).sort());
  expect(after.movements.length).toBe(before.movements.length + 2 * allocations.length);
  expect(await lineItems(fx.A.token, batchId)).toEqual([]);
});

test('MA-03 the pre-C007 mobile payload (no allocation) is refused and writes nothing — the server never substitutes one', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation as string;
  const [item] = await lineItems(fx.A.token, batchId);
  const { reservation_allocation_id: _omitted, ...preC007 } = mobileBody(batchId, item, gen, crypto.randomUUID());

  const before = await evidence(shopId, batchId);
  const res = await post(fx.A.token, preC007);
  expect({ status: res.status, error: res.body.error })
    .toEqual({ status: 400, error: 'reservation_allocation_id is required for allocation-backed picking.' });
  expect(await evidence(shopId, batchId)).toEqual(before);
});

test('MA-04 a mobile payload carrying the wrong allocation (another task) is refused and writes nothing', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation as string;
  const [first, second] = await lineItems(fx.A.token, batchId);
  const body = { ...mobileBody(batchId, first, gen, crypto.randomUUID()), reservation_allocation_id: second.reservation_allocation_id };

  const before = await evidence(shopId, batchId);
  const res = await post(fx.A.token, body);
  expect({ status: res.status, error: res.body.error })
    .toEqual({ status: 400, error: 'reservation_allocation_id does not match the requested pick task.' });
  expect(await evidence(shopId, batchId)).toEqual(before);
});

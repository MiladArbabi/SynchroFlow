import crypto from 'crypto';
import request from 'supertest';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { confirmPickScan } from 'api-src/services/wms/pickScan.service';
import { app, fixture, release, claim, type Fx } from './pick-assign-sf-01.fixture';
jest.setTimeout(180_000);
const rootOf = (fx: Fx) => `WH-${fx.shop.shopId}-ROOT`;
async function seedReceivedUnits(fx: Fx, variantId: string, count: number, closed = true) {
  const shopId = fx.shop.shopId;
  return withTenant(shopId, async (trx) => {
    const [supplier] = await trx('suppliers').insert({ shop_id: shopId, name: `LT supplier ${crypto.randomUUID()}` }).returning('id');
    const [po] = await trx('purchase_orders').insert({ shop_id: shopId, supplier_id: supplier.id }).returning('id');
    const [job] = await trx('receive_jobs')
      .insert({ shop_id: shopId, po_id: po.id, ...(closed ? { status: 'closed', closed_at: new Date() } : {}) })
      .returning('receive_job_id');
    const [line] = await trx('receive_job_lines')
      .insert({ shop_id: shopId, receive_job_id: job.receive_job_id, lasyncro_variant_id: variantId, quantity_expected: count })
      .returning('receive_job_line_id');
    const ids: string[] = [];
    for (let i = 1; i <= count; i++) {
      const unitId = `LSU-${crypto.randomBytes(4).toString('hex')}`;
      await trx('inventory_units').insert({
        shop_id: shopId, lasyncro_unit_id: unitId, lasyncro_variant_id: variantId,
        receive_job_line_id: line.receive_job_line_id, receive_sequence: i, status: 'received', current_location_code: null,
      });
      ids.push(unitId);
    }
    if (closed) {
      const n = await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: `WH-${shopId}-ROOT` })
        .update({
          on_hand_quantity: trx.raw('on_hand_quantity + ?', [count]),
          available_quantity: trx.raw('available_quantity + ?', [count]),
        });
      expect(n).toBe(1);
    }
    return { ids, receiveJobLineId: line.receive_job_line_id as string, poId: po.id as number };
  });
}

let fx: Fx; let other: Fx;
beforeAll(async () => { fx = await fixture(); other = await fixture(); });
async function batch() {
  const b = await release(fx); const c = await claim(fx.A.token, b.batchId); expect(c.status).toBe(200);
  return { ...b, generation: c.body.pick_claim_generation as string };
}
function read(b: any, a: any, token = fx.A.token, generation = b.generation, kind = 'pick', eventId?: string) {
  return request(app).get(`/api/v1/wms/batch/${b.batchId}/pick-session`).set('Authorization', `Bearer ${token}`)
    .set('X-Pick-Claim-Generation', generation).query({ operation_type: kind, reservation_allocation_id: a.allocation_id,
      lasyncro_line_item_id: a.lasyncro_line_item_id, ...(eventId ? { device_event_id: eventId } : {}) });
}
async function physicalState(b: any, a: any) {
  return withTenant(fx.shop.shopId, async trx => ({
    truth: await trx('inventory_truth').where({ shop_id: fx.shop.shopId, lasyncro_variant_id: a.lasyncro_variant_id, location_code: a.location_code }).first('on_hand_quantity', 'reserved_quantity'),
    scans: await trx('pick_scan_log').where({ shop_id: fx.shop.shopId, pick_batch_id: b.batchId, reservation_allocation_id: a.allocation_id }).select('scan_id', 'quantity_confirmed'),
    movements: await trx('inventory_movements').where({ shop_id: fx.shop.shopId, lasyncro_variant_id: a.lasyncro_variant_id, movement_type: 'pick_removal' }).select('lasyncro_inventory_movement_id', 'quantity_delta'),
  }));
}
test('in-flight original Pick: successful stale reads are unresolved; after late commit the exact receipt appears with one removal', async () => {
  const b = await batch(); const a = b.allocations[0];
  const received = await seedReceivedUnits(fx, a.lasyncro_variant_id, Number(a.quantity));
  const before = await physicalState(b, a);
  let entered!: () => void; let finish!: () => void;
  const ready = new Promise<void>(r => { entered = r; }); const barrier = new Promise<void>(r => { finish = r; });
  const write = withTenant(fx.shop.shopId, async trx => {
    const result = await confirmPickScan(trx, { shopId: fx.shop.shopId, pickBatchId: b.batchId,
      lasyncroLineItemId: a.lasyncro_line_item_id, lasyncroVariantId: a.lasyncro_variant_id,
      reservationAllocationId: a.allocation_id, locationCode: a.location_code, quantityConfirmed: Number(a.quantity),
      scannedBy: fx.A.userId, pickClaimGeneration: b.generation, lasyncroUnitIds: received.ids });
    entered(); await barrier; return result;
  });
  try {
    await Promise.race([ready, write.then(() => { throw new Error('Write finished before commit barrier'); })]);
    const stale = await read(b, a); expect(stale.status).toBe(200);
    expect(stale.body.outcome).toEqual({ status: 'unresolved', operation_identity: `pick:${b.batchId}:${a.allocation_id}` });
    expect(await physicalState(b, a)).toEqual(before); // no uncommitted inventory/receipt visible
    finish(); const result = await write;
    const committed = await read(b, a); expect(committed.status).toBe(200);
    expect(committed.body.outcome).toMatchObject({ status: 'recorded', operation_type: 'pick',
      operation_identity: `pick:${b.batchId}:${a.allocation_id}`, scan_id: result.scan_id,
      inventory_movement_id: result.inventory_movement_id, quantity_required: Number(a.quantity),
      quantity_confirmed: Number(a.quantity), operator_id: fx.A.userId,
      lasyncro_unit_ids: [...received.ids].sort(), reservation_allocation_id: a.allocation_id });
    const after = await physicalState(b, a); expect(after.scans).toHaveLength(1);
    expect(after.movements).toHaveLength(before.movements.length + 1);
    expect(Number(after.truth.on_hand_quantity)).toBe(Number(before.truth.on_hand_quantity) - Number(a.quantity));
    expect(Number(after.truth.reserved_quantity)).toBe(Number(before.truth.reserved_quantity) - Number(a.quantity));
    expect((await read(b, a)).body.outcome).toEqual(committed.body.outcome);
    expect(await physicalState(b, a)).toEqual(after); // read/recovery never removes again
  } finally { finish(); await write; }
});
test.each([0, 1])('Short Pick found=%s returns its committed event, exact quantities and found-unit lineage', async found => {
  const b = await batch(); const a = b.allocations.find((v: any) => Number(v.quantity) === 2)!;
  const received = await seedReceivedUnits(fx, a.lasyncro_variant_id, 2); const event = crypto.randomUUID();
  const before = await physicalState(b, a);
  const result = await request(app).post(`/api/v1/wms/batch/${b.batchId}/exception`).set('Authorization', `Bearer ${fx.A.token}`).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    reservation_allocation_id: a.allocation_id, stage: 'pick', exception_type: 'short_pick', quantity_required: 2,
    quantity_found: found, device_event_id: event, lasyncro_unit_ids: received.ids.slice(0, found), pick_claim_generation: b.generation,
  });
  if (found === 0) {
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('short_pick requires a found quantity greater than zero');
    expect((await read(b, a, fx.A.token, b.generation, 'exception', event)).body.outcome.status).toBe('unresolved');
    expect(await physicalState(b, a)).toEqual(before);
    return;
  }
  expect(result.status).toBe(201);
  const receipt = await read(b, a, fx.A.token, b.generation, 'exception', event); expect(receipt.status).toBe(200);
  expect(receipt.body.outcome).toMatchObject({ status: 'recorded', operation_type: 'exception', operation_identity: `exception:${event}`,
    device_event_id: event, exception_type: 'short_pick', quantity_required: 2, quantity_found: found,
    quantity_confirmed: found, lasyncro_unit_ids: received.ids.slice(0, found).sort(), pick_exception_id: result.body.pick_exception_id });
  expect((await read(b, a)).body.outcome.status).toBe('unresolved'); // never mistake Short Pick for full Pick
  expect((await read(b, a, fx.A.token, b.generation, 'exception', crypto.randomUUID())).body.outcome.status).toBe('unresolved');
});
test('tenant, owner and held-generation gates protect allocation outcome reads', async () => {
  const b = await batch(); const a = b.allocations[0];
  expect((await read(b, a, other.A.token)).status).toBe(404);
  const wrongOwner = await read(b, a, fx.B.token);
  expect(wrongOwner.status).toBe(409); expect(wrongOwner.body.code).toBe('PICK_OWNERSHIP_REVOKED');
  expect((await read(b, a, fx.A.token, crypto.randomUUID())).body.code).toBe('PICK_GENERATION_STALE');
  const absent = { ...a, allocation_id: crypto.randomUUID() };
  expect((await read(b, absent)).status).toBe(404);
  expect((await read(b, { ...a, allocation_id: 'invalid' })).status).toBe(400);
  expect((await read(b, a)).body.outcome.status).toBe('unresolved');
});

test('zero-found item-missing exception has a positive event receipt without fabricating a physical Pick', async () => {
  const b = await batch(); const a = b.allocations[0]; const event = crypto.randomUUID();
  const before = await physicalState(b, a);
  const result = await request(app).post(`/api/v1/wms/batch/${b.batchId}/exception`).set('Authorization', `Bearer ${fx.A.token}`).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id, reservation_allocation_id: a.allocation_id,
    stage: 'pick', exception_type: 'item_missing', quantity_required: Number(a.quantity), quantity_found: 0,
    device_event_id: event, pick_claim_generation: b.generation,
  });
  expect(result.status).toBe(201);
  const outcome = (await read(b, a, fx.A.token, b.generation, 'exception', event)).body.outcome;
  expect(outcome).toMatchObject({ status: 'recorded', operation_identity: `exception:${event}`, quantity_found: 0,
    quantity_confirmed: 0, exception_type: 'item_missing', device_event_id: event, lasyncro_unit_ids: [], scan_id: null, inventory_movement_id: null });
  const after = await physicalState(b, a); expect(after.movements).toEqual(before.movements); expect(after.scans).toEqual(before.scans);
});

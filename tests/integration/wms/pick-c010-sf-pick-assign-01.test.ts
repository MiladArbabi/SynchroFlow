/**
 * SF-PICK-ASSIGN-01 C010 — REVIEW-006 F1 / F2 / F3 / R4, server side.
 * Real routes via createApp + supertest; disposable DB only (with-test-db.js).
 *
 * F1  GET pick-session is a verification of the generation the client HOLDS
 *     (X-Pick-Claim-Generation), never a source of a new one: missing →
 *     PICK_GENERATION_REQUIRED, different (A→B→A) → PICK_GENERATION_STALE.
 * F2  POST /pick/unconfirmed-scan-review records the operator's review of a
 *     historical, generation-less device scan in operator_audit_log (with the
 *     original data) before the device may forget it. No Pick effect.
 * F3  Legacy (non-allocation) lines: a Pick-stage exception and a confirmed
 *     scan are mutually exclusive, serialized on the batch row lock.
 * R4  Custody acknowledgement after takeover survives reconnect/reload.
 */
import request from 'supertest';
import crypto from 'crypto';
import {
  app, fixture, release, claim, scan, ack, ageBatch, batchRow, evidence,
} from './pick-assign-sf-01.fixture';
import { withTenant } from '@lasyncro/backend-core/db.js';

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const pickSession = (token: string, batchId: string, held?: string) => {
  const r = request(app).get(`/api/v1/wms/batch/${batchId}/pick-session`).set('Authorization', `Bearer ${token}`);
  return held === undefined ? r : r.set('X-Pick-Claim-Generation', held);
};

const takeOver = async (shopId: number, token: string, batchId: string) => {
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const res = await claim(token, batchId);
  expect(res.status).toBe(200);
  return res.body as { pick_claim_generation: string; custody_ack_required: boolean };
};

// ── F1 ───────────────────────────────────────────────────────────────────────

test('C10-F1-01 same-generation recovery succeeds and returns the held generation unchanged', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const res = await pickSession(fx.A.token, batchId, gen);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ pick_batch_id: batchId, pick_claim_generation: gen });
});

test('C10-F1-02 A→B→A with zero units picked by B: A’s stale session is refused, nothing changes', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  const g1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await takeOver(shopId, fx.B.token, batchId);                // B picks nothing
  const g3 = (await takeOver(shopId, fx.A.token, batchId)).pick_claim_generation;   // A takes it back elsewhere
  expect(g3).not.toBe(g1);
  const before = { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId) };

  const stale = await pickSession(fx.A.token, batchId, g1);
  expect({ status: stale.status, code: stale.body.code }).toEqual({ status: 409, code: 'PICK_GENERATION_STALE' });
  expect(stale.body.pick_claim_generation).toBeUndefined();          // the new generation is never disclosed

  const after = { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId) };
  expect(after).toEqual(before);                                     // no reclaim, no rotation, no inventory effect
  expect((await pickSession(fx.A.token, batchId, g3)).status).toBe(200);   // the live session is unaffected
});

test('C10-F1-03 missing held-generation context cannot adopt the current generation', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx);
  await claim(fx.A.token, batchId);
  for (const held of [undefined, '']) {
    const res = await pickSession(fx.A.token, batchId, held);
    expect({ status: res.status, code: res.body.code }).toEqual({ status: 409, code: 'PICK_GENERATION_REQUIRED' });
    expect(res.body.pick_claim_generation).toBeUndefined();
  }
});

test('C10-F1-04 lost connection followed by takeover: the old holder is refused on recovery', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  const gA = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await takeOver(shopId, fx.B.token, batchId);
  const res = await pickSession(fx.A.token, batchId, gA);
  expect({ status: res.status, code: res.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
});

test('C10-F1-05 fresh session entry is still the explicit claim', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx);
  const res = await claim(fx.A.token, batchId);
  expect(res.status).toBe(200);
  expect(typeof res.body.pick_claim_generation).toBe('string');
});

// ── R4 ───────────────────────────────────────────────────────────────────────

test('C10-R4-01 takeover with picked units: reconnect/reload recovery reports custody pending until acknowledged', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gA = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect((await scan(fx.A.token, batchId, allocations[0], gA)).status).toBe(201);
  const taken = await takeOver(shopId, fx.B.token, batchId);
  expect(taken.custody_ack_required).toBe(true);

  const recovered = await pickSession(fx.B.token, batchId, taken.pick_claim_generation);
  expect(recovered.body).toMatchObject({ custody_ack_required: true, pick_claim_generation: taken.pick_claim_generation });
  const blocked = await scan(fx.B.token, batchId, allocations[1], taken.pick_claim_generation);
  expect({ status: blocked.status, code: blocked.body.code }).toEqual({ status: 409, code: 'PICK_CUSTODY_ACK_REQUIRED' });

  expect((await ack(fx.B.token, batchId, taken.pick_claim_generation)).status).toBe(200);
  expect((await pickSession(fx.B.token, batchId, taken.pick_claim_generation)).body.custody_ack_required).toBe(false);
});

test('C10-R4-02 A→B→A with zero units picked by B: A’s new claim needs no custody ack for B, and A’s old session stays refused', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const g1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect((await scan(fx.A.token, batchId, allocations[0], g1)).status).toBe(201);   // A holds 1 unit
  await takeOver(shopId, fx.B.token, batchId);                                    // B picks zero
  const back = await takeOver(shopId, fx.A.token, batchId);
  const unitsBefore = (await evidence(shopId, batchId)).unitsPicked;
  expect(unitsBefore).toBeGreaterThan(0);                                         // A's progress preserved

  expect((await pickSession(fx.A.token, batchId, g1)).body.code).toBe('PICK_GENERATION_STALE');
  const s = await pickSession(fx.A.token, batchId, back.pick_claim_generation);
  expect(s.status).toBe(200);
  expect(s.body.custody_ack_required).toBe(back.custody_ack_required);
  expect((await evidence(shopId, batchId)).unitsPicked).toBe(unitsBefore);
});

// ── F2 ───────────────────────────────────────────────────────────────────────

const review = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/wms/pick/unconfirmed-scan-review').set('Authorization', `Bearer ${token}`).send(body);

test('C10-F2-01 reviewing a generation-less historical scan is audited with its original data and has no Pick effect', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  await claim(fx.A.token, batchId);
  const before = { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId) };
  const original = JSON.stringify({
    pick_batch_id: batchId, lasyncro_line_item_id: allocations[0].lasyncro_line_item_id,
    lasyncro_variant_id: allocations[0].lasyncro_variant_id, location_code: allocations[0].location_code, quantity_confirmed: 1,
  });
  const deviceEventId = crypto.randomUUID();
  const res = await review(fx.A.token, {
    device_event_id: deviceEventId, queued_at: 1_700_000_000_000,
    original: { url: '/api/v1/wms/pick/scan', method: 'POST', body: original },
  });
  expect(res.status).toBe(201);

  const rows = await withTenant(shopId, (trx) =>
    trx('operator_audit_log').where({ shop_id: shopId, action_type: 'pick_unconfirmed_scan_review' }).select('*'));
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ operator_id: fx.A.userId, entity_type: 'pick_batch', entity_id: batchId });
  const meta = typeof rows[0].metadata === 'string' ? JSON.parse(rows[0].metadata) : rows[0].metadata;
  expect(meta).toMatchObject({ device_event_id: deviceEventId, outcome: 'unconfirmed', original: { body: original } });

  const after = { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId) };
  expect(after).toEqual(before);
});

test('C10-F2-02 malformed review requests are refused and write nothing', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  for (const body of [{}, { device_event_id: '' }, { device_event_id: 'x', original: 'nope' }]) {
    expect((await review(fx.A.token, body)).status).toBe(400);
  }
  const rows = await withTenant(shopId, (trx) =>
    trx('operator_audit_log').where({ shop_id: shopId, action_type: 'pick_unconfirmed_scan_review' }).select('*'));
  expect(rows).toHaveLength(0);
});

// ── F3 ───────────────────────────────────────────────────────────────────────

/** A legacy (pre-allocation) batch: the same released batch with its allocation rows removed. */
async function legacyBatch(fx: Awaited<ReturnType<typeof fixture>>) {
  const { batchId, allocations } = await release(fx);
  await withTenant(fx.shop.shopId, (trx) =>
    trx('pick_reservation_allocations').where({ shop_id: fx.shop.shopId, pick_batch_id: batchId }).delete());
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation as string;
  return { batchId, line: allocations[0], gen };
}
const legacyScan = (token: string, batchId: string, a: any, gen: string) =>
  request(app).post('/api/v1/wms/pick/scan').set('Authorization', `Bearer ${token}`).send({
    pick_batch_id: batchId, lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    location_code: a.location_code, quantity_confirmed: Number(a.quantity), pick_claim_generation: gen,
  });
const legacyException = (token: string, batchId: string, a: any, gen: string, eventId = crypto.randomUUID()) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/exception`).set('Authorization', `Bearer ${token}`).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    exception_type: 'item_missing', stage: 'pick', quantity_required: Number(a.quantity), quantity_found: 0,
    device_event_id: eventId, pick_claim_generation: gen,
  });
async function lineOutcome(shopId: number, batchId: string, lineId: string) {
  return withTenant(shopId, async (trx) => ({
    scans: await trx('pick_scan_log').where({ shop_id: shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineId, status: 'confirmed' }).select('scan_id'),
    exceptions: await trx('pick_exceptions').where({ shop_id: shopId, pick_batch_id: batchId, lasyncro_line_item_id: lineId, stage: 'pick' }).select('pick_exception_id'),
    removals: await trx('inventory_movements').where({ shop_id: shopId, reference_id: batchId }).select('*'),
  }));
}

test('C10-F3-01 legacy: exception before scan → the scan is refused, no inventory removed', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, line, gen } = await legacyBatch(fx);
  expect((await legacyException(fx.A.token, batchId, line, gen)).status).toBe(201);
  const movementsBefore = (await evidence(shopId, batchId)).movements;
  const res = await legacyScan(fx.A.token, batchId, line, gen);
  expect(res.status).toBe(409);
  const out = await lineOutcome(shopId, batchId, line.lasyncro_line_item_id);
  expect(out.scans).toHaveLength(0);
  expect(out.exceptions).toHaveLength(1);
  expect((await evidence(shopId, batchId)).movements).toEqual(movementsBefore);
});

test('C10-F3-02 legacy: scan before exception → the exception is refused, no Problem Center task', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, line, gen } = await legacyBatch(fx);
  expect((await legacyScan(fx.A.token, batchId, line, gen)).status).toBe(201);
  const tasksBefore = await withTenant(shopId, (trx) => trx('problem_center_tasks').where({ shop_id: shopId }).select('*'));
  const res = await legacyException(fx.A.token, batchId, line, gen);
  expect(res.status).toBe(409);
  const out = await lineOutcome(shopId, batchId, line.lasyncro_line_item_id);
  expect(out.scans).toHaveLength(1);
  expect(out.exceptions).toHaveLength(0);
  expect(await withTenant(shopId, (trx) => trx('problem_center_tasks').where({ shop_id: shopId }).select('*'))).toEqual(tasksBefore);
});

/**
 * C10-F3-03 deterministic lock barrier (VERIFY-CLOSURE-01).
 * CONCURRENCY-002: production lock order is orders FOR UPDATE → pick_batches
 * FOR UPDATE, so the shared order row is the contention point. A test-owned
 * transaction holds that orders row lock. Each request is issued only after
 * Postgres reports the previous one blocked behind the barrier, so both
 * provably wait on the same order lock before it is released. Row-lock
 * waiters are granted in queue order, so the first queued request must win;
 * both orders are exercised.
 */
const BARRIER_WAIT_MS = 15000;
const POLL_MS = 25;

/** Sessions waiting (directly or through another waiter) on the barrier's lock. */
async function waitersBehind(shopId: number, barrierPid: number) {
  const rows = await withTenant(shopId, async (trx) => (await trx.raw(
    `SELECT pid, wait_event_type, query, pg_blocking_pids(pid) AS blockers
       FROM pg_stat_activity
      WHERE pid <> pg_backend_pid() AND cardinality(pg_blocking_pids(pid)) > 0`)).rows as
    Array<{ pid: number; wait_event_type: string | null; query: string; blockers: number[] }>);
  const chained = new Set<number>([barrierPid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) {
      if (!chained.has(r.pid) && r.blockers.some((b) => chained.has(b))) { chained.add(r.pid); grew = true; }
    }
  }
  return rows.filter((r) => chained.has(r.pid));
}

async function untilWaiters(shopId: number, barrierPid: number, count: number) {
  const deadline = Date.now() + BARRIER_WAIT_MS;
  for (;;) {
    const waiting = await waitersBehind(shopId, barrierPid);
    if (waiting.length >= count) return waiting;
    if (Date.now() > deadline) {
      throw new Error(`BARRIER_OVERLAP_NOT_ESTABLISHED: expected ${count} waiter(s), saw ${JSON.stringify(waiting)}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
}

function track<T>(p: PromiseLike<T>) {
  const t = { settled: false, promise: undefined as unknown as Promise<T> };
  t.promise = Promise.resolve(p).finally(() => { t.settled = true; });
  return t;
}

async function racedUnderBarrier(first: 'scan' | 'exception') {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, line, gen } = await legacyBatch(fx);
  const lineId = line.lasyncro_line_item_id;
  const before = await evidence(shopId, batchId);
  const pcBefore = await withTenant(shopId, (trx) => trx('problem_center_tasks').where({ shop_id: shopId }).select('*'));

  let release!: () => void;
  const released = new Promise<void>((r) => { release = r; });
  let locked!: (pid: number) => void;
  const barrierPid = new Promise<number>((r) => { locked = r; });
  const barrier = withTenant(shopId, async (trx) => {
    const owner = await trx('order_line_items').where({ lasyncro_line_item_id: lineId }).first('lasyncro_order_id');
    const row = await trx('orders').where({ shop_id: shopId, lasyncro_order_id: owner.lasyncro_order_id }).forUpdate().first('lasyncro_order_id');
    expect(row?.lasyncro_order_id).toBe(owner.lasyncro_order_id);
    locked((await trx.raw('SELECT pg_backend_pid() AS pid')).rows[0].pid);
    await released;
  });
  const pid = await barrierPid;

  const send = { scan: () => legacyScan(fx.A.token, batchId, line, gen), exception: () => legacyException(fx.A.token, batchId, line, gen) };
  const second = first === 'scan' ? 'exception' : 'scan';
  const r1 = track(send[first]());
  const w1 = await untilWaiters(shopId, pid, 1);
  const r2 = track(send[second]());
  const w2 = await untilWaiters(shopId, pid, 2);

  // Overlap proof: both requests are blocked on the shared orders row lock behind the barrier, neither has answered.
  expect(w2).toHaveLength(2);
  for (const w of w2) {
    expect(w.wait_event_type).toBe('Lock');
    expect(w.query).toMatch(/from "orders"/i);
    expect(w.query).toMatch(/for update/i);
  }
  expect(w2.map((w) => w.pid)).toContain(w1[0].pid);
  expect(w2.find((w) => w.pid === w1[0].pid)!.blockers).toContain(pid);
  expect([r1.settled, r2.settled]).toEqual([false, false]);
  const pending = await lineOutcome(shopId, batchId, lineId);
  expect([pending.scans.length, pending.exceptions.length]).toEqual([0, 0]);
  expect((await evidence(shopId, batchId)).movements).toEqual(before.movements);

  release();
  await barrier;
  const [res1, res2] = await Promise.all([r1.promise, r2.promise]);
  const results = { [first]: res1, [second]: res2 } as Record<'scan' | 'exception', request.Response>;

  // Serialization: the first-queued request wins, the other is refused.
  expect(results[first].status).toBe(201);
  expect(results[second].status).toBe(409);

  const out = await lineOutcome(shopId, batchId, lineId);
  const after = await evidence(shopId, batchId);
  const known = new Set(before.movements.map((m: any) => m.lasyncro_inventory_movement_id));
  const added = after.movements.filter((m: any) => !known.has(m.lasyncro_inventory_movement_id));
  const removals = added.filter((m: any) => m.movement_type === 'pick_removal');
  const ids = after.movements.map((m: any) => m.lasyncro_inventory_movement_id);
  const deviceEvents = after.movements.map((m: any) => m.device_event_id).filter(Boolean);
  expect(new Set(ids).size).toBe(ids.length);
  expect(new Set(deviceEvents).size).toBe(deviceEvents.length);

  if (first === 'scan') {
    expect(out.scans).toHaveLength(1);
    expect(out.exceptions).toHaveLength(0);
    expect(removals).toHaveLength(1);
    expect(removals[0]).toMatchObject({
      reference_type: 'order_line_item', reference_id: lineId, location_code: line.location_code,
      lasyncro_variant_id: line.lasyncro_variant_id, triggered_by: 'pick_scan',
    });
    expect(Number(removals[0].quantity_delta)).toBe(-Number(line.quantity));
    expect(await withTenant(shopId, (trx) => trx('problem_center_tasks').where({ shop_id: shopId }).select('*'))).toEqual(pcBefore);
  } else {
    expect(out.scans).toHaveLength(0);
    expect(out.exceptions).toHaveLength(1);
    expect(removals).toHaveLength(0);
  }
  return { added: added.map((m: any) => m.movement_type), waiters: w2.length };
}

test('C10-F3-03 legacy: scan and exception serialize on the shared orders row lock; exactly one outcome commits', async () => {
  for (const first of ['scan', 'exception', 'scan', 'exception'] as const) {
    const r = await racedUnderBarrier(first);
    expect(r.waiters).toBe(2);
  }
});

test('C10-F3-04 legacy: duplicate scan answers ALREADY_RECORDED for the requester and removes inventory once', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, line, gen } = await legacyBatch(fx);
  expect((await legacyScan(fx.A.token, batchId, line, gen)).status).toBe(201);
  const movementsAfterFirst = (await evidence(shopId, batchId)).movements;
  const again = await legacyScan(fx.A.token, batchId, line, gen);
  expect({ status: again.status, code: again.body.code, mine: again.body.recorded_by_requester })
    .toEqual({ status: 409, code: 'PICK_SCAN_ALREADY_RECORDED', mine: true });
  expect((await evidence(shopId, batchId)).movements).toEqual(movementsAfterFirst);
});

test('C10-F3-05 legacy: an exact exception replay still resolves to the same incident', async () => {
  const fx = await fixture();
  const { batchId, line, gen } = await legacyBatch(fx);
  const eventId = crypto.randomUUID();
  const first = await legacyException(fx.A.token, batchId, line, gen, eventId);
  const replay = await legacyException(fx.A.token, batchId, line, gen, eventId);
  expect(first.status).toBe(201);
  expect(replay.status).toBeLessThan(300);
  expect(replay.body.pick_exception_id ?? replay.body.exception_id).toBe(first.body.pick_exception_id ?? first.body.exception_id);
});

/**
 * SF-PICK-ASSIGN-01 — Correction 003 (REVIEW-001 M1, M2 server side, L1,
 * concurrency). Real routes via createApp + supertest; disposable DB only.
 */
import request from 'supertest';
import crypto from 'crypto';
import {
  app, fixture, release, claim, scan, complete, ageBatch, batchRow, auditRows, evidence,
} from './pick-assign-sf-01.fixture';
import { withTenant } from '@lasyncro/backend-core/db.js';
import { updatePermissions } from 'api-src/services/permissions/permissionSettings.service';

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const packException = (token: string, batchId: string, a: any) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/exception`).set('Authorization', `Bearer ${token}`).send({
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    exception_type: 'item_missing', stage: 'pack', quantity_required: 1, quantity_found: 0,
    device_event_id: crypto.randomUUID(),
  });

// C010 (REVIEW-006 F1): recovery sends the generation the client holds.
const pickSession = (token: string, batchId: string, held?: string) => {
  const r = request(app).get(`/api/v1/wms/batch/${batchId}/pick-session`).set('Authorization', `Bearer ${token}`);
  return held === undefined ? r : r.set('X-Pick-Claim-Generation', held);
};

const problemTasks = (shopId: number) =>
  withTenant(shopId, (trx) => trx('problem_center_tasks').where({ shop_id: shopId }).select('*'));

// ── M1 ───────────────────────────────────────────────────────────────────────

test('C3-01 a pack-stage exception on a batch still picking is refused before any effect (owner or not)', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  expect((await claim(fx.A.token, batchId)).status).toBe(200);
  const before = await evidence(shopId, batchId);
  const tasksBefore = (await problemTasks(shopId)).length;

  for (const token of [fx.B.token, fx.A.token]) {
    const res = await packException(token, batchId, allocations[0]);
    expect({ status: res.status, code: res.body.code }).toEqual({ status: 409, code: 'EXCEPTION_STAGE_MISMATCH' });
  }
  expect(await evidence(shopId, batchId)).toEqual(before);
  expect((await problemTasks(shopId)).length).toBe(tasksBefore);
});

test('C3-02 a legitimate pack-stage exception after pick completion is still accepted', async () => {
  const fx = await fixture();
  const { batchId, allocations } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  for (const a of allocations) expect((await scan(fx.A.token, batchId, a, gen)).status).toBe(201);
  expect((await complete(fx.A.token, batchId, gen)).status).toBe(200);

  const res = await packException(fx.B.token, batchId, allocations[0]);
  expect(res.status).toBe(201);
});

// ── M2 (server) ─────────────────────────────────────────────────────────────

test('C3-03 pick-session resume is read-only: owner gets the current generation, nobody else can take over through it', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);

  const pending = await pickSession(fx.A.token, batchId);
  expect({ status: pending.status, code: pending.body.code }).toEqual({ status: 409, code: 'PICK_BATCH_NOT_PICKING' });
  expect((await batchRow(shopId, batchId)).status).toBe('pending');

  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const own = await pickSession(fx.A.token, batchId, gen);
  expect(own.status).toBe(200);
  expect(own.body).toMatchObject({ pick_batch_id: batchId, pick_claim_generation: gen, custody_ack_required: false });

  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const rowBefore = await batchRow(shopId, batchId);
  const foreign = await pickSession(fx.B.token, batchId);
  expect({ status: foreign.status, code: foreign.body.code, gen: foreign.body.pick_claim_generation })
    .toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED', gen: undefined });
  expect(await batchRow(shopId, batchId)).toEqual(rowBefore);
  expect(await auditRows(shopId, batchId, 'pick_takeover')).toHaveLength(0);
});

// ── Concurrency ─────────────────────────────────────────────────────────────
// C004 (REVIEW-002 F1/F2): DB-level ownership proofs. Movement deltas are
// computed by row identity (lasyncro_inventory_movement_id), never by position.

const meta = (r: any) => (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata);

type Evidence = Awaited<ReturnType<typeof evidence>>;
/** Movements present in `after` but not in `before`, by row identity. */
const addedMovements = (before: Evidence, after: Evidence) => {
  const seen = new Set(before.movements.map((m: any) => m.lasyncro_inventory_movement_id));
  return after.movements.filter((m: any) => !seen.has(m.lasyncro_inventory_movement_id));
};

/**
 * A successful scan, proved by row identity (never position):
 *  - exactly one pick_removal and one reservation_release, nothing else, none removed;
 *  - each with the scanned quantity, variant, source location, reference and operator;
 *  - exactly one new pick_scan_log row, attributed to the scanning operator and
 *    linked to this batch, allocation and the pick_removal movement;
 *  - inventory_truth: on_hand and reserved drop by the quantity at the scanned
 *    (variant, location) only; every other truth row is unchanged.
 */
function expectScanMovements(
  before: Evidence, after: Evidence, scanBody: any,
  ctx: { batchId: string; allocation: any; operatorId: number },
) {
  const a = ctx.allocation;
  const qty = Number(a.quantity);
  const added = addedMovements(before, after);
  expect(after.movements).toHaveLength(before.movements.length + added.length); // nothing removed
  expect(added.map((m: any) => m.movement_type).sort()).toEqual(['pick_removal', 'reservation_release']);

  const removal = added.find((m: any) => m.movement_type === 'pick_removal');
  const release = added.find((m: any) => m.movement_type === 'reservation_release');
  expect(removal.lasyncro_inventory_movement_id).toBe(scanBody.inventory_movement_id);
  const common = { lasyncro_variant_id: a.lasyncro_variant_id, location_code: a.location_code, operator_id: ctx.operatorId, triggered_by: 'pick_scan' };
  expect({ ...pickFields(removal), quantity_delta: Number(removal.quantity_delta) }).toEqual({
    ...common, quantity_delta: -qty, reference_type: 'order_line_item', reference_id: a.lasyncro_line_item_id,
  });
  expect({ ...pickFields(release), quantity_delta: Number(release.quantity_delta) }).toEqual({
    ...common, quantity_delta: -qty, reference_type: 'pick_reservation_allocation', reference_id: a.allocation_id,
  });

  const scansAdded = after.scans.filter((x: any) => !before.scans.some((b: any) => b.scan_id === x.scan_id));
  expect(scansAdded).toHaveLength(1);
  const row = scansAdded[0];
  expect({
    scan_id: row.scan_id, pick_batch_id: row.pick_batch_id, scanned_by: row.scanned_by,
    inventory_movement_id: row.inventory_movement_id, reservation_allocation_id: row.reservation_allocation_id,
    lasyncro_line_item_id: row.lasyncro_line_item_id, lasyncro_variant_id: row.lasyncro_variant_id,
    location_code: row.location_code, quantity_confirmed: Number(row.quantity_confirmed),
  }).toEqual({
    scan_id: scanBody.scan_id, pick_batch_id: ctx.batchId, scanned_by: ctx.operatorId,
    inventory_movement_id: removal.lasyncro_inventory_movement_id, reservation_allocation_id: a.allocation_id,
    lasyncro_line_item_id: a.lasyncro_line_item_id, lasyncro_variant_id: a.lasyncro_variant_id,
    location_code: a.location_code, quantity_confirmed: qty,
  });

  const key = (t: any) => `${t.lasyncro_variant_id}|${t.location_code}`;
  const qtys = (rows: any[]) => new Map(rows.map((t: any) => [key(t), { on_hand: Number(t.on_hand_quantity), reserved: Number(t.reserved_quantity) }]));
  const tb = qtys(before.truth); const ta = qtys(after.truth);
  expect([...ta.keys()].sort()).toEqual([...tb.keys()].sort());
  const scanned = `${a.lasyncro_variant_id}|${a.location_code}`;
  for (const [k, v] of tb) {
    const expected = k === scanned ? { on_hand: v.on_hand - qty, reserved: v.reserved - qty } : v;
    expect({ k, ...ta.get(k)! }).toEqual({ k, ...expected });
  }
}

const pickFields = (m: any) => ({
  lasyncro_variant_id: m.lasyncro_variant_id, location_code: m.location_code, operator_id: m.operator_id,
  triggered_by: m.triggered_by, reference_type: m.reference_type, reference_id: m.reference_id,
});

/** Exactly one successful takeover from `prevGen` to `winner`, recorded consistently. */
async function expectSingleTakeover(shopId: number, batchId: string, prevGen: string, winner: { userId: number }, winBody: any) {
  const row = await batchRow(shopId, batchId);
  expect(row.picked_by).toBe(winner.userId);
  expect(typeof winBody.pick_claim_generation).toBe('string');
  expect(row.pick_claim_generation).toBe(winBody.pick_claim_generation);
  expect(row.pick_claim_generation).not.toBe(prevGen);
  const audits = await auditRows(shopId, batchId, 'pick_takeover');
  expect(audits).toHaveLength(1);
  expect(meta(audits[0])).toMatchObject({
    previous_claim_generation: prevGen,
    new_claim_generation: row.pick_claim_generation,
    new_picked_by: winner.userId,
  });
  return row;
}

test('C3-04 two eligible operators take over the same idle batch at once: exactly one wins, rotation once, stale and losing tokens are dead', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect((await scan(fx.A.token, batchId, allocations[0], gen1)).status).toBe(201);
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const before = await evidence(shopId, batchId);

  const [b, c] = await Promise.all([claim(fx.B.token, batchId), claim(fx.C.token, batchId)]);
  const results = [b, c].map((r) => ({ status: r.status, code: r.body.code ?? null }));
  expect(results.filter((r) => r.status === 200)).toHaveLength(1);
  expect(results.filter((r) => r.status === 409 && r.code === 'PICK_ALREADY_CLAIMED')).toHaveLength(1);

  const [win, winner, lose, loser] = b.status === 200 ? [b, fx.B, c, fx.C] : [c, fx.C, b, fx.B];
  expect(lose.body.pick_claim_generation).toBeUndefined(); // the loser never receives a token
  const row = await expectSingleTakeover(shopId, batchId, gen1, winner, win.body);
  expect(row.pick_custody_ack_required).toBe(true);
  expect(await evidence(shopId, batchId)).toEqual(before);

  // The former owner's stale generation is refused and writes nothing.
  const staleA = await scan(fx.A.token, batchId, allocations[1], gen1);
  expect({ status: staleA.status, code: staleA.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
  // The losing operator cannot use the winner's generation.
  const loserScan = await scan(loser.token, batchId, allocations[1], row.pick_claim_generation);
  expect({ status: loserScan.status, code: loserScan.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });

  expect(await evidence(shopId, batchId)).toEqual(before);
  const after = await batchRow(shopId, batchId);
  expect({ by: after.picked_by, gen: after.pick_claim_generation }).toEqual({ by: winner.userId, gen: row.pick_claim_generation });
  expect(await auditRows(shopId, batchId, 'pick_takeover')).toHaveLength(1);
});

test('C3-05a scan-first (deterministic): the owner scan commits and resets activity; the takeover is refused and changes nothing', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const before = await evidence(shopId, batchId);
  const agedRow = await batchRow(shopId, batchId);

  const s = await scan(fx.A.token, batchId, allocations[0], gen1);
  expect(s.status).toBe(201);
  const afterScan = await evidence(shopId, batchId);
  expectScanMovements(before, afterScan, s.body, { batchId, allocation: allocations[0], operatorId: fx.A.userId });
  expect(afterScan.unitsPicked).toBe(before.unitsPicked + Number(allocations[0].quantity));
  const rowAfterScan = await batchRow(shopId, batchId);
  // Activity reset: the 31-minute-old clock moved forward by roughly that much.
  expect(new Date(rowAfterScan.pick_last_activity_at).getTime() - new Date(agedRow.pick_last_activity_at).getTime())
    .toBeGreaterThan(30 * 60 * 1000);

  const t = await claim(fx.B.token, batchId);
  expect({ status: t.status, code: t.body.code, gen: t.body.pick_claim_generation })
    .toEqual({ status: 409, code: 'PICK_ALREADY_CLAIMED', gen: undefined });

  const row = await batchRow(shopId, batchId);
  expect({ by: row.picked_by, gen: row.pick_claim_generation }).toEqual({ by: fx.A.userId, gen: gen1 });
  expect(await auditRows(shopId, batchId, 'pick_takeover')).toHaveLength(0);
  expect(await evidence(shopId, batchId)).toEqual(afterScan);
});

test('C3-05b takeover-first (deterministic): the takeover commits; the former owner\'s scan is refused with no inventory change', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const before = await evidence(shopId, batchId);

  const t = await claim(fx.B.token, batchId);
  expect(t.status).toBe(200);
  expect(t.body.custody_ack_required).toBe(false); // nothing picked yet
  const row = await expectSingleTakeover(shopId, batchId, gen1, fx.B, t.body);

  const s = await scan(fx.A.token, batchId, allocations[0], gen1);
  expect({ status: s.status, code: s.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
  expect(await evidence(shopId, batchId)).toEqual(before);
  expect((await batchRow(shopId, batchId)).pick_claim_generation).toBe(row.pick_claim_generation);

  // The new owner's generation works, proving the refusal was ownership, not data.
  const sB = await scan(fx.B.token, batchId, allocations[0], row.pick_claim_generation);
  expect(sB.status).toBe(201);
  expectScanMovements(before, await evidence(shopId, batchId), sB.body, { batchId, allocation: allocations[0], operatorId: fx.B.userId });
});

test('C3-05c concurrent owner scan vs takeover (additional): exactly one commits, the loser leaves no trace', async () => {
  for (let round = 0; round < 3; round++) {
    const fx = await fixture();
    const shopId = fx.shop.shopId;
    const { batchId, allocations } = await release(fx);
    const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
    await ageBatch(shopId, batchId, { idleMinutes: 31 });
    const before = await evidence(shopId, batchId);

    const [s, t] = await Promise.all([scan(fx.A.token, batchId, allocations[0], gen1), claim(fx.B.token, batchId)]);
    expect([s.status === 201, t.status === 200].filter(Boolean)).toHaveLength(1);
    const after = await evidence(shopId, batchId);
    const row = await batchRow(shopId, batchId);

    if (s.status === 201) {
      expect({ status: t.status, code: t.body.code }).toEqual({ status: 409, code: 'PICK_ALREADY_CLAIMED' });
      expectScanMovements(before, after, s.body, { batchId, allocation: allocations[0], operatorId: fx.A.userId });
      expect({ by: row.picked_by, gen: row.pick_claim_generation }).toEqual({ by: fx.A.userId, gen: gen1 });
      expect(await auditRows(shopId, batchId, 'pick_takeover')).toHaveLength(0);
    } else {
      expect({ status: s.status, code: s.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
      expect(after).toEqual(before);
      await expectSingleTakeover(shopId, batchId, gen1, fx.B, t.body);
    }
  }
});

// ── L1 ──────────────────────────────────────────────────────────────────────

test('C3-06 a pending claim requires Pick scan eligibility as well as claim permission', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  const result = await updatePermissions(shopId, [{ action: 'wms:pick:scan', role: 'operator', granted: false }]);
  expect(result.rejected).toEqual([]);

  const res = await claim(fx.A.token, batchId);
  expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code: 'INVALID_PICK_ASSIGNEE' });
  const row = await batchRow(shopId, batchId);
  expect({ status: row.status, by: row.picked_by }).toEqual({ status: 'pending', by: null });
  expect(await auditRows(shopId, batchId, 'pick_claim')).toHaveLength(0);
});

// ── C006 (REVIEW-004 MEDIUM-3) — already-recorded scans ──────────────────────

test('C3-07 committed scan + lost response: the owner\'s replay is answered as already recorded for them and writes nothing', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  const first = await scan(fx.A.token, batchId, allocations[0], gen);
  expect(first.status).toBe(201);
  const committed = await evidence(shopId, batchId);

  // The client never saw `first` (lost response) and replays the identical request.
  const replay = await scan(fx.A.token, batchId, allocations[0], gen);
  expect({ status: replay.status, body: replay.body }).toMatchObject({
    status: 409,
    body: {
      code: 'PICK_SCAN_ALREADY_RECORDED',
      recorded_by_requester: true,
      scan_id: first.body.scan_id,
      reservation_allocation_id: allocations[0].allocation_id,
    },
  });
  expect(await evidence(shopId, batchId)).toEqual(committed);         // no duplicate movement, scan or truth change
});

test('C3-08 after a takeover: the new owner replaying the same task learns it was recorded by someone else; the former owner stays fenced', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const genA = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect((await scan(fx.A.token, batchId, allocations[0], genA)).status).toBe(201);
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const take = await claim(fx.B.token, batchId);
  expect(take.status).toBe(200);
  const genB = take.body.pick_claim_generation;
  expect((await request(app).post(`/api/v1/wms/batch/${batchId}/custody-ack`).set('Authorization', `Bearer ${fx.B.token}`)
    .send({ pick_claim_generation: genB })).status).toBe(200);
  const recorded = await evidence(shopId, batchId);

  const replayB = await scan(fx.B.token, batchId, allocations[0], genB);
  expect({ status: replayB.status, code: replayB.body.code, mine: replayB.body.recorded_by_requester })
    .toEqual({ status: 409, code: 'PICK_SCAN_ALREADY_RECORDED', mine: false });

  const replayA = await scan(fx.A.token, batchId, allocations[0], genA);
  expect({ status: replayA.status, code: replayA.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
  expect(replayA.body.recorded_by_requester).toBeUndefined();          // nothing disclosed past the fence
  expect(await evidence(shopId, batchId)).toEqual(recorded);
});

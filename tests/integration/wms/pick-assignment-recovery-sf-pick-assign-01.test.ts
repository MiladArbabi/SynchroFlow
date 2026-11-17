/**
 * SF-PICK-ASSIGN-01 — Pick assignment, idle recovery and ownership safety.
 * Real routes via createApp + supertest; disposable DB only (with-test-db.js).
 *
 * Time is simulated by moving the batch's own clocks (pick_last_activity_at,
 * pick_assigned_at) backwards — the same columns production reads.
 */
import {
  app, fixture, release, createMember, seedOrder, claim, assign, scan, ack, complete, shortPick,
  ageBatch, batchRow, auditRows, evidence,
} from './pick-assign-sf-01.fixture';
import request from 'supertest';
import crypto from 'crypto';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';

// Loaded lazily so each test reports its own behavioural RED on a revision
// that predates these modules, instead of failing the whole suite at import.
const runPickRecoveryCycle = (): Promise<unknown> =>
  require('api-src/services/wms/pickRecovery.service').runPickRecoveryCycle();
const resolvePickRecoveryThresholdMinutes = (trx: unknown, shopId: number, batchId: string): Promise<number> =>
  require('api-src/services/wms/pickAssignment.service').resolvePickRecoveryThresholdMinutes(trx, shopId, batchId);

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});


// ── 1. Concurrent claims ─────────────────────────────────────────────────────

test('SPA-01 concurrent claims of an unassigned batch: exactly one owner, one audit row', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx);
  const results = await Promise.all([claim(fx.A.token, batchId), claim(fx.B.token, batchId), claim(fx.C.token, batchId)]);
  const statuses = results.map((r) => r.status).sort();
  expect(statuses).toEqual([200, 409, 409]);
  const winner = results.find((r) => r.status === 200)!;
  expect(typeof winner.body.pick_claim_generation).toBe('string');
  const losers = results.filter((r) => r.status === 409);
  for (const l of losers) expect(l.body.code).toBe('PICK_ALREADY_CLAIMED');
  const row = await batchRow(fx.shop.shopId, batchId);
  const winnerId = [fx.A, fx.B, fx.C][results.indexOf(winner)].userId;
  expect(row.picked_by).toBe(winnerId);
  expect(row.pick_claim_generation).toBe(winner.body.pick_claim_generation);
  expect(await auditRows(fx.shop.shopId, batchId, 'pick_claim')).toHaveLength(1);
});

// ── 2. Assignment, permissions, tenant isolation ─────────────────────────────

test('SPA-02 assigned batch is claimable only by the assignee; same-owner reclaim is idempotent', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx, fx.A.userId);
  expect((await batchRow(fx.shop.shopId, batchId)).pick_assigned_at).not.toBeNull();
  const byB = await claim(fx.B.token, batchId);
  expect({ status: byB.status, code: byB.body.code }).toEqual({ status: 409, code: 'PICK_ASSIGNED_TO_OTHER' });
  const byA = await claim(fx.A.token, batchId);
  expect(byA.status).toBe(200);
  const again = await claim(fx.A.token, batchId);
  expect(again.status).toBe(200);
  expect(again.body.pick_claim_generation).toBe(byA.body.pick_claim_generation);
});

test('SPA-03 release-time assignee must be an eligible member of this shop; invalid rolls the release back', async () => {
  const fx = await fixture();
  const foreignShopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `spa-foreign-${crypto.randomBytes(4).toString('hex')}`);
    await setTenantContext(trx, id);
    return id;
  });
  const foreign = await createMember(foreignShopId, 'foreign');
  const revoked = await createMember(fx.shop.shopId, 'revoked');
  await withTenant(fx.shop.shopId, (trx) =>
    trx('shop_memberships').where({ shop_id: fx.shop.shopId, user_id: revoked.userId }).update({ revoked_at: new Date() }));
  const before = await withTenant(fx.shop.shopId, (trx) => trx('pick_batches').where({ shop_id: fx.shop.shopId }).count('* as n').first());

  for (const assignee of [foreign.userId, revoked.userId, 999999999]) {
    const o = await seedOrder(fx.shop.shopId, fx.variants[0], 1);
    const res = await request(app).post('/api/v1/wms/batch/release').set('Authorization', `Bearer ${fx.shop.ownerToken}`)
      .send({ priority_order_ids: [o], exclusive: true, assigned_operator_id: assignee });
    expect({ status: res.status, code: res.body.code }).toEqual({ status: 400, code: 'INVALID_PICK_ASSIGNEE' });
  }
  const after = await withTenant(fx.shop.shopId, (trx) => trx('pick_batches').where({ shop_id: fx.shop.shopId }).count('* as n').first());
  expect(Number(after!.n)).toBe(Number(before!.n));
});

test('SPA-04 assignment is owner/admin only, audited, and tenant-isolated', async () => {
  const fx = await fixture();
  const other = await fixture();
  const { batchId } = await release(fx);

  const byOperator = await assign(fx.A.token, batchId, fx.B.userId);
  expect(byOperator.status).toBe(403);

  const byOwner = await assign(fx.shop.ownerToken, batchId, fx.B.userId);
  expect(byOwner.status).toBe(200);
  expect(byOwner.body.batch.assigned_operator_id).toBe(fx.B.userId);
  const audits = await auditRows(fx.shop.shopId, batchId, 'pick_assign');
  expect(audits).toHaveLength(1);
  expect(audits[0].operator_id).toBe(fx.shop.ownerId);

  const crossTenant = await assign(other.shop.ownerToken, batchId, other.A.userId);
  expect(crossTenant.status).toBe(404);
  const foreignAssignee = await assign(fx.shop.ownerToken, batchId, other.A.userId);
  expect({ status: foreignAssignee.status, code: foreignAssignee.body.code }).toEqual({ status: 400, code: 'INVALID_PICK_ASSIGNEE' });
  expect((await batchRow(fx.shop.shopId, batchId)).assigned_operator_id).toBe(fx.B.userId);

  const toPool = await assign(fx.shop.ownerToken, batchId, null);
  expect(toPool.status).toBe(200);
  const row = await batchRow(fx.shop.shopId, batchId);
  expect({ a: row.assigned_operator_id, at: row.pick_assigned_at }).toEqual({ a: null, at: null });
  expect((await claim(fx.C.token, batchId)).status).toBe(200);
});

// ── 3. Expiry and takeover thresholds ────────────────────────────────────────

test('SPA-05 unclaimed assignment expires at the recovery threshold (29 keeps, 30 expires) and becomes first-to-claim', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx, fx.A.userId);
  const idleAlertBefore = await withTenant(fx.shop.shopId, (trx) =>
    trx('shop_wms_settings').where({ shop_id: fx.shop.shopId }).first('idle_alert_threshold_minutes'));

  await ageBatch(fx.shop.shopId, batchId, { assignedMinutes: 29 });
  await runPickRecoveryCycle();
  expect((await batchRow(fx.shop.shopId, batchId)).assigned_operator_id).toBe(fx.A.userId);
  expect((await claim(fx.B.token, batchId)).body.code).toBe('PICK_ASSIGNED_TO_OTHER');

  await ageBatch(fx.shop.shopId, batchId, { assignedMinutes: 30 });
  await runPickRecoveryCycle();
  const row = await batchRow(fx.shop.shopId, batchId);
  expect({ a: row.assigned_operator_id, at: row.pick_assigned_at, by: row.picked_by }).toEqual({ a: null, at: null, by: null });
  const expired = await auditRows(fx.shop.shopId, batchId, 'pick_assignment_expired');
  expect(expired).toHaveLength(1);
  expect(expired[0].metadata).toMatchObject({ previous_assigned_operator_id: fx.A.userId, threshold_minutes: 30 });

  expect((await claim(fx.B.token, batchId)).status).toBe(200);
  const idleAlertAfter = await withTenant(fx.shop.shopId, (trx) =>
    trx('shop_wms_settings').where({ shop_id: fx.shop.shopId }).first('idle_alert_threshold_minutes'));
  expect(idleAlertAfter).toEqual(idleAlertBefore);
});

test('SPA-06 a batch spanning warehouses uses the MAX threshold; legacy default warehouse otherwise', async () => {
  const fx = await fixture();
  const { batchId, allocations } = await release(fx);
  const shopId = fx.shop.shopId;

  const second = await withTenant(shopId, async (trx) => {
    const code = `WH2-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const [wh] = await trx('warehouses')
      .insert({ shop_id: shopId, name: `Second ${code}`, root_location_code: code, is_default: false, active: true, pick_recovery_threshold_minutes: 45 })
      .returning('warehouse_id');
    const warehouseId = (wh as any).warehouse_id ?? wh;
    await trx('warehouse_locations').insert({
      shop_id: shopId, warehouse_id: warehouseId, location_code: code, type: 'warehouse', active: true,
    });
    return { warehouseId, code };
  });
  await withTenant(shopId, (trx) =>
    trx('warehouses').where({ shop_id: shopId, is_default: true }).update({ pick_recovery_threshold_minutes: 20 }));

  const resolve = () => withTenant(shopId, (trx) => resolvePickRecoveryThresholdMinutes(trx, shopId, batchId));
  expect(await resolve()).toBe(20);

  // Point one allocation at the second warehouse (fixture-only relocation).
  await withTenant(shopId, (trx) =>
    trx('pick_reservation_allocations').where({ allocation_id: allocations[0].allocation_id }).update({ location_code: second.code }));
  expect(await resolve()).toBe(45);

  expect((await claim(fx.A.token, batchId)).status).toBe(200);
  await ageBatch(shopId, batchId, { idleMinutes: 30 });
  const early = await claim(fx.B.token, batchId);
  expect({ status: early.status, code: early.body.code, threshold: early.body.threshold_minutes })
    .toEqual({ status: 409, code: 'PICK_ALREADY_CLAIMED', threshold: 45 });
  await ageBatch(shopId, batchId, { idleMinutes: 45 });
  expect((await claim(fx.B.token, batchId)).status).toBe(200);
});

test('SPA-07 no early forced takeover: below threshold both self-claim and owner reassign are refused', async () => {
  const fx = await fixture();
  const { batchId } = await release(fx);
  expect((await claim(fx.A.token, batchId)).status).toBe(200);
  await ageBatch(fx.shop.shopId, batchId, { idleMinutes: 29 });
  const self = await claim(fx.B.token, batchId);
  expect({ status: self.status, code: self.body.code }).toEqual({ status: 409, code: 'PICK_ALREADY_CLAIMED' });
  const owner = await assign(fx.shop.ownerToken, batchId, fx.B.userId);
  expect({ status: owner.status, code: owner.body.code }).toEqual({ status: 409, code: 'PICK_NOT_IDLE' });
  expect((await batchRow(fx.shop.shopId, batchId)).picked_by).toBe(fx.A.userId);
});

// ── 4/5/6. Takeover with progress, generation fence, custody acknowledgement ──

test('SPA-08 idle takeover of a partially picked batch preserves all evidence, revokes the previous owner and requires custody ack', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const a1 = await claim(fx.A.token, batchId);
  const gen1 = a1.body.pick_claim_generation;
  const first = await scan(fx.A.token, batchId, allocations[0], gen1);
  expect(first.status).toBe(201);

  await withTenant(shopId, (trx) => trx('alerts').insert({
    shop_id: shopId, alert_key: `wms:idle:pick:${fx.A.userId}`, source: 'wms', alert_type: 'wms_operator_idle',
    severity: 'warning', title: 'idle', message: 'idle', entity_id: batchId, entity_type: 'pick_batch', is_active: true,
  }));

  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const before = await evidence(shopId, batchId);
  expect(before.unitsPicked).toBeGreaterThan(0);

  const takeover = await claim(fx.B.token, batchId);
  expect(takeover.status).toBe(200);
  expect(takeover.body).toMatchObject({ custody_ack_required: true, takeover: { previous_picked_by: fx.A.userId } });
  const gen2 = takeover.body.pick_claim_generation;
  expect(gen2).not.toBe(gen1);

  expect(await evidence(shopId, batchId)).toEqual(before);
  const row = await batchRow(shopId, batchId);
  expect({ by: row.picked_by, as: row.assigned_operator_id, ack: row.pick_custody_ack_required })
    .toEqual({ by: fx.B.userId, as: fx.B.userId, ack: true });

  const takeoverAudit = await auditRows(shopId, batchId, 'pick_takeover');
  expect(takeoverAudit).toHaveLength(1);
  expect(takeoverAudit[0].metadata).toMatchObject({ previous_picked_by: fx.A.userId, new_picked_by: fx.B.userId, threshold_minutes: 30 });
  const alert = await withTenant(shopId, (trx) => trx('alerts').where({ shop_id: shopId, alert_key: `wms:idle:pick:${fx.A.userId}` }).first());
  expect(alert.is_active).toBe(false);

  const stale = await scan(fx.A.token, batchId, allocations[1], gen1);
  expect({ status: stale.status, code: stale.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });

  const beforeAck = await scan(fx.B.token, batchId, allocations[1], gen2);
  expect({ status: beforeAck.status, code: beforeAck.body.code }).toEqual({ status: 409, code: 'PICK_CUSTODY_ACK_REQUIRED' });
  expect(await evidence(shopId, batchId)).toEqual(before);

  expect((await ack(fx.A.token, batchId, gen1)).status).toBe(409);
  const acked = await ack(fx.B.token, batchId, gen2);
  expect(acked.status).toBe(200);
  expect(await auditRows(shopId, batchId, 'pick_custody_ack')).toHaveLength(1);

  const resumed = await scan(fx.B.token, batchId, allocations[1], gen2);
  expect(resumed.status).toBe(201);
  expect((await complete(fx.B.token, batchId, gen2)).status).toBe(200);
});

test('SPA-09 A → B → A cycle: generations rotate and the first session can never write again', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const toB = await claim(fx.B.token, batchId);
  expect(toB.body.custody_ack_required).toBe(false);
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const backToA = await claim(fx.A.token, batchId);
  expect(backToA.status).toBe(200);
  const gen3 = backToA.body.pick_claim_generation;
  expect(new Set([gen1, toB.body.pick_claim_generation, gen3]).size).toBe(3);

  const replay = await scan(fx.A.token, batchId, allocations[0], gen1);
  expect({ status: replay.status, code: replay.body.code }).toEqual({ status: 409, code: 'PICK_GENERATION_STALE' });
  const missing = await scan(fx.A.token, batchId, allocations[0]);
  expect({ status: missing.status, code: missing.body.code }).toEqual({ status: 409, code: 'PICK_GENERATION_REQUIRED' });
  expect((await scan(fx.A.token, batchId, allocations[0], gen3)).status).toBe(201);
});

test('SPA-10 revoked owner cannot record a short pick or complete; zero inventory written', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;

  const foreignShort = await shortPick(fx.B.token, batchId, allocations[0], gen1);
  expect({ status: foreignShort.status, code: foreignShort.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });

  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  expect((await claim(fx.B.token, batchId)).status).toBe(200);
  const before = await evidence(shopId, batchId);

  const staleShort = await shortPick(fx.A.token, batchId, allocations[0], gen1);
  expect({ status: staleShort.status, code: staleShort.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
  const staleComplete = await complete(fx.A.token, batchId, gen1);
  expect({ status: staleComplete.status, code: staleComplete.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
  expect(await evidence(shopId, batchId)).toEqual(before);
});

test('SPA-11 owner reassign of an idle batch keeps custody with the current picker until the assignee claims', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await ageBatch(shopId, batchId, { idleMinutes: 31 });

  const reassigned = await assign(fx.shop.ownerToken, batchId, fx.B.userId);
  expect(reassigned.status).toBe(200);
  expect(reassigned.body.batch).toMatchObject({ picked_by: fx.A.userId, assigned_operator_id: fx.B.userId });
  expect(await auditRows(shopId, batchId, 'pick_reassign')).toHaveLength(1);

  // A still owns it and resumes: allowed, and the activity clock moves.
  expect((await scan(fx.A.token, batchId, allocations[0], gen1)).status).toBe(201);
  expect((await claim(fx.B.token, batchId)).body.code).toBe('PICK_ALREADY_CLAIMED');

  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  expect((await claim(fx.C.token, batchId)).body.code).toBe('PICK_ASSIGNED_TO_OTHER');
  const byB = await claim(fx.B.token, batchId);
  expect(byB.status).toBe(200);
  expect(byB.body.custody_ack_required).toBe(true);
});

// ── 7. Settings ──────────────────────────────────────────────────────────────

test('SPA-12 per-warehouse recovery threshold: owner/admin only, range-checked, tenant-scoped', async () => {
  const fx = await fixture();
  const other = await fixture();
  const list = await request(app).get('/api/v1/settings/shop/warehouses/pick-recovery').set('Authorization', `Bearer ${fx.shop.ownerToken}`);
  expect(list.status).toBe(200);
  const wh = list.body.warehouses.find((w: any) => w.is_default);
  expect(wh.pick_recovery_threshold_minutes).toBe(30);
  const url = `/api/v1/settings/shop/warehouses/${wh.warehouse_id}/pick-recovery`;

  expect((await request(app).patch(url).set('Authorization', `Bearer ${fx.A.token}`).send({ pick_recovery_threshold_minutes: 40 })).status).toBe(403);
  expect((await request(app).patch(url).set('Authorization', `Bearer ${fx.shop.ownerToken}`).send({ pick_recovery_threshold_minutes: 4 })).status).toBe(400);
  expect((await request(app).patch(url).set('Authorization', `Bearer ${other.shop.ownerToken}`).send({ pick_recovery_threshold_minutes: 40 })).status).toBe(404);
  const ok = await request(app).patch(url).set('Authorization', `Bearer ${fx.shop.ownerToken}`).send({ pick_recovery_threshold_minutes: 40 });
  expect(ok.status).toBe(200);
  expect(ok.body.warehouse.pick_recovery_threshold_minutes).toBe(40);
});

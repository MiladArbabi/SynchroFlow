/**
 * SF-PICK-RESUME-GENERATION-001 — POST /wms/batch/:batchId/claim with
 * resume_only=true. Fresh-session resume for the rightful operator: returns the
 * existing generation only when status=picking AND picked_by=caller; never
 * rotates, never claims pending work, never takes over, writes nothing.
 * Real routes via createApp + supertest; disposable DB only.
 */
import request from 'supertest';
import {
  app, fixture, release, claim, scan, ageBatch, batchRow, auditRows, evidence,
} from './pick-assign-sf-01.fixture';

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const resume = (token: string, batchId: string, value: unknown = true) =>
  request(app).post(`/api/v1/wms/batch/${batchId}/claim`).set('Authorization', `Bearer ${token}`).send({ resume_only: value });

const CLAIM_AUDIT_TYPES = ['pick_claim', 'pick_takeover'];
const claimAudits = async (shopId: number, batchId: string) =>
  (await Promise.all(CLAIM_AUDIT_TYPES.map((t) => auditRows(shopId, batchId, t)))).flat().length;

/** Full no-write proof: batch row (ownership, generation, activity), inventory/progress evidence, claim audits. */
async function snapshot(shopId: number, batchId: string) {
  return { row: await batchRow(shopId, batchId), ev: await evidence(shopId, batchId), audits: await claimAudits(shopId, batchId) };
}

test('RG-01 same owner, fresh session: resume_only returns the existing generation unchanged and writes nothing', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const gen = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect((await scan(fx.A.token, batchId, allocations[0], gen)).status).toBe(201);

  const before = await snapshot(shopId, batchId);
  const res = await resume(fx.A.token, batchId);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({
    pick_batch_id: batchId, status: 'picking', pick_claim_generation: gen, custody_ack_required: false, takeover: null,
  });
  expect(res.body.notifications).toBeUndefined();
  expect(await snapshot(shopId, batchId)).toEqual(before);

  // The resumed generation is the live one: the next product scans exactly once.
  const next = await scan(fx.A.token, batchId, allocations[1], res.body.pick_claim_generation);
  expect(next.status).toBe(201);
  const after = await evidence(shopId, batchId);
  expect(after.movements.length - before.ev.movements.length).toBe(2); // pick_removal + reservation_release
  expect(after.scans.length - before.ev.scans.length).toBe(1);
});

test('RG-02 another operator holding an ACTIVE batch: refused PICK_OWNERSHIP_REVOKED, nothing written', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  expect((await claim(fx.A.token, batchId)).status).toBe(200);

  const before = await snapshot(shopId, batchId);
  const res = await resume(fx.B.token, batchId);
  expect({ status: res.status, code: res.body.code, gen: res.body.pick_claim_generation })
    .toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED', gen: undefined });
  expect(await snapshot(shopId, batchId)).toEqual(before);
});

test('RG-03 another operator holding an IDLE batch (takeover-eligible): resume_only never takes over', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);
  expect((await claim(fx.A.token, batchId)).status).toBe(200);
  await ageBatch(shopId, batchId, { idleMinutes: 31 });

  const before = await snapshot(shopId, batchId);
  const res = await resume(fx.B.token, batchId);
  expect({ status: res.status, code: res.body.code, gen: res.body.pick_claim_generation })
    .toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED', gen: undefined });
  expect(await snapshot(shopId, batchId)).toEqual(before);
  expect(await auditRows(shopId, batchId, 'pick_takeover')).toHaveLength(0);

  // Eligibility was real: the explicit (non-resume) claim still takes over.
  const takeover = await claim(fx.B.token, batchId);
  expect(takeover.status).toBe(200);
  expect(takeover.body.takeover).toMatchObject({ previous_picked_by: fx.A.userId });
});

test('RG-04 pending batch (unassigned or assigned to caller): refused PICK_BATCH_NOT_PICKING, never claimed', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  for (const assigned of [undefined, fx.A.userId]) {
    const { batchId } = await release(fx, assigned);
    const before = await snapshot(shopId, batchId);
    const res = await resume(fx.A.token, batchId);
    expect({ status: res.status, code: res.body.code, gen: res.body.pick_claim_generation })
      .toEqual({ status: 409, code: 'PICK_BATCH_NOT_PICKING', gen: undefined });
    const after = await snapshot(shopId, batchId);
    expect(after).toEqual(before);
    expect({ status: after.row.status, picked_by: after.row.picked_by }).toEqual({ status: 'pending', picked_by: null });
  }
});

test('RG-05 A→B→A: resume returns the newest generation; every historical generation stays invalid; no duplicate movements', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId, allocations } = await release(fx);
  const g1 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const g2 = (await claim(fx.B.token, batchId)).body.pick_claim_generation;
  await ageBatch(shopId, batchId, { idleMinutes: 31 });
  const g3 = (await claim(fx.A.token, batchId)).body.pick_claim_generation;
  expect(new Set([g1, g2, g3]).size).toBe(3);

  const res = await resume(fx.A.token, batchId);
  expect({ status: res.status, gen: res.body.pick_claim_generation }).toEqual({ status: 200, gen: g3 });

  const before = await evidence(shopId, batchId);
  for (const historical of [g1, g2]) {
    const stale = await scan(fx.A.token, batchId, allocations[0], historical);
    expect({ status: stale.status, code: stale.body.code }).toEqual({ status: 409, code: 'PICK_GENERATION_STALE' });
  }
  const b = await scan(fx.B.token, batchId, allocations[0], g2);
  expect({ status: b.status, code: b.body.code }).toEqual({ status: 409, code: 'PICK_OWNERSHIP_REVOKED' });
  expect(await evidence(shopId, batchId)).toEqual(before);

  expect((await scan(fx.A.token, batchId, allocations[0], g3)).status).toBe(201);
  const replay = await scan(fx.A.token, batchId, allocations[0], g3);
  const after = await evidence(shopId, batchId);
  expect(after.movements.length - before.movements.length).toBe(2);
  expect(after.scans.length - before.scans.length).toBe(1);
  expect(replay.status).not.toBe(201);
});

test('RG-06 normal claim unchanged: absent or false resume_only claims a pending batch; non-boolean is refused', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;
  const { batchId } = await release(fx);

  const bad = await resume(fx.A.token, batchId, 'true');
  expect({ status: bad.status, code: bad.body.code }).toEqual({ status: 400, code: 'INVALID_RESUME_ONLY' });
  expect((await batchRow(shopId, batchId)).status).toBe('pending');

  const res = await resume(fx.A.token, batchId, false);
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ status: 'picking', takeover: null });
  expect(await auditRows(shopId, batchId, 'pick_claim')).toHaveLength(1);

  const { batchId: other } = await release(fx);
  expect((await claim(fx.B.token, other)).status).toBe(200);
  expect((await batchRow(shopId, other)).picked_by).toBe(fx.B.userId);
});

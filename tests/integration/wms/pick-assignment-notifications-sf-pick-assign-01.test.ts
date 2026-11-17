/**
 * SF-PICK-ASSIGN-01 — targeted, post-commit Pick notifications.
 * Real routes and DB; only the push transport (dispatchNotification) is
 * replaced so delivery targets can be asserted. At call time the mock reads the
 * batch from a separate connection: it can only see the change once committed.
 */
import { withTenant } from '@lasyncro/backend-core/db.js';
import {
  fixture, release, seedOrder, claim, assign, ageBatch, app,
} from './pick-assign-sf-01.fixture';
import request from 'supertest';

const calls: Array<{ params: any; committed: Record<string, unknown> | null }> = [];

jest.mock('api-src/services/notifications/notificationDispatch.service', () => ({
  dispatchNotification: jest.fn(async (params: any) => {
    const batchId = params?.payload?.data?.batchId;
    let committed: Record<string, unknown> | null = null;
    if (batchId) {
      const { withTenant: wt } = require('@lasyncro/backend-core/db.js');
      committed = await wt(params.shopId, (trx: any) =>
        trx('pick_batches').where({ pick_batch_id: batchId })
          .first('picked_by', 'assigned_operator_id', 'status'));
    }
    calls.push({ params, committed: committed ?? null });
  }),
}));

const runPickRecoveryCycle = (): Promise<unknown> =>
  require('api-src/services/wms/pickRecovery.service').runPickRecoveryCycle();

jest.setTimeout(240000);

beforeAll(() => {
  process.env.SHOPIFY_API_SECRET = process.env.SHOPIFY_API_SECRET || 'test_shopify_secret';
  process.env.SHOPIFY_API_KEY = process.env.SHOPIFY_API_KEY || 'test_shopify_key';
  process.env.API_URL = process.env.API_URL || 'https://api.test';
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

beforeEach(() => { calls.length = 0; });

const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
const forBatch = (batchId: string) => calls.filter((c) => c.params?.payload?.data?.batchId === batchId);

test('SPN-01 assigned release notifies only the assignee, after commit; unassigned broadcasts to operators', async () => {
  const fx = await fixture();
  const assigned = await release(fx, fx.A.userId);
  await settle();
  const a = forBatch(assigned.batchId);
  expect(a).toHaveLength(1);
  expect(a[0].params.targetUserIds).toEqual([fx.A.userId]);
  expect(a[0].params.broadcastToRole).toBeUndefined();
  expect(a[0].committed).toMatchObject({ assigned_operator_id: fx.A.userId, status: 'pending' });

  const open = await release(fx);
  await settle();
  const o = forBatch(open.batchId);
  expect(o).toHaveLength(1);
  expect(o[0].params).toMatchObject({ broadcastToRole: 'operator' });
  expect(o[0].params.targetUserIds).toBeUndefined();
});

test('SPN-02 a rolled-back release (invalid assignee) notifies nobody', async () => {
  const fx = await fixture();
  const orderId = await seedOrder(fx.shop.shopId, fx.variants[0], 1);
  const res = await request(app).post('/api/v1/wms/batch/release').set('Authorization', `Bearer ${fx.shop.ownerToken}`)
    .send({ priority_order_ids: [orderId], exclusive: true, assigned_operator_id: 999999999 });
  expect(res.status).toBe(400);
  await settle();
  expect(calls).toHaveLength(0);
});

test('SPN-03 assignment, takeover and expiry notify the affected operators after commit', async () => {
  const fx = await fixture();
  const shopId = fx.shop.shopId;

  const pending = await release(fx);
  await settle(); calls.length = 0;
  expect((await assign(fx.shop.ownerToken, pending.batchId, fx.B.userId)).status).toBe(200);
  await settle();
  expect(forBatch(pending.batchId).map((c) => c.params.targetUserIds)).toEqual([[fx.B.userId]]);
  expect(forBatch(pending.batchId)[0].committed).toMatchObject({ assigned_operator_id: fx.B.userId });

  calls.length = 0;
  await ageBatch(shopId, pending.batchId, { assignedMinutes: 31 });
  await runPickRecoveryCycle();
  await settle();
  const expiry = forBatch(pending.batchId);
  expect(expiry).toHaveLength(1);
  expect(expiry[0].params).toMatchObject({ broadcastToRole: 'operator' });
  expect(expiry[0].committed).toMatchObject({ assigned_operator_id: null });

  const active = await release(fx);
  expect((await claim(fx.A.token, active.batchId)).status).toBe(200);
  await ageBatch(shopId, active.batchId, { idleMinutes: 31 });
  await settle(); calls.length = 0;
  expect((await claim(fx.B.token, active.batchId)).status).toBe(200);
  await settle();
  const takeover = forBatch(active.batchId);
  expect(takeover.map((c) => c.params.targetUserIds)).toEqual([[fx.A.userId]]);
  expect(takeover[0].committed).toMatchObject({ picked_by: fx.B.userId });

  const audit = await withTenant(shopId, (trx) =>
    trx('operator_audit_log').where({ shop_id: shopId, entity_id: active.batchId, action_type: 'pick_takeover' }));
  expect(audit).toHaveLength(1);
});

//tests/unit/backend/lifecycle/ft0.confirm.test.ts
import request from 'supertest';
import app from 'api-server';
import db from '@lasyncro/backend-core/db.js';
import { issueTestToken } from '../../helpers/auth';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

describe('POST /api/v1/lifecycle/ft0/confirm', () => {
  const userId = 1001;
  const shopId = 2001;
  let token: string;

  beforeEach(async () => {
  await db('user_lifecycle_snapshot').where({ user_id: userId }).del();
  await db('lifecycle_audit_events').where({ user_id: userId }).del();
  await db('ft0_state').where({ shop_id: shopId }).del();
  await db('shop_memberships').del();
  await db('users').del();
  await db('shops').del();

  await seedShopAndUser({ shopId, userId });

  token = issueTestToken({ userId, shopId });
});

  it('creates FT0 lifecycle snapshot when FT0 is completed', async () => {
    await db('ft0_state').insert({
      shop_id: shopId,
      status: 'COMPLETED',
      completed_at: db.fn.now(),
    });

    const res = await request(app)
      .post('/api/v1/lifecycle/ft0/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.phase).toBe('FT0');

    const snapshot = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first();

    expect(snapshot.phase).toBe('FT0');
  });

  it('rejects FT0 confirm if FT0 is not completed', async () => {
    const res = await request(app)
      .post('/api/v1/lifecycle/ft0/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(res.body.error).toMatch(/FT0 not completed/i);
  });

  it('is idempotent', async () => {
    await db('ft0_state').insert({
      shop_id: shopId,
      status: 'COMPLETED',
      completed_at: db.fn.now(),
    });

    await request(app)
      .post('/api/v1/lifecycle/ft0/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app)
      .post('/api/v1/lifecycle/ft0/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const audits = await db('lifecycle_audit_events')
      .where({ user_id: userId, to_phase: 'FT0' });

    expect(audits.length).toBe(1);
  });
});
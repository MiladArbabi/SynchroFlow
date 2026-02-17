import request from 'supertest';
import app from 'api-server';
import db from '@lasyncro/backend-core/db.js';
import { issueTestToken } from '../../helpers/auth';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';

describe('POST /api/v1/lifecycle/ft1/confirm', () => {
  const userId = 1101;
  const shopId = 2101;
  let token: string;

  beforeEach(async () => {
    await db('user_lifecycle_snapshot').where({ user_id: userId }).del();
    await db('lifecycle_audit_events').where({ user_id: userId }).del();
    await db('shop_memberships').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId, userId });
    token = issueTestToken({ userId, shopId });
  });

  it('confirms FT1 while snapshot remains FT0', async () => {
    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT0',
    });

    const res = await request(app)
      .post('/api/v1/lifecycle/ft1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body.phase).toBe('FT1');

    const snapshot = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first();

    // FT1 is NOT a snapshot phase
    expect(snapshot.phase).toBe('FT0');
  });

  it('rejects FT1 confirm if lifecycle snapshot is missing', async () => {
    const res = await request(app)
      .post('/api/v1/lifecycle/ft1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(409);

    expect(res.body.error).toMatch(/snapshot missing/i);
  });

  it('is idempotent and produces no audit events', async () => {
    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT0',
    });

    await request(app)
      .post('/api/v1/lifecycle/ft1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await request(app)
      .post('/api/v1/lifecycle/ft1/confirm')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const audits = await db('lifecycle_audit_events')
      .where({ user_id: userId, to_phase: 'FT1' });

    // FT1 never produces lifecycle audits
    expect(audits.length).toBe(0);
  });
});

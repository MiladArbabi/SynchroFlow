// tests/unit/backend/lifecycle/ft2.confirm.writes-authority.test.ts

import request from 'supertest';
import db from '@lasyncro/backend-core/db.js';
import app from 'api-server';
import crypto from 'crypto';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

jest.mock('api-src/services/ft2-evaluator.service', () => ({
  FT2EvaluatorService: {
    evaluate: jest.fn(async () => ({
      eligible: true,
      blockers: [],
      evaluatorVersion: 'test',
    })),
  },
}));

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { userId: 2101 }; // MUST match seeded user
    next();
  },
}));

describe('FT2 confirm authority', () => {
  const userId = 2101;      // MUST match test auth identity
  const shopId = 10001;     // int32-safe

  beforeEach(async () => {
    // hard cleanup — FK-safe order
    await db('lifecycle_audit_events').where({ user_id: userId }).del();
    await db('user_lifecycle_snapshot').where({ user_id: userId }).del();
    await db('shop_memberships').where({ shop_id: shopId }).del();
    await db('users').where({ id: userId }).del();
    await db('shops').where({ id: shopId }).del();
  });

  it('writes FT2 snapshot and audit event on confirm', async () => {
    await seedShopAndUser({ shopId, userId });

    await db('user_lifecycle_snapshot').insert({
      user_id: userId,
      shop_id: shopId,
      phase: 'FT1',
      since: db.fn.now(),
      last_event_id: crypto.randomUUID(),
    });

    await db('lifecycle_audit_events').insert({
      event_id: crypto.randomUUID(),
      user_id: userId,
      shop_id: shopId,
      from_phase: 'FT0',
      to_phase: 'FT1',
      occurred_at: db.fn.now(),
    });

    const res = await request(app)
      .post('/api/v1/lifecycle/ft2/confirm')
      .set('Authorization', 'Bearer test-token');

    expect(res.status).toBe(200);

    const snapshot = await db('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first();

    expect(snapshot.phase).toBe('FT2');

    const audit = await db('lifecycle_audit_events')
      .where({ user_id: userId, to_phase: 'FT2' })
      .first();

    expect(audit).toBeTruthy();
  });
});

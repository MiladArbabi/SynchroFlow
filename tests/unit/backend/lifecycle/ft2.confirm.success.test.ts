import request from 'supertest';
import db from '@lasyncro/backend-core/db.js';
import server from 'api-server';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';
import { randomUUID } from 'crypto';

jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: 2201, shop_id: 1201 };
    next();
  },
}));

jest.mock('api-src/services/ft2-evaluator.service');

describe('FT2 confirm endpoint — happy path', () => {
  const shopId = 1201;
  const userId = 2201;

  beforeEach(async () => {
    jest.clearAllMocks();

    await db('lifecycle_audit_events').del();
    await db('user_lifecycle_snapshot').del();
    await db('ft2_state').del();
    await db('ft0_state').del();
    await db('integrations').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });

    // FT0 completed (data prerequisite only)
    await db('ft0_state').insert({
      shop_id: shopId,
      completed_at: new Date().toISOString(),
      status: 'COMPLETED',
    });

    // 🔒 AUTHORITATIVE lifecycle snapshot at FT1
    await db('user_lifecycle_snapshot').insert({
      user_id: userId,
      shop_id: shopId,
      phase: 'FT1',
      since: new Date(),
      last_event_id: randomUUID(), // ✅ valid UUID
      updated_at: new Date(),
    });

    (FT2EvaluatorService.evaluate as jest.Mock).mockResolvedValue({
      eligible: true,
      status: 'ELIGIBLE',
      blockers: [],
      evidence: { orders: { count: 10 } },
      evaluatorVersion: 'test-evaluator',
      evaluatedAt: new Date().toISOString(),
    });
  });

  it('promotes FT1 → FT2 after explicit confirmation', async () => {
    const res = await request(server)
      .post('/api/v1/lifecycle/ft2/confirm')
      .expect(200);

    expect(res.body.phase).toBe('FT2');

    const ft2 = await db('ft2_state').where({ shop_id: shopId }).first();
    expect(ft2).toBeTruthy();
    expect(ft2.evaluator_version).toBe('test-evaluator');
    expect(ft2.evaluation_snapshot).toBeTruthy();

    const audits = await db('lifecycle_audit_events')
      .where({ user_id: userId, to_phase: 'FT2' });

    expect(audits.length).toBe(0);
  });
});

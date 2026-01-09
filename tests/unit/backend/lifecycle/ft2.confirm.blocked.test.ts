jest.mock('api-src/services/shop-resolution.service', () => ({
  requireShopContextForUser: jest.fn().mockResolvedValue({ shopId: 1301 }),
}));

jest.mock('api-src/services/lifecycle-transition.service', () => ({
  LifecycleTransitionService: {
    auditIfTransitioned: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('api-src/services/lifecycle.service', () => ({
  LifecycleService: {
    resolveForUser: jest.fn().mockResolvedValue('FT1'),
  },
}));


import request from 'supertest';
import db from 'api-src/db';
import server from 'api-server';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';

// Bypass auth for test
jest.mock('api-src/middleware/auth.middleware', () => ({
  authenticateToken: (req, _res, next) => {
    req.user = { userId: 2301 };
    next();
  },
}));

// Force FT1 complete
jest.mock('api-src/onboarding/readiness.service', () => ({
  OnboardingReadinessService: jest.fn().mockImplementation(() => ({
    getSnapshot: async () => ({
      ft1: { isComplete: true },
    }),
  })),
}));

jest.mock('api-src/services/ft2-evaluator.service');

describe('FT2 confirm endpoint — blocked when not eligible', () => {
  const shopId = 1301;
  const userId = 2301;

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

    await db('ft0_state').insert({
      shop_id: shopId,
      completed_at: new Date().toISOString(),
      status: 'COMPLETED',
    });

    // Force evaluator to block
    (FT2EvaluatorService.evaluate as jest.Mock).mockResolvedValue({
      eligible: false,
      status: 'BLOCKED',
      blockers: [
        {
          category: 'DATA_COVERAGE',
          domain: 'ORDERS',
          reason: 'No canonical orders present',
        },
      ],
      evidence: {},
      evaluatorVersion: 'test-evaluator',
      evaluatedAt: new Date().toISOString(),
    });
  });

  it('rejects confirmation and does not promote', async () => {
    await request(server)
      .post('/api/v1/lifecycle/ft2/confirm')
      .expect(409);

    const ft2 = await db('ft2_state').where({ shop_id: shopId });
    expect(ft2.length).toBe(0);

    const audits = await db('lifecycle_audit_events')
      .where({ user_id: userId, to_phase: 'FT2' });
    expect(audits.length).toBe(0);

    // Lifecycle still FT1
    const lifecycleRes = await request(server)
      .get('/api/v1/lifecycle')
      .expect(200);

    expect(['FT_MINUS_ONE', 'FT0', 'FT1']).toContain(lifecycleRes.body.phase);
  });
});

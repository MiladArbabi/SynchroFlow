//tests/unit/backend/lifecycle/ft2.confirm.required.test.ts
import db from 'api-src/db';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';

jest.mock('api-src/onboarding/readiness.service', () => ({
  OnboardingReadinessService: jest.fn().mockImplementation(() => ({
    getSnapshot: async () => ({
      ft1: { isComplete: true },
    }),
  })),
}));

jest.mock('api-src/services/ft2-evaluator.service');

describe('FT2 promotion — explicit confirmation required', () => {
  const shopId = 1101;
  const userId = 2101;

  beforeEach(async () => {
    jest.clearAllMocks();

    await db('ft2_state').del();
    await db('ft0_state').del();
    await db('integrations').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });

    // Valid FT0 latch
    await db('ft0_state').insert({
      shop_id: shopId,
      completed_at: new Date().toISOString(),
      status: 'COMPLETED',
    });

    // Force evaluator to say eligible
    (FT2EvaluatorService.evaluate as jest.Mock).mockResolvedValue({
      eligible: true,
      status: 'ELIGIBLE',
      blockers: [],
      evidence: {},
      evaluatorVersion: 'test',
      evaluatedAt: new Date().toISOString(),
    });
  });

  it('does not enter FT2 without explicit confirmation', async () => {
    const phase = await LifecycleService.resolveForUser(userId);

    expect(phase).not.toBe('FT2');

    const ft2Rows = await db('ft2_state').where({ shop_id: shopId });
    expect(ft2Rows.length).toBe(0);
  });
});
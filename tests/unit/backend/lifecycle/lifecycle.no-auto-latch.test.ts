//tests/unit/backend/lifecycle/lifecycle.no-auto-latch.test.ts
import db from 'api-src/db';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import { FT2LatchService } from 'api-src/services/ft2-latch.service';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';

jest.mock('api-src/services/ft2-latch.service');
jest.mock('api-src/onboarding/readiness.service', () => ({
  OnboardingReadinessService: jest.fn().mockImplementation(() => ({
    getSnapshot: async () => ({
      ft1: { isComplete: true },
    }),
  })),
}));

describe('LifecycleService — no auto FT2 latch', () => {
  const shopId = 1001;
  const userId = 2001;

  beforeEach(async () => {
    jest.clearAllMocks();

    await db('ft2_state').del();
    await db('ft0_state').del();
    await db('integrations').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });

    // Simulate FT0 completed
    await db('ft0_state').insert({
      shop_id: shopId,
      completed_at: new Date().toISOString(),
      status: 'COMPLETED',
    });
  });

  it('does not evaluate or write FT2 latch during lifecycle resolution', async () => {
    await LifecycleService.resolveForUser(userId);

    // Assert — no latch evaluation
    expect(FT2LatchService.evaluateAndLatch).not.toHaveBeenCalled();

    // Assert — no ft2_state written
    const ft2Rows = await db('ft2_state').where({ shop_id: shopId });
    expect(ft2Rows.length).toBe(0);
  });
});

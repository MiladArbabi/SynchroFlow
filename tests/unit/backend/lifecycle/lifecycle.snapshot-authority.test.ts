import db from 'api-db';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';
import crypto from 'crypto';

const eventId = crypto.randomUUID();

jest.mock('api-src/onboarding/readiness.service');

describe('Lifecycle snapshot authority', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    await db('user_lifecycle_snapshot').truncate();
  });

  it('does NOT upgrade lifecycle based on readiness when snapshot is FT0', async () => {
    const userId = 1;
    const shopId = 10;

    await db('user_lifecycle_snapshot').insert({
    user_id: userId,
    shop_id: shopId,
    phase: 'FT0',
    since: db.fn.now(),
    last_event_id: eventId,
    });


    (OnboardingReadinessService.prototype.getSnapshot as jest.Mock).mockResolvedValue({
      ft1: { isComplete: true },
    });

    const phase = await LifecycleService.resolveForUser(userId);

    expect(phase).toBe('FT0');
    expect(OnboardingReadinessService.prototype.getSnapshot).not.toHaveBeenCalled();
  });
});
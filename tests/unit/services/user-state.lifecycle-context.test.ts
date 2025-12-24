//tests/unit/services/user-state.lifecycle-context.test.ts
// tests/unit/services/user-state.lifecycle-context.test.ts

import { UserStateService } from 'api-src/services/user-state.service';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';
import { OnboardingReadinessService } from 'api-src/onboarding/readiness.service';

jest.mock('api-src/services/lifecycle.service');
jest.mock('api-src/onboarding/readiness.service');
jest.mock('api-src/services/lifecycle-transition.service');

describe('UserStateService.getLifecycleContext', () => {
  const userId = 123;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns lifecycle + readiness + userState facts only', async () => {
    // Arrange
    (LifecycleService.resolveForUser as jest.Mock).mockResolvedValue('FT1');

    (OnboardingReadinessService.prototype.getSnapshot as jest.Mock).mockResolvedValue({
      shopId: 10,
      modules: [],
      ft1: { isComplete: true, blockingModules: [], readyModules: [] },
    });

    jest.spyOn(UserStateService, 'getUserState').mockResolvedValue({
        user: { id: userId, shop_id: 10 },
        milestones: [],
        current_mode: 'survival',
    } as any);

    // Act
    const result = await (UserStateService as any).getLifecycleContext(userId);

    // Assert – shape
    expect(result).toEqual({
      lifecyclePhase: 'FT1',
      readinessSnapshot: expect.any(Object),
      userState: expect.any(Object),
    });

    // Assert – calls
    expect(LifecycleService.resolveForUser).toHaveBeenCalledWith(userId);
    expect(OnboardingReadinessService.prototype.getSnapshot).toHaveBeenCalled();
    expect(UserStateService.getUserState).toHaveBeenCalledWith(userId);

    // Assert – forbidden behavior
    expect(LifecycleTransitionService.auditIfTransitioned).not.toHaveBeenCalled();

    expect(result).not.toHaveProperty('tier');
    expect(result).not.toHaveProperty('recommendedNextSteps');
    expect(result).not.toHaveProperty('unlockedFeatures');

  });
});

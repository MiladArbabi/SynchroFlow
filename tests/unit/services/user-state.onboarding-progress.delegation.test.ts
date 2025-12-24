// tests/unit/services/user-state.onboarding-progress.delegation.test.ts

import { UserStateService } from 'api-src/services/user-state.service';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';

jest.mock('api-src/services/lifecycle.service');
jest.mock('api-src/services/lifecycle-transition.service');

describe('UserStateService.getOnboardingProgress delegation', () => {
  const userId = 123;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('delegates lifecycle resolution to getLifecycleContext and does not own lifecycle authority', async () => {
    // Arrange — isolate dependencies
    jest
      .spyOn(UserStateService as any, 'getLifecycleContext')
      .mockResolvedValue({
        lifecyclePhase: 'FT1',
        readinessSnapshot: null,
        userState: { user: { id: userId } },
      });

    jest
      .spyOn(UserStateService, 'getUserState')
      .mockResolvedValue({
        user: { id: userId },
        milestones: [],
        current_mode: 'survival',
      } as any);

    // Act
    await UserStateService.getOnboardingProgress(userId);

    // Assert — delegation
    expect(
      (UserStateService as any).getLifecycleContext
    ).toHaveBeenCalledWith(userId);

    // Assert — forbidden lifecycle ownership
    expect(LifecycleService.resolveForUser).not.toHaveBeenCalled();
    expect(LifecycleTransitionService.auditIfTransitioned).not.toHaveBeenCalled();
  });
});

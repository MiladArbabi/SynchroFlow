// tests/unit/services/user-state.onboarding-progress.no-ownership.test.ts

import { UserStateService } from 'api-src/services/user-state.service';
import { LifecycleService } from 'api-src/services/lifecycle.service';

jest.mock('api-src/services/lifecycle.service');

describe('UserStateService.getOnboardingProgress — no ownership', () => {
  const userId = 123;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not derive onboarding tiers, features, or recommendations', async () => {
    // Arrange — stub lifecycle so function can proceed
    (LifecycleService.resolveForUser as jest.Mock).mockResolvedValue('FT0');

    // Stub user state to avoid DB access
    jest.spyOn(UserStateService, 'getUserState').mockResolvedValue({
      user: { id: userId },
      milestones: [],
      current_mode: 'survival',
    } as any);

    // Spy on forbidden internal helpers
    const detectTierSpy = jest.spyOn(UserStateService, 'detectOnboardingTier');
    const platformsSpy = jest.spyOn(UserStateService, 'getConnectedPlatforms');

    const recommendationsSpy = jest.spyOn(UserStateService as any, 'getRecommendedNextSteps');
    const featuresSpy = jest.spyOn(UserStateService as any, 'getUnlockedFeatures');

    // Act
    await UserStateService.getOnboardingProgress(userId);

    // Assert — lifecycle ownership only
    expect(LifecycleService.resolveForUser).toHaveBeenCalledWith(userId);

    // Assert — forbidden derivations
    expect(detectTierSpy).not.toHaveBeenCalled();
    expect(platformsSpy).not.toHaveBeenCalled();
    expect(recommendationsSpy).not.toHaveBeenCalled();
    expect(featuresSpy).not.toHaveBeenCalled();
  });
});

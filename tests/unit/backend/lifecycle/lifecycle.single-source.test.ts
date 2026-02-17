// tests/unit/backend/lifecycle/lifecycle.single-source.test.ts

import { UserStateService } from 'api-src/services/user-state.service';
import { LifecycleService } from 'api-src/services/lifecycle.service';
import db from '@lasyncro/backend-core/db.js';

// ─────────────────────────────────────────────
// HARD ISOLATION — NO REAL DB, NO REAL LIFECYCLE
// ─────────────────────────────────────────────
jest.mock('api-src/db', () => jest.fn());

jest.mock('api-src/services/lifecycle.service', () => ({
  LifecycleService: {
    resolveForUser: jest.fn(),
  },
}));

describe('UserStateService MUST delegate lifecycle to LifecycleService', () => {
  const userId = 1;

  beforeEach(() => {
    jest.clearAllMocks();

    // Prevent ANY accidental DB execution
    (db as unknown as jest.Mock).mockImplementation(() => {
      throw new Error('DB access is forbidden in this test');
    });
  });

  it('delegates lifecycle resolution to LifecycleService', async () => {
    // Arrange
    (LifecycleService.resolveForUser as jest.Mock).mockResolvedValue('FT1');

    // Stub internal UserStateService dependencies
    jest
      .spyOn(UserStateService as any, 'detectOnboardingTier')
      .mockResolvedValue('BASIC_ACCESS');

    jest
      .spyOn(UserStateService as any, 'getConnectedPlatforms')
      .mockResolvedValue([]);

    jest
      .spyOn(UserStateService as any, 'getUserState')
      .mockResolvedValue({});

    // Act
    await UserStateService.getOnboardingProgress(userId);

    // Assert — THIS IS THE CONTRACT
    expect(LifecycleService.resolveForUser).toHaveBeenCalledWith(userId);
  });
});
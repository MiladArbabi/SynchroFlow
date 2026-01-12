// tests/unit/backend/lifecycle/lifecycle.service.test.ts
import { LifecycleService } from 'api-src/services/lifecycle.service';
import db from 'api-src/db';

jest.mock('api-src/db', () => jest.fn());

const mockDb = db as unknown as jest.Mock;

describe('LifecycleService.resolveForUser (snapshot authority)', () => {
  const userId = 1;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns FT_MINUS_ONE when no lifecycle snapshot exists', async () => {
    mockDb.mockImplementation(() => ({
      where: () => ({
        first: () => null,
      }),
    }));

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT_MINUS_ONE');
  });

  it('returns snapshot phase when lifecycle snapshot exists', async () => {
    mockDb.mockImplementation(() => ({
      where: () => ({
        first: () => ({
          user_id: userId,
          phase: 'FT0',
        }),
      }),
    }));

    const phase = await LifecycleService.resolveForUser(userId);
    expect(phase).toBe('FT0');
  });
});

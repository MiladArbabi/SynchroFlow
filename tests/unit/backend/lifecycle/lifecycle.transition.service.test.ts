// tests/unit/backend/lifecycle/lifecycle.transition.service.test.ts

import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';
import db from 'api-src/db';

jest.mock('api-src/db', () => {
  const mockDb: any = jest.fn();
  mockDb.fn = {
    now: jest.fn(() => 'NOW'),
  };
  return mockDb;
});

const mockDb = db as unknown as jest.Mock;

describe('LifecycleTransitionService (unit)', () => {
  const userId = 1;
  const shopId = 10;

  let insertSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    insertSpy = jest.fn().mockResolvedValue(undefined);
  });

  function mockDbOnce({
    lastPhase,
    existingTransition,
  }: {
    lastPhase: string | null;
    existingTransition: boolean;
  }) {
    mockDb.mockImplementation(() => ({
      where: () => ({
        orderBy: () => ({
          first: () =>
            lastPhase ? { to_phase: lastPhase } : null,
        }),
        first: () =>
          existingTransition ? { id: 'existing-event' } : null,
      }),
      insert: insertSpy,
    }));
  }

  it('writes audit when FT0 → FT1', async () => {
    mockDbOnce({ lastPhase: 'FT0', existingTransition: false });

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT1',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('writes audit when FT1 → FT2', async () => {
    mockDbOnce({ lastPhase: 'FT1', existingTransition: false });

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT2',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
  });

  it('does NOT write when phase is unchanged', async () => {
    mockDbOnce({ lastPhase: 'FT1', existingTransition: false });

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT1',
    });

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('does NOT write for FT_MINUS_ONE → FT0', async () => {
    mockDbOnce({ lastPhase: null, existingTransition: false });

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT0',
    });

    expect(insertSpy).not.toHaveBeenCalled();
  });

  it('is idempotent across calls for the same transition', async () => {
    // First call → no existing transition → insert
    mockDbOnce({ lastPhase: 'FT1', existingTransition: false });

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT2',
    });

    // Second call → transition already exists → no insert
    mockDbOnce({ lastPhase: 'FT1', existingTransition: true });

    await LifecycleTransitionService.auditIfTransitioned({
      userId,
      shopId,
      currentPhase: 'FT2',
    });

    expect(insertSpy).toHaveBeenCalledTimes(1);
  });
});

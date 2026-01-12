// tests/unit/backend/lifecycle/lifecycle.transition.service.test.ts

import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';
import db from 'api-src/db';

jest.mock('api-src/db', () => {
  const mockDb: any = jest.fn();
  mockDb.fn = { now: jest.fn(() => 'NOW') };
  return mockDb;
});

const mockDb = db as unknown as jest.Mock;

describe('LifecycleTransitionService — passive audit projection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('records FT0 → FT1 transition when explicitly invoked', async () => {
    const insertAuditSpy = jest.fn().mockResolvedValue(undefined);
    const insertSnapshotSpy = jest.fn().mockResolvedValue(undefined);

    mockDb.mockImplementation((table: string) => {
      if (table === 'lifecycle_audit_events') {
        return {
          where: () => ({
            orderBy: () => ({
              first: () => ({ to_phase: 'FT0' }),
            }),
            first: () => null,
          }),
          insert: insertAuditSpy,
          onConflict: () => ({ ignore: jest.fn() }),
        };
      }

      if (table === 'user_lifecycle_snapshot') {
        return {
          insert: () => ({
            onConflict: () => ({
              merge: insertSnapshotSpy,
            }),
          }),
        };
      }

      return {};
    });

    await LifecycleTransitionService.auditIfTransitioned({
      userId: 1,
      shopId: 10,
      currentPhase: 'FT1',
    });

    expect(insertAuditSpy).toHaveBeenCalledTimes(1);
  });

  it('does not write duplicate audit for the same transition', async () => {
    const insertAuditSpy = jest.fn();

    mockDb.mockImplementation((table: string) => {
      if (table === 'lifecycle_audit_events') {
        return {
          where: () => ({
            orderBy: () => ({
              first: () => ({ to_phase: 'FT1' }),
            }),
            first: () => ({ id: 'existing' }),
          }),
          insert: insertAuditSpy,
        };
      }

      return {};
    });

    await LifecycleTransitionService.auditIfTransitioned({
      userId: 1,
      shopId: 10,
      currentPhase: 'FT1',
    });

    expect(insertAuditSpy).not.toHaveBeenCalled();
  });
});
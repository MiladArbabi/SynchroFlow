//tests/unit/backend/lifecycle/ft2.confirm.audit.test.ts

import { confirmFt2, evaluateFt2 } from 'api-src/api/lifecycle/lifecycle.controller';
import { LifecycleTransitionService } from 'api-src/services/lifecycle-transition.service';
import db from 'api-src/db';

jest.mock('api-src/db', () => {
  const mockDb: any = jest.fn();
  mockDb.fn = { now: jest.fn(() => 'NOW') };
  return mockDb;
});

jest.mock('api-src/services/ft2-evaluator.service', () => ({
  FT2EvaluatorService: {
    evaluate: jest.fn(async () => ({
      eligible: true,
      blockers: [],
      evaluatorVersion: 'test',
    })),
  },
}));

jest.mock('api-src/services/shop-resolution.service', () => ({
  requireShopContextForUser: jest.fn(async () => ({ shopId: 10 })),
}));

const mockDb = db as unknown as jest.Mock;

function mockReqRes(userId = 1) {
  const req: any = {
    user: { userId },
  };

  const res: any = {
    status: jest.fn(() => res),
    json: jest.fn(),
  };

  return { req, res };
}

describe('FT1 → FT2 audit (RED)', () => {
  let insertAuditSpy: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    insertAuditSpy = jest.fn().mockResolvedValue(undefined);

    mockDb.mockImplementation((table: string) => {
      if (table === 'lifecycle_audit_events') {
        return {
          where: () => ({
            orderBy: () => ({
              first: () => ({ to_phase: 'FT1' }),
            }),
            first: () => null,
          }),
          insert: insertAuditSpy,
          onConflict: () => ({ ignore: jest.fn() }),
        };
      }

      if (table === 'ft2_state') {
        return {
          insert: jest.fn(() => ({
            onConflict: () => ({ ignore: jest.fn() }),
          })),
        };
      }

      if (table === 'user_lifecycle_snapshot') {
        return {
          insert: jest.fn(() => ({
            onConflict: () => ({ merge: jest.fn() }),
          })),
        };
      }

      return {};
    });
  });

  it('writes exactly one audit event on FT1 → FT2 confirm', async () => {
    const { req, res } = mockReqRes();

    await confirmFt2(req, res);

    expect(insertAuditSpy).toHaveBeenCalledTimes(1);
  });

  it('does not write duplicate audit on repeated FT2 confirm', async () => {
    const { req, res } = mockReqRes();

    // first call → audit exists
    await confirmFt2(req, res);

    // simulate existing audit on second call
    mockDb.mockImplementation((table: string) => {
      if (table === 'lifecycle_audit_events') {
        return {
          where: () => ({
            orderBy: () => ({
              first: () => ({ to_phase: 'FT2' }),
            }),
            first: () => ({ id: 'existing' }),
          }),
          insert: insertAuditSpy,
          onConflict: () => ({ ignore: jest.fn() }),
        };
      }
      return {};
    });

    await confirmFt2(req, res);

    expect(insertAuditSpy).toHaveBeenCalledTimes(1);
  });

  it('does not write audit when FT2 eligibility is evaluated but not confirmed', async () => {
    const { req, res } = mockReqRes();

    await evaluateFt2(req, res);

    expect(insertAuditSpy).not.toHaveBeenCalled();
  });

  it('does not write audit when lifecycle resolves FT1 with paid entitlements only', async () => {
    // simulate lifecycle resolve path only — no confirmFt2 call
    await LifecycleTransitionService.auditIfTransitioned({
      userId: 1,
      shopId: 10,
      currentPhase: 'FT1',
    });

    expect(insertAuditSpy).not.toHaveBeenCalled();
  });
});
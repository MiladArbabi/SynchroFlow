// tests/unit/backend/lifecycle/ft2.confirm.audit.test.ts

import { confirmFt2, evaluateFt2 } from 'api-src/api/lifecycle/lifecycle.controller';
import { FT2EvaluatorService } from 'api-src/services/ft2-evaluator.service';
import db from '@lasyncro/backend-core/db.js';

jest.mock('api-src/db', () => {
  const mockDb: any = jest.fn();
  mockDb.fn = { now: jest.fn(() => 'NOW') };
  return mockDb;
});

jest.mock('api-src/services/ft2-evaluator.service', () => ({
  FT2EvaluatorService: {
    evaluate: jest.fn(),
  },
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

describe('FT2 confirm — audit invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not write audit when FT2 eligibility is evaluated but not confirmed', async () => {
    const insertAuditSpy = jest.fn();

    mockDb.mockImplementation((table: string) => {
      if (table === 'lifecycle_audit_events') {
        return {
          where: () => ({
            orderBy: () => ({
              first: () => null,
            }),
          }),
          insert: insertAuditSpy,
        };
      }

      if (table === 'shop_memberships') {
        return {
          where: () => ({
            whereNull: () => ({
              select: () => [{ shopId: 10, role: 'owner' }],
            }),
          }),
        };
      }

      return {};
    });

    (FT2EvaluatorService.evaluate as jest.Mock).mockResolvedValue({
      eligible: true,
      blockers: [],
      evaluatorVersion: 'test',
    });

    const { req, res } = mockReqRes();

    await evaluateFt2(req, res);

    expect(insertAuditSpy).not.toHaveBeenCalled();
  });
});
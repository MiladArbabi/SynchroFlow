import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { financesFt2Controller } from 'api-src/api/finances/finances.ft2.controller';
import { getFinancesFt2Snapshot } from 'api-src/services/finances-ft2.provider';
import type { FinancesFT2Exposure } from 'api-src/services/finances-ftep';

// ---- Mock FT2 provider (typed) ----
jest.mock('api-src/services/finances-ft2.provider', () => ({
  getFinancesFt2Snapshot: jest.fn(),
}));

const mockGetFinancesFt2Snapshot =
  getFinancesFt2Snapshot as jest.MockedFunction<
    typeof getFinancesFt2Snapshot
  >;

// ---- Minimal Express-like mocks (NO express types) ----
type MockRequest = {
  query?: Record<string, unknown>;
  user?: {
    shopId?: number;
  };
};

type MockResponse = {
  status: jest.Mock;
  json: jest.Mock;
};

describe('Finances FT2 Controller', () => {
  let req: MockRequest;
  let res: MockResponse;

  beforeEach(() => {
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    req = {
      query: {
        from: '2025-01-01',
        to: '2025-01-31',
      },
      user: {
        shopId: 42,
      },
    };

    mockGetFinancesFt2Snapshot.mockReset();
  });

  it('returns 401 if shopId is missing', async () => {
    req.user = undefined;

    await financesFt2Controller(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns FT2 snapshot when input is valid', async () => {
    const snapshot: FinancesFT2Exposure = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        revenueObserved: 5000,
        netObserved: 3000,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'up' },
      dataCoverage: { completenessPct: 95 },
    };

    mockGetFinancesFt2Snapshot.mockResolvedValue(snapshot);

    await financesFt2Controller(req as any, res as any);

    expect(mockGetFinancesFt2Snapshot).toHaveBeenCalledWith({
      shopId: 42,
      period: expect.objectContaining({
        from: expect.any(String),
        to: expect.any(String),
     }),
    });

    expect(res.json).toHaveBeenCalledWith(snapshot);
  });
});

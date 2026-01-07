import { describe, it, expect, jest, beforeEach } from '@jest/globals';

import { orderNexusFt2Controller } from 'api-src/api/order-nexus/orderNexusFt2.controller';
import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';
import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';

// ---- Mock resolver ----
jest.mock('api-src/services/order-nexus-ft2/orderNexusFt2.resolver', () => ({
  getOrderNexusFt2Snapshot: jest.fn(),
}));

const mockGetOrderNexusFt2Snapshot =
  getOrderNexusFt2Snapshot as jest.MockedFunction<
    typeof getOrderNexusFt2Snapshot
  >;

// ---- Minimal Express-like mocks ----
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

describe('OrderNexus FT2 Controller', () => {
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

    mockGetOrderNexusFt2Snapshot.mockReset();
  });

  it('returns 401 if shopId is missing', async () => {
    req.user = undefined;

    await orderNexusFt2Controller(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 400 if period is invalid', async () => {
    req.query = { from: '2025-01-01' };

    await orderNexusFt2Controller(req as any, res as any);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid period' });
  });

  it('returns FT2 snapshot when input is valid', async () => {
    const snapshot: OrderNexusFT2Exposure = {
      context: {
        period: { from: '2025-01-01', to: '2025-01-31' },
        ordersObserved: 5,
      },
      totals: {
        revenueTotal: 500,
        costTotal: 300,
        currency: null,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'up' },
      dataCoverage: { completenessPct: 90 },
    };

    mockGetOrderNexusFt2Snapshot.mockResolvedValue(snapshot);

    await orderNexusFt2Controller(req as any, res as any);

    expect(mockGetOrderNexusFt2Snapshot).toHaveBeenCalledWith({
      shopId: 42,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect(res.json).toHaveBeenCalledWith(snapshot);
  });
});
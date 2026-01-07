// tests/unit/backend/analytics/analyticsFacts.service.test.ts

import db from 'api-db';
import { getAnalyticsFacts } from 'api-src/services/analytics-facts/analyticsFacts.service';

jest.mock('api-db');

describe('Analytics Facts — raw truth extraction only', () => {
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns nulls when no sales data exists', async () => {
    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      sum: jest.fn().mockResolvedValueOnce([{ total: null }]),
    });

    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      sum: jest.fn().mockResolvedValueOnce([{ total: null }]),
    });

    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });

    const result = await getAnalyticsFacts({
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect(result.revenueObserved).toBeNull();
    expect(result.cogsObserved).toBeNull();
    expect(result.ordersObserved).toEqual({
      processing: null,
      delivered: null,
      in_transit: null,
    });
  });

  test('returns raw sums and counts without interpretation', async () => {
    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      sum: jest.fn().mockResolvedValueOnce([{ total: '1000' }]),
    });

    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      sum: jest.fn().mockResolvedValueOnce([{ total: '400' }]),
    });

    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([
        { status: 'processing', count: 2 },
        { status: 'delivered', count: 5 },
        { status: 'in_transit', count: 1 },
      ]),
    });

    const result = await getAnalyticsFacts({
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect(result.revenueObserved).toBe(1000);
    expect(result.cogsObserved).toBe(400);
    expect(result.ordersObserved).toEqual({
      processing: 2,
      delivered: 5,
      in_transit: 1,
    });
  });

  test('does not compute percentages, margins, or statuses', async () => {
    mockDb.mockReturnValue({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      sum: jest.fn().mockResolvedValue([{ total: '1000' }]),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValue([]),
    });

    const result = await getAnalyticsFacts({
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect((result as any).margin).toBeUndefined();
    expect((result as any).percentage).toBeUndefined();
    expect((result as any).status).toBeUndefined();
  });
});
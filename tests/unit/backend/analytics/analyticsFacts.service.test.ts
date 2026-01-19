import db from 'api-db';
import { getAnalyticsFacts } from 'api-src/services/analytics-facts/analyticsFacts.service';

jest.mock('api-db', () => {
  const fn: any = jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    groupBy: jest.fn().mockReturnThis(),
    select: jest.fn(),
  }));

  fn.raw = jest.fn((sql: string) => sql);
  return fn;
});

describe('Analytics Facts — raw truth extraction only', () => {
  const mockDb = db as unknown as jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('returns nulls when no order data exists', async () => {
    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });

    const result = await getAnalyticsFacts({
      shopId: 1,
    });

    expect(result.domains.orders.observationCount).toBeNull();
  });

  test('returns raw order counts without interpretation', async () => {
    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([
        {
          count: 8,
          first_seen_at: '2025-01-01T00:00:00Z',
          last_seen_at: '2025-01-31T23:59:59Z',
        },
      ]),
    });

    const result = await getAnalyticsFacts({
      shopId: 1,
    });

    expect(result.domains.orders.observationCount).toBe(8);
  });

  test('does not expose financials, periods, or intelligence', async () => {
    mockDb.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      select: jest.fn().mockResolvedValueOnce([]),
    });

    const result = await getAnalyticsFacts({
      shopId: 1,
    });

    expect((result as any).revenueObserved).toBeUndefined();
    expect((result as any).cogsObserved).toBeUndefined();
    expect((result as any).period).toBeUndefined();
    expect((result as any).outcome).toBeUndefined();
    expect((result as any).trend).toBeUndefined();
  });
});

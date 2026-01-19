import { getAnalyticsFacts } from 'api-src/services/analytics-facts';

jest.mock('api-db', () => {
  const db = jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    select: jest.fn().mockResolvedValue([
      {
        count: 5,
        first_seen_at: '2024-01-01T00:00:00Z',
        last_seen_at: '2024-01-02T00:00:00Z',
      },
    ]),
  }));

  db.raw = jest.fn((sql: string) => sql);

  return db;
});

describe('Analytics Facts (Layer 1)', () => {
  test('produces observability-only facts with snapshot identity', async () => {
    const facts = await getAnalyticsFacts({ shopId: 1 });

    expect(facts.snapshotId).toBeDefined();
    expect(facts.extractedAt).toBeDefined();

    expect(facts.domains.orders).toEqual(
      expect.objectContaining({
        presence: true,
        observationCount: 5,
        firstSeenAt: expect.any(String),
        lastSeenAt: expect.any(String),
      })
    );
  });

  test('does not include time period or intelligence fields', async () => {
    const facts = await getAnalyticsFacts({ shopId: 1 });

    expect((facts as any).period).toBeUndefined();
    expect((facts as any).outcome).toBeUndefined();
    expect((facts as any).trend).toBeUndefined();
  });
});
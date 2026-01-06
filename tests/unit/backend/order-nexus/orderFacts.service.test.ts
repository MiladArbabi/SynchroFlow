/**
 * OrderFactsService — Layer 1 Tests
 * --------------------------------
 * Guarantees:
 * - Fact-only extraction
 * - Null preservation
 * - No intelligence leakage
 *
 * NOTE:
 * Jest hoists jest.mock() calls.
 * Therefore ALL mocks must live inside the factory.
 */

import { extractOrderFacts } from 'api-src/services/order-facts';

// --- Mock api-db (Knex) ---
jest.mock('api-db', () => {
  const mockFirst = jest.fn();

  const chain = {
    where: () => chain,
    andWhere: () => chain,
    select: () => chain,
    count: () => chain,
    sum: () => chain,
    first: (...args: any[]) => mockFirst(...args),
  };

  const db: any = jest.fn(() => chain);

  // expose mock handles safely
  db.__mock = {
    first: mockFirst,
  };

  db.raw = jest.fn();

  return db;
});

// import AFTER mock so Jest wiring is correct
import db from 'api-db';

describe('OrderFactsService (Layer 1)', () => {
  const shopId = 1;
  const period = {
    from: '2025-01-01',
    to: '2025-01-31',
  };

  beforeEach(() => {
    (db as any).__mock.first.mockReset();
  });

  it('returns raw counts and totals without interpretation', async () => {
    (db as any).__mock.first
      .mockResolvedValueOnce({ count: '12' })                // ordersObserved
      .mockResolvedValueOnce({ revenue: '10000', cost: '7000' }) // totals
      .mockResolvedValueOnce({ total: '10', missing: '2' }); // coverage

    const snapshot = await extractOrderFacts(shopId, period);

    expect(snapshot.ordersObserved).toBe(12);
    expect(snapshot.totals.revenueTotal).toBe(10000);
    expect(snapshot.totals.costTotal).toBe(7000);
    expect(snapshot.dataCoverage.completenessPct).toBe(80);
  });

  it('preserves nulls when DB returns no data', async () => {
    (db as any).__mock.first
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    const snapshot = await extractOrderFacts(shopId, period);

    expect(snapshot.ordersObserved).toBeNull();
    expect(snapshot.totals.revenueTotal).toBeNull();
    expect(snapshot.totals.costTotal).toBeNull();
    expect(snapshot.dataCoverage.completenessPct).toBeNull();
  });

  it('does not emit intelligence fields', async () => {
    (db as any).__mock.first
      .mockResolvedValueOnce({ count: '1' })
      .mockResolvedValueOnce({ revenue: '100', cost: '50' })
      .mockResolvedValueOnce({ total: '1', missing: '0' });

    const snapshot = await extractOrderFacts(shopId, period);
    const serialized = JSON.stringify(snapshot);

    expect(serialized).not.toMatch(
      /profit|loss|risk|healthy|optimi|recommend|should/i
    );
  });
});
//tests/unit/backend/order-nexus/orderNexusFt2.resolver.test.ts
import { describe, it, expect, jest } from '@jest/globals';

import { getOrderNexusFt2Snapshot } from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';
import type { OrderFactsSnapshot } from 'api-src/services/order-facts/orderFacts.types';
import type { OrderNexusFT2Exposure } from 'api-src/services/order-ftep/orderFtep.types';

// ---- Mocks ----
jest.mock('api-src/services/order-facts/orderFacts.service', () => ({
  extractOrderFacts: jest.fn(),
}));

jest.mock(
  'api-src/services/order-intelligence/orderIntelligence.service',
  () => ({
    deriveOrderIntelligence: jest.fn(),
  })
);

jest.mock('api-src/services/order-ftep/orderFtep.service', () => ({
  exposeOrderNexusFT2: jest.fn(),
}));

import { extractOrderFacts } from 'api-src/services/order-facts/orderFacts.service';
import { deriveOrderIntelligence } from
  'api-src/services/order-intelligence/orderIntelligence.service';
import { exposeOrderNexusFT2 } from 'api-src/services/order-ftep/orderFtep.service';

const mockExtractOrderFacts =
  extractOrderFacts as jest.MockedFunction<typeof extractOrderFacts>;

const mockDeriveOrderIntelligence =
  deriveOrderIntelligence as jest.MockedFunction<
    typeof deriveOrderIntelligence
  >;

const mockExposeOrderNexusFT2 =
  exposeOrderNexusFT2 as jest.MockedFunction<typeof exposeOrderNexusFT2>;

describe('OrderNexus FT2 Resolver', () => {
  it('executes Facts → Intelligence → FTEP pipeline in order', async () => {
    const facts: OrderFactsSnapshot = {
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
      ordersObserved: 10,
      totals: {
        revenueTotal: 1000,
        costTotal: 700,
        currency: null,
      },
      dataCoverage: { completenessPct: 80 },
      extractedAt: '2025-02-01T00:00:00.000Z',
    };

    const intelligence = deriveOrderIntelligence(facts);

    const exposure: OrderNexusFT2Exposure = {
      context: {
        period: facts.period,
        ordersObserved: 10,
      },
      totals: {
        revenueTotal: 1000,
        costTotal: 700,
        currency: null,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'up' },
      dataCoverage: { completenessPct: 80 },
    };

    mockExtractOrderFacts.mockResolvedValue(facts);
    expect(deriveOrderIntelligence).toHaveBeenCalledWith(facts);
    mockExposeOrderNexusFT2.mockReturnValue(exposure);

    const result = await getOrderNexusFt2Snapshot({
      shopId: 1,
      period: { from: '2025-01-01', to: '2025-01-31' },
    });

    expect(extractOrderFacts).toHaveBeenCalledWith(1, {
      from: '2025-01-01',
      to: '2025-01-31',
    });

    expect(deriveOrderIntelligence).toHaveBeenCalledWith(facts);

    expect(exposeOrderNexusFT2).toHaveBeenCalledWith({
      facts,
      intelligence,
    });

    expect(result).toEqual(exposure);
  });
});
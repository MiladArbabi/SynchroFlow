import { getProductsFt2Snapshot } from 'api-src/services/products-ft2.provider';

// --- MOCK MODULES (required for ESM bindings) ---
jest.mock('api-src/services/products-facts', () => ({
  getProductsFacts: jest.fn(),
}));

jest.mock('api-src/services/products-intelligence', () => ({
  buildProductsIntelligence: jest.fn(),
}));

jest.mock('api-src/services/products-ftep', () => ({
  buildProductsFtep: jest.fn(),
}));

import { getProductsFacts } from 'api-src/services/products-facts';
import { buildProductsIntelligence } from 'api-src/services/products-intelligence';
import { buildProductsFtep } from 'api-src/services/products-ftep';

describe('Products FT2 Provider', () => {
  const input = {
    shopId: 42,
    period: { from: '2020-01-01', to: '2030-01-01' },
  };

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('orchestrates Facts → Intelligence → FTEP in order', async () => {
    const mockFacts = {
      shopId: 42,
      period: input.period,
      productsObserved: 2,
      skusObserved: 0,
      statusCounts: {
        active: 1,
        inactive: 1,
        archived: 0,
      },
      extractedAt: '2025-01-01T00:00:00.000Z',
    };

    const mockIntelligence = {
      productsObserved: 2,
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };

    const mockExposure = {
      context: {
        period: input.period,
        productsObserved: 2,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    };

    (getProductsFacts as jest.Mock).mockResolvedValue(mockFacts);
    (buildProductsIntelligence as jest.Mock).mockReturnValue(mockIntelligence);
    (buildProductsFtep as jest.Mock).mockReturnValue(mockExposure);

    const result = await getProductsFt2Snapshot(input);

    expect(getProductsFacts).toHaveBeenCalledWith(input);
    expect(buildProductsIntelligence).toHaveBeenCalledWith(mockFacts);
    expect(buildProductsFtep).toHaveBeenCalledWith({
      facts: mockFacts,
      intelligence: mockIntelligence,
    });

    expect(result).toEqual(mockExposure);
  });

  test('does not mutate or enrich data beyond pipeline output', async () => {
    const mockExposure = {
      context: {
        period: input.period,
        productsObserved: null,
      },
      outcome: null,
      trend: null,
    };

    (getProductsFacts as jest.Mock).mockResolvedValue({} as any);
    (buildProductsIntelligence as jest.Mock).mockReturnValue({} as any);
    (buildProductsFtep as jest.Mock).mockReturnValue(mockExposure);

    const result = await getProductsFt2Snapshot(input);

    expect(result).toEqual(mockExposure);
    expect((result as any).facts).toBeUndefined();
    expect((result as any).intelligence).toBeUndefined();
  });
});
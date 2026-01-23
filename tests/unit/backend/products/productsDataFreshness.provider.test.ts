import {
  getProductDataFreshnessSnapshot,
} from 'api-src/services/products-data-freshness.provider';

jest.mock(
  'api-src/services/products-data-freshness-facts',
  () => ({
    getProductDataFreshnessFacts: jest.fn(),
  })
);

jest.mock(
  'api-src/services/products-data-freshness-intelligence',
  () => ({
    buildProductDataFreshnessIntelligence: jest.fn(),
  })
);

jest.mock(
  'api-src/services/products-data-freshness-ftep',
  () => ({
    buildProductDataFreshnessFtep: jest.fn(),
  })
);

import {
  getProductDataFreshnessFacts,
} from 'api-src/services/products-data-freshness-facts';
import {
  buildProductDataFreshnessIntelligence,
} from 'api-src/services/products-data-freshness-intelligence';
import {
  buildProductDataFreshnessFtep,
} from 'api-src/services/products-data-freshness-ftep';

describe('Product Data Freshness FT2 Provider', () => {
  const shopId = 1;
  const period = { from: '2024-01-01', to: '2024-01-31' };

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('orchestrates Facts → Intelligence → FTEP', async () => {
    (getProductDataFreshnessFacts as jest.Mock).mockResolvedValue({});
    (buildProductDataFreshnessIntelligence as jest.Mock).mockReturnValue({});
    (buildProductDataFreshnessFtep as jest.Mock).mockReturnValue({
      freshness: null,
    });

    const result = await getProductDataFreshnessSnapshot({
      shopId,
      period,
    });

    expect(getProductDataFreshnessFacts).toHaveBeenCalled();
    expect(buildProductDataFreshnessIntelligence).toHaveBeenCalled();
    expect(buildProductDataFreshnessFtep).toHaveBeenCalled();

    expect(result).toEqual({ freshness: null });
  });
});

import { ProductsFacts } from 'api-src/services/products-facts/ProductsFacts.types';
import { buildProductsIntelligence } from 'api-src/services/products-intelligence/ProductsIntelligence.service';

describe('ProductsIntelligence.service (Layer 2)', () => {
  const baseFacts: ProductsFacts = {
    shopId: 1,
    period: { from: '2020-01-01', to: '2030-01-01' },
    productsObserved: 3,
    skusObserved: 0,
    statusCounts: {
      active: 2,
      inactive: 1,
      archived: 0,
    },
    extractedAt: new Date().toISOString(),
    distinctSkusObserved: 0,
    productsWithSkuCount: 0,
    productsWithoutSkuCount: 0,
    variantsObserved: 0,
    productsWithVariantsCount: 0,
    singleVariantProductsCount: 0
  };

  test('classifies outcome as positive when at least one active product exists', () => {
    const intelligence = buildProductsIntelligence(baseFacts);

    expect(intelligence.outcome.status).toBe('positive');
    expect(intelligence.trend.direction).toBe('unknown');
    expect(intelligence.productsObserved).toBe(3);
  });

  test('classifies outcome as negative when no active products but inactive or archived exist', () => {
    const facts: ProductsFacts = {
      ...baseFacts,
      statusCounts: {
        active: 0,
        inactive: 2,
        archived: 1,
      },
    };

    const intelligence = buildProductsIntelligence(facts);

    expect(intelligence.outcome.status).toBe('negative');
    expect(intelligence.trend.direction).toBe('unknown');
  });

  test('classifies outcome as unknown when facts are missing', () => {
    const facts: ProductsFacts = {
      ...baseFacts,
      productsObserved: null,
      skusObserved: null,
      statusCounts: {
        active: null,
        inactive: null,
        archived: null,
      },
    };

    const intelligence = buildProductsIntelligence(facts);

    expect(intelligence.outcome.status).toBe('unknown');
    expect(intelligence.trend.direction).toBe('unknown');
  });

  test('does not access persistence or external services', () => {
    const intelligence = buildProductsIntelligence(baseFacts);

    // Structural guards only — no DB, no side effects
    expect(intelligence).toMatchObject({
      productsObserved: 3,
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
    });
  });

  test('does not expose explanations or recommendations', () => {
    const intelligence = buildProductsIntelligence(baseFacts);

    expect((intelligence as any).reason).toBeUndefined();
    expect((intelligence as any).because).toBeUndefined();
    expect((intelligence as any).recommendation).toBeUndefined();
    expect((intelligence as any).explanation).toBeUndefined();
  });


  describe('ProductsIntelligence v2', () => {
    test('returns unknown for all signals when facts are missing', () => {
      const facts = {
        productsObserved: null,
        statusCounts: { active: null, inactive: null, archived: null },
      } as ProductsFacts;

      const intel = buildProductsIntelligence(facts);

      expect(intel.outcome.status).toBe('unknown');
      expect(intel.catalogHealth).toBe('unknown');
      expect(intel.skuCoverage).toBe('unknown');
      expect(intel.variantComplexity).toBe('unknown');
    });

    test('detects healthy catalog with complete SKU coverage', () => {
      const facts = {
        productsObserved: 2,
        productsWithSkuCount: 2,
        productsWithoutSkuCount: 0,
        variantsObserved: 0,
        productsWithVariantsCount: 0,
        statusCounts: { active: 2, inactive: 0, archived: 0 },
      } as ProductsFacts;

      const intel = buildProductsIntelligence(facts);

      expect(intel.catalogHealth).toBe('healthy');
      expect(intel.skuCoverage).toBe('complete');
      expect(intel.variantComplexity).toBe('simple');
    });

    test('detects degraded catalog with partial SKU coverage and complex variants', () => {
      const facts = {
        productsObserved: 2,
        productsWithSkuCount: 1,
        productsWithoutSkuCount: 1,
        variantsObserved: 6,
        productsWithVariantsCount: 2,
        statusCounts: { active: 0, inactive: 2, archived: 0 },
      } as ProductsFacts;

      const intel = buildProductsIntelligence(facts);

      expect(intel.catalogHealth).toBe('degraded');
      expect(intel.skuCoverage).toBe('partial');
      expect(intel.variantComplexity).toBe('complex');
    });
  });
});
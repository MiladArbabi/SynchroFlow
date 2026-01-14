//tests/unit/backend/products/productsFtep.service.test.ts
import { ProductsFacts } from 'api-src/services/products-facts/ProductsFacts.types';
import { ProductsIntelligence } from 'api-src/services/products-intelligence/ProductsIntelligence.types';

// NOTE: Service does NOT exist yet — TDD by design
import { buildProductsFtep } from 'api-src/services/products-ftep/ProductsFtep.service';

describe('ProductsFtep.service (Layer 3)', () => {
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
    extractedAt: '2025-01-01T00:00:00.000Z',
    distinctSkusObserved: 0,
    productsWithSkuCount: 0,
    productsWithoutSkuCount: 0,
    variantsObserved: 0,
    productsWithVariantsCount: 0,
    singleVariantProductsCount: 0
  };

  const baseIntelligence: ProductsIntelligence = {
    productsObserved: 3,
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },
    catalogHealth: 'unknown',
    skuCoverage: 'unknown',
    variantComplexity: 'unknown'
  };

  test('exposes only FT2-safe observability', () => {
    const exposure = buildProductsFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    });

    expect(exposure).toEqual({
      context: {
        period: baseFacts.period,
        productsObserved: 3,
      },
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },
      signals: {
        catalog: 'unknown',
        skuCoverage: 'unknown',
        variantComplexity: 'unknown',
      },
    });
  });

  test('downgrades to null when intelligence is unknown', () => {
    const exposure = buildProductsFtep({
      facts: {
        ...baseFacts,
        productsObserved: null,
        statusCounts: {
          active: null,
          inactive: null,
          archived: null,
        },
      },
      intelligence: {
        productsObserved: null,
        outcome: { status: 'unknown' },
        trend: { direction: 'unknown' },
        catalogHealth: 'unknown',
        skuCoverage: 'unknown',
        variantComplexity: 'unknown'
      },
    });

    expect(exposure).toEqual({
      context: {
        period: baseFacts.period,
        productsObserved: null,
      },
      outcome: null,
      trend: null,
      signals: null,
    });
  });

  test('does not expose intelligence internals', () => {
    const exposure = buildProductsFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    });

    expect((exposure as any).productsObserved).toBeUndefined();
    expect((exposure as any).statusCounts).toBeUndefined();
    expect((exposure as any).intelligence).toBeUndefined();
  });

  test('prevents semantic leakage via serialization scan', () => {
    const exposure = buildProductsFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    });

    const serialized = JSON.stringify(exposure);

    expect(serialized).not.toMatch(/because|reason|why|driver|caused/i);
    expect(serialized).not.toMatch(/recommend|should|action/i);
    expect(serialized).not.toMatch(/active|inactive|archived/i);
  });

  test('never exposes facts timestamps or raw status counts', () => {
    const exposure = buildProductsFtep({
      facts: baseFacts,
      intelligence: baseIntelligence,
    });

    expect((exposure as any).extractedAt).toBeUndefined();
    expect((exposure as any).statusCounts).toBeUndefined();
    expect((exposure as any).skusObserved).toBeUndefined();
  });

  describe('ProductsFtep.service (Layer 3 — FTEP v2)', () => {
    const baseFacts: ProductsFacts = {
      shopId: 1,
      period: { from: '2020-01-01', to: '2030-01-01' },
      productsObserved: 3,
      skusObserved: 2,
      statusCounts: {
        active: 2,
        inactive: 1,
        archived: 0,
      },
      extractedAt: '2025-01-01T00:00:00.000Z',
      distinctSkusObserved: 0,
      productsWithSkuCount: 0,
      productsWithoutSkuCount: 0,
      variantsObserved: 0,
      productsWithVariantsCount: 0,
      singleVariantProductsCount: 0
    };

    const baseIntelligence: ProductsIntelligence = {
      productsObserved: 3,
      outcome: { status: 'positive' },
      trend: { direction: 'unknown' },

      // v2 intelligence extensions (must NOT leak verbatim)
      catalogHealth: 'healthy',
      skuCoverage: 'partial',
      variantComplexity: 'simple',
    } as any;

    test('exposes only FT2-safe observability (no intelligence richness)', () => {
      const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: baseIntelligence,
      });

      expect(exposure).toEqual({
        context: {
          period: baseFacts.period,
          productsObserved: 3,
        },
        outcome: { status: 'positive' },
        trend: { direction: 'unknown' },
        signals: {
          catalog: 'ok',
          skuCoverage: 'gaps',
          variantComplexity: 'simple',
        },
      });
    });

    test('downgrades everything except context when intelligence is unknown', () => {
      const exposure = buildProductsFtep({
        facts: {
          ...baseFacts,
          productsObserved: null,
          statusCounts: {
            active: null,
            inactive: null,
            archived: null,
          },
        },
        intelligence: {
          productsObserved: null,
          outcome: { status: 'unknown' },
          trend: { direction: 'unknown' },
          catalogHealth: 'unknown',
          skuCoverage: 'missing',
          variantComplexity: 'complex',
        } as any,
      });

      expect(exposure).toEqual({
        context: {
          period: baseFacts.period,
          productsObserved: null,
        },
        outcome: null,
        trend: null,
        signals: null,
      });
    });

    test('does not expose intelligence internals or raw facts', () => {
      const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: baseIntelligence,
      });

      expect((exposure as any).productsObserved).toBeUndefined();
      expect((exposure as any).statusCounts).toBeUndefined();
      expect((exposure as any).skusObserved).toBeUndefined();
      expect((exposure as any).extractedAt).toBeUndefined();
      expect((exposure as any).catalogHealth).toBeUndefined();
      expect((exposure as any).skuCoverage).toBeUndefined();
      expect((exposure as any).variantComplexity).toBeUndefined();
    });

    test('prevents semantic leakage via serialization scan', () => {
      const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: baseIntelligence,
      });

      const serialized = JSON.stringify(exposure);

      // no explanations
      expect(serialized).not.toMatch(/because|reason|why|driver|caused/i);

      // no recommendations
      expect(serialized).not.toMatch(/recommend|should|action|fix|improve/i);

      // no raw product semantics
      expect(serialized).not.toMatch(/active|inactive|archived/i);
      expect(serialized).not.toMatch(/healthy|degraded|partial|missing/i);
    });

    test('never exposes timestamps or persistence-derived fields', () => {
      const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: baseIntelligence,
      });

      expect((exposure as any).extractedAt).toBeUndefined();
      expect((exposure as any).shopId).toBeUndefined();
    });
  });
});
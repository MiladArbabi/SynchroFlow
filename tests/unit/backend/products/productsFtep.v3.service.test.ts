import { ProductsFacts } from 'api-src/services/products-facts/ProductsFacts.types';
import { ProductsIntelligence } from 'api-src/services/products-intelligence/ProductsIntelligence.types';
import { buildProductsFtep } from 'api-src/services/products-ftep/ProductsFtep.service';

describe('ProductsFtep.service (Layer 3 — v3)', () => {
  const baseFacts: ProductsFacts = {
    shopId: 1,
    period: { from: '2020-01-01', to: '2030-01-01' },

    productsObserved: 10,
    skusObserved: 8,

    distinctSkusObserved: 8,
    productsWithSkuCount: 8,
    productsWithoutSkuCount: 2,

    variantsObserved: 20,
    productsWithVariantsCount: 6,
    singleVariantProductsCount: 4,

    statusCounts: {
      active: 7,
      inactive: 2,
      archived: 1,
    },

    extractedAt: '2025-01-01T00:00:00.000Z',
  };

  const fullIntelligence: ProductsIntelligence = {
    productsObserved: 10,

    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },

    catalogHealth: 'healthy',
    skuCoverage: 'partial',
    variantComplexity: 'complex',

    // v3-paid-only intelligence (assumed present)
    distributionSkew: 'skewed',
    skuIntegrity: 'mixed',
    variantOutliers: 'present',
    catalogDrift: 'flat',
  } as any;

    test('FREE: exposes only baseline FT2 signals', () => {
        const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: fullIntelligence,
        entitlement: 'free',
        });

        expect(exposure).toEqual({
        context: {
            period: baseFacts.period,
            productsObserved: 10,
        },
        outcome: { status: 'positive' },
        trend: { direction: 'unknown' },
        signals: {
            catalog: 'ok',
            skuCoverage: 'gaps',
            variantComplexity: 'complex',
        },
      });
    });

      test('PAID: exposes extended FT2 signals', () => {
        const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: fullIntelligence,
        entitlement: 'paid',
        });

        expect(exposure.signals).toEqual({
        catalog: 'ok',
        skuCoverage: 'gaps',
        variantComplexity: 'complex',

        distributionSkew: 'skewed',
        skuIntegrity: 'mixed',
        variantOutliers: 'present',
        catalogDrift: 'flat',
        });
    });

      test('downgrades EVERYTHING when outcome is unknown', () => {
        const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: {
            ...fullIntelligence,
            outcome: { status: 'unknown' },
        },
        entitlement: 'paid',
        });

        expect(exposure).toEqual({
        context: {
            period: baseFacts.period,
            productsObserved: 10,
        },
        outcome: null,
        trend: null,
        signals: null,
        });
    });

    test('FREE: never exposes paid-only signals (structural)', () => {
        const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: fullIntelligence,
        entitlement: 'free',
        }) as any;

        expect(exposure.signals.distributionSkew).toBeUndefined();
        expect(exposure.signals.skuIntegrity).toBeUndefined();
        expect(exposure.signals.variantOutliers).toBeUndefined();
        expect(exposure.signals.catalogDrift).toBeUndefined();
    });

    test('prevents semantic leakage via serialization scan', () => {
        const exposure = buildProductsFtep({
        facts: baseFacts,
        intelligence: fullIntelligence,
        entitlement: 'paid',
        });

        const serialized = JSON.stringify(exposure);

        expect(serialized).not.toMatch(/because|why|due to|caused/i);
        expect(serialized).not.toMatch(/recommend|should|fix|action/i);
        expect(serialized).not.toMatch(/percent|ratio|average|count/i);
    });

      test('never exposes raw facts or intelligence internals', () => {
    const exposure = buildProductsFtep({
      facts: baseFacts,
      intelligence: fullIntelligence,
      entitlement: 'paid',
    }) as any;

    expect(exposure.extractedAt).toBeUndefined();
    expect(exposure.statusCounts).toBeUndefined();
    expect(exposure.productsWithSkuCount).toBeUndefined();
    expect(exposure.variantsObserved).toBeUndefined();
  });

});

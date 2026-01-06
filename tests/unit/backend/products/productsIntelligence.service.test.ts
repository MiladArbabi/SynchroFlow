import { ProductsFacts } from 'api-src/services/products-facts/ProductsFacts.types';

// NOTE: Service does NOT exist yet — TDD by design
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
    expect(intelligence).toEqual({
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
});
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
  };

  const baseIntelligence: ProductsIntelligence = {
    productsObserved: 3,
    outcome: { status: 'positive' },
    trend: { direction: 'unknown' },
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
      },
    });

    expect(exposure).toEqual({
      context: {
        period: baseFacts.period,
        productsObserved: null,
      },
      outcome: null,
      trend: null,
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
});
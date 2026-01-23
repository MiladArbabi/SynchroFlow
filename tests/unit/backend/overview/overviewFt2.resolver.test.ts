// tests/unit/backend/overview/overviewFt2.resolver.test.ts

import { getOverviewFt2Snapshot } from 'api-src/services/overview-ft2/overviewFt2.resolver';

/**
 * HARD MOCK BOUNDARY
 * Overview FT2 may ONLY depend on terminal FT2 resolvers.
 * No facts, no intelligence, no DB.
 */

jest.mock(
  'api-src/services/trust-ft2/trustFt2.resolver',
  () => ({
    getTrustFt2Snapshot: jest.fn(),
  })
);

jest.mock(
  'api-src/services/order-nexus-ft2/orderNexusFt2.resolver',
  () => ({
    getOrderNexusFt2Snapshot: jest.fn(),
  })
);

jest.mock(
  'api-src/services/products-ft2.provider',
  () => ({
    getProductsFt2Snapshot: jest.fn(),
  })
);

jest.mock(
  'api-src/services/customers-ft2.provider',
  () => ({
    getCustomersFt2Snapshot: jest.fn(),
  })
);

import {
  getTrustFt2Snapshot,
} from 'api-src/services/trust-ft2/trustFt2.resolver';

import {
  getOrderNexusFt2Snapshot,
} from 'api-src/services/order-nexus-ft2/orderNexusFt2.resolver';

import {
  getProductsFt2Snapshot,
} from 'api-src/services/products-ft2.provider';

import {
  getCustomersFt2Snapshot,
} from 'api-src/services/customers-ft2.provider';

describe('Overview FT2 Resolver — Composition Contract', () => {
  const shopId = 1;

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('returns null when trustEligible !== true', async () => {
    (getTrustFt2Snapshot as jest.Mock).mockResolvedValue({
      dataFreshness: 'unknown',
      dataIntegrity: 'unknown',
      trustEligible: null,
    });

    const result = await getOverviewFt2Snapshot({ shopId });

    expect(result).toBeNull();
  });

  test('returns composed snapshot when trustEligible === true', async () => {
    (getTrustFt2Snapshot as jest.Mock).mockResolvedValue({
      dataFreshness: 'fresh',
      dataIntegrity: 'consistent',
      trustEligible: true,
    });

    (getOrderNexusFt2Snapshot as jest.Mock).mockResolvedValue({
      ordersObserved: 5,
      totals: {
        revenueTotal: 1000,
        currency: 'USD',
      },
    });

    (getProductsFt2Snapshot as jest.Mock).mockResolvedValue(null);
    (getCustomersFt2Snapshot as jest.Mock).mockResolvedValue(null);

    const result = await getOverviewFt2Snapshot({ shopId });

    expect(result).toEqual({
      trust: {
        dataFreshness: 'fresh',
        dataIntegrity: 'consistent',
        trustEligible: true,
      },

      context: {
        ordersObserved: 5,
        productsObserved: null,
        customersObserved: null,
      },

      snapshot: {
        orders: {
          revenueTotal: 1000,
          currency: 'USD',
        },
        products: null,
        customers: null,
      },

      alignment: null,
    });
  });

  test('never throws when downstream FT2 snapshots are null', async () => {
    (getTrustFt2Snapshot as jest.Mock).mockResolvedValue({
      dataFreshness: 'fresh',
      dataIntegrity: 'consistent',
      trustEligible: true,
    });

    (getOrderNexusFt2Snapshot as jest.Mock).mockResolvedValue(null);
    (getProductsFt2Snapshot as jest.Mock).mockResolvedValue(null);
    (getCustomersFt2Snapshot as jest.Mock).mockResolvedValue(null);

    const result = await getOverviewFt2Snapshot({ shopId });

    expect(result).toEqual({
      trust: {
        dataFreshness: 'fresh',
        dataIntegrity: 'consistent',
        trustEligible: true,
      },

      context: {
        ordersObserved: null,
        productsObserved: null,
        customersObserved: null,
      },

      snapshot: {
        orders: null,
        products: null,
        customers: null,
      },

      alignment: null,
    });
  });

  test('does not enrich, infer, or default any domain values', async () => {
    const trustSnapshot = Object.freeze({
      dataFreshness: 'fresh',
      dataIntegrity: 'consistent',
      trustEligible: true,
    });

    const ordersSnapshot = Object.freeze({
      ordersObserved: null,
      totals: null,
    });

    (getTrustFt2Snapshot as jest.Mock).mockResolvedValue(trustSnapshot);
    (getOrderNexusFt2Snapshot as jest.Mock).mockResolvedValue(ordersSnapshot);
    (getProductsFt2Snapshot as jest.Mock).mockResolvedValue(null);
    (getCustomersFt2Snapshot as jest.Mock).mockResolvedValue(null);

    const result = await getOverviewFt2Snapshot({ shopId });

    expect(result?.trust).toBe(trustSnapshot);
    expect(result?.snapshot.orders).toBeNull();
  });
});
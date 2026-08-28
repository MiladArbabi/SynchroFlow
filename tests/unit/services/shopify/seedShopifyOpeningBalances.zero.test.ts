// tests/unit/services/shopify/seedShopifyOpeningBalances.zero.test.ts
//
// SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — root cause A.
//
// seedShopifyOpeningBalances previously ran an unconditional debug probe:
//   response.data.products.edges[0].node.variants.edges[0].node.id
// which crashes a VALID zero-product Shopify response (products.edges = [])
// with "Cannot read properties of undefined (reading 'node')".
//
// These are pure unit tests: the real Shopify client factory is mocked away
// (never invoked — an injected client is passed), and `trx` is a stub that
// throws on any access so a single accidental DB call fails the test.

// The seeder imports the real factory at module-eval time; stub it so
// @shopify/shopify-api is never initialised in this unit context.
jest.mock('api-src/services/shopify-client.factory', () => ({
  createShopifyGraphQLClient: jest.fn(() => {
    throw new Error('real createShopifyGraphQLClient must not be called');
  }),
}));

import { seedShopifyOpeningBalances } from 'api-src/services/inventory/seedShopifyOpeningBalances';

/** A `trx` that fails the test if it is invoked in any way. */
function makeExplodingTrx() {
  return jest.fn(() => {
    throw new Error('trx must not be touched for a zero-write opening-balance run');
  });
}

describe('SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — seedShopifyOpeningBalances zero paths', () => {
  it('T1 — resolves with zero writes for a valid zero-product response (products.edges = [])', async () => {
    const trx = makeExplodingTrx();
    const client = {
      request: jest.fn().mockResolvedValue({ data: { products: { edges: [] } } }),
    };

    await expect(
      seedShopifyOpeningBalances(
        trx as any,
        'access-token',
        'shop.myshopify.com',
        5,
        client
      )
    ).resolves.toBeUndefined();

    expect(client.request).toHaveBeenCalledTimes(1); // only the real products query — debug probes removed
    expect(trx).not.toHaveBeenCalled();
  });

  it('T2 — resolves with zero writes for a product with no variants (variants.edges = [])', async () => {
    const trx = makeExplodingTrx();
    const client = {
      request: jest.fn().mockResolvedValue({
        data: {
          products: {
            edges: [
              { node: { title: 'P1', variants: { edges: [] } } },
            ],
          },
        },
      }),
    };

    await expect(
      seedShopifyOpeningBalances(
        trx as any,
        'access-token',
        'shop.myshopify.com',
        5,
        client
      )
    ).resolves.toBeUndefined();

    expect(client.request).toHaveBeenCalledTimes(1);
    expect(trx).not.toHaveBeenCalled();
  });
});

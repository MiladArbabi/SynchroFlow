// tests/unit/services/shopify/shopifyPagination.terminal.test.ts
//
// SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — root cause B.
//
// paginateShopify treated the very first page of an empty order connection
// (endCursor = null) as a stuck cursor, because it collided with the initial
// lastCursor = null, and threw [SHOPIFY_PAGINATION_FATAL] before respecting
// hasNextPage = false.
//
// The genuine repeated-cursor invariant (same NON-NULL endCursor across
// consecutive pages while hasNextPage = true) must still fail.
//
// Pure unit: paginateShopify already accepts fetchPage / handlePage as
// injected functions — no seam required.

import { paginateShopify } from 'api-src/services/shopify/shopifyPagination.service';

describe('SHOP-REVIEW-ZERO-PRODUCT-SYNC-06 — paginateShopify terminal / stall', () => {
  it('T3 — valid empty terminal page completes without SHOPIFY_PAGINATION_FATAL', async () => {
    const page = {
      orders: {
        edges: [],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
    const fetchPage = jest.fn().mockResolvedValue(page);
    const handlePage = jest.fn().mockResolvedValue(undefined);

    await expect(
      paginateShopify({ fetchPage, handlePage, shopId: 5 })
    ).resolves.toBeUndefined();

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(handlePage).toHaveBeenCalledTimes(1);
    expect(handlePage).toHaveBeenCalledWith(page);
  });

  it('T4 — genuine repeated non-null cursor still throws SHOPIFY_PAGINATION_FATAL', async () => {
    const page1 = {
      orders: {
        edges: [{ node: { id: 'gid://shopify/Order/1' } }],
        pageInfo: { hasNextPage: true, endCursor: 'cursorA' },
      },
    };
    const page2 = {
      orders: {
        edges: [{ node: { id: 'gid://shopify/Order/2' } }],
        pageInfo: { hasNextPage: true, endCursor: 'cursorA' }, // same cursor → real stall
      },
    };
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce(page1)
      .mockResolvedValueOnce(page2);
    const handlePage = jest.fn().mockResolvedValue(undefined);
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      paginateShopify({ fetchPage, handlePage, shopId: 5 })
    ).rejects.toThrow('[SHOPIFY_PAGINATION_FATAL]');

    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(handlePage).toHaveBeenCalledTimes(1);
    expect(handlePage).toHaveBeenCalledWith(page1);
    expect(errorSpy).toHaveBeenCalledWith(
      '[SHOPIFY_PAGINATION_STUCK]',
      expect.objectContaining({ cursor: 'cursorA' })
    );

    errorSpy.mockRestore();
  });
});

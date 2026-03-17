type FetchPageFn = (cursor: string | null) => Promise<any>;

type HandlePageFn = (page: any) => Promise<void>;

/**
 * SHOPIFY PAGINATION SERVICE
 * --------------------------
 * Isolates cursor-based pagination.
 *
 * Guarantees:
 * - single responsibility
 * - reusable across domains (orders, products, etc.)
 * - consistent failure handling
 */

export const paginateShopify = async ({
  fetchPage,
  handlePage,
  shopId,
}: {
  fetchPage: FetchPageFn;
  handlePage: HandlePageFn;
  shopId: number;
}) => {
  let cursor: string | null = null;
  let hasNextPage = true;
  let lastCursor: string | null = null;

  while (hasNextPage) {
    const page = await fetchPage(cursor);

    if (page.orders.pageInfo.endCursor === lastCursor) {
      console.error('[SHOPIFY_PAGINATION_STUCK]', {
        shopId,
        cursor: lastCursor,
        hasNextPage: page.orders.pageInfo.hasNextPage,
        edgesCount: page.orders.edges?.length ?? 0,
      });

      throw new Error('[SHOPIFY_PAGINATION_FATAL]');
    }

    hasNextPage = page.orders.pageInfo.hasNextPage;
    lastCursor = page.orders.pageInfo.endCursor;
    cursor = page.orders.pageInfo.endCursor;

    console.info('[SHOPIFY_PAGINATION_STATE]', {
      shopId,
      hasNextPage,
      endCursor: cursor,
      edgesCount: page.orders.edges?.length ?? 0,
    });

    await handlePage(page);
  }
};
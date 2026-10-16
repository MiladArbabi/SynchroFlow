/**
 * GH-1262 A2.1 — Shopify catalog pagination RED contracts.
 *
 * Test-only. No live provider, DB, or network requests.
 * The injected Shopify client supplies deterministic pages.
 *
 * A2P1-01: opening-balance collection must continue beyond
 *           the first 50 Shopify products.
 *
 * A2P1-02: a failed subsequent Shopify page must not allow
 *           an incomplete opening-balance collection to succeed.
 */

jest.mock('api-src/services/shopify-client.factory', () => ({
  createShopifyGraphQLClient: jest.fn(() => {
    throw new Error('LIVE_SHOPIFY_CLIENT_FORBIDDEN');
  }),
}));

import { seedShopifyOpeningBalances } from
  'api-src/services/inventory/seedShopifyOpeningBalances';

function page(
  count: number,
  hasNextPage: boolean,
  endCursor: string | null
) {
  return {
    data: {
      products: {
        edges: Array.from({ length: count }, (_, index) => ({
          node: {
            id: `gid://shopify/Product/${1000 + index}`,
            variants: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

function forbiddenTransaction() {
  return jest.fn(() => {
    throw new Error('DB_ACCESS_FORBIDDEN');
  });
}

describe('GH-1262 A2.1 — opening-balance product pagination', () => {
  it('A2P1-01 — collects the second product page after the first 50', async () => {
    const trx = forbiddenTransaction();

    const client = {
      request: jest.fn()
        .mockResolvedValueOnce(page(50, true, 'cursor-50'))
        .mockResolvedValueOnce(page(1, false, null)),
    };

    await seedShopifyOpeningBalances(
      trx as any,
      'unused-test-token',
      'synthetic-shop.myshopify.com',
      1,
      client
    );

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(client.request.mock.calls[1]))
      .toContain('cursor-50');
    expect(trx).not.toHaveBeenCalled();
  });

  it('A2P1-02 — rejects when a subsequent product page fails', async () => {
    const trx = forbiddenTransaction();

    const client = {
      request: jest.fn()
        .mockResolvedValueOnce(page(1, true, 'cursor-next'))
        .mockRejectedValueOnce(
          new Error('SYNTHETIC_SECOND_PAGE_FAILURE')
        ),
    };

    await expect(
      seedShopifyOpeningBalances(
        trx as any,
        'unused-test-token',
        'synthetic-shop.myshopify.com',
        1,
        client
      )
    ).rejects.toThrow('SYNTHETIC_SECOND_PAGE_FAILURE');

    expect(client.request).toHaveBeenCalledTimes(2);
    expect(trx).not.toHaveBeenCalled();
  });
});

/**
 * GH-1262 A2.1 — final bounded cursor safety contracts.
 * No DB, provider, or integration fixture.
 *
 * A2P1-03: cursor must advance and must not cycle.
 * A2P1-04: continuation requires a nonempty cursor.
 */

describe('GH-1262 A2.1 — catalog cursor safety RED', () => {
  const cursorCases: Array<[string, string[]]> = [
    ['stalled cursor', ['cursor-A', 'cursor-A']],
    ['cursor cycle', ['cursor-A', 'cursor-B', 'cursor-A']],
  ];

  it.each(cursorCases)(
    'A2P1-03 — rejects %s without unbounded fetching',
    async (_label, cursors) => {
      const trx = forbiddenTransaction();
      let index = 0;

      const client = {
        request: jest.fn(async () => {
          if (index >= cursors.length) {
            throw new Error('EXCESS_PROVIDER_REQUEST');
          }

          return page(1, true, cursors[index++]);
        }),
      };

      let observedError: Error | null = null;

      try {
        await seedShopifyOpeningBalances(
          trx as any,
          'unused-test-token',
          'synthetic-shop.myshopify.com',
          1,
          client
        );
      } catch (error) {
        observedError = error as Error;
      }

      expect(observedError).toBeInstanceOf(Error);
      expect(observedError?.message)
        .not.toContain('EXCESS_PROVIDER_REQUEST');

      expect(client.request)
        .toHaveBeenCalledTimes(cursors.length);

      expect(trx).not.toHaveBeenCalled();
    }
  );

  it(
    'A2P1-04 — rejects continuation without endCursor',
    async () => {
      const trx = forbiddenTransaction();

      const client = {
        request: jest.fn().mockResolvedValue(
          page(1, true, null)
        ),
      };

      await expect(
        seedShopifyOpeningBalances(
          trx as any,
          'unused-test-token',
          'synthetic-shop.myshopify.com',
          1,
          client
        )
      ).rejects.toThrow();

      expect(client.request).toHaveBeenCalledTimes(1);
      expect(trx).not.toHaveBeenCalled();
    }
  );
});

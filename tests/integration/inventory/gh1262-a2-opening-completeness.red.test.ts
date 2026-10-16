/**
 * GH-1262 A2.1 — V2 opening snapshot completeness.
 * Disposable PostgreSQL only; injected synthetic Shopify responses.
 * RED TESTS ONLY — no application implementation changes.
 */

jest.mock('api-src/services/shopify/shopifyRefundBackfill.service', () => ({
  backfillShopifyRefunds: jest.fn().mockResolvedValue({
    shopId: 0,
    refundsBackfilled: 0,
  }),
}));

jest.mock('api-src/services/shopify/shopifyWebhook.service', () => ({
  registerWebhooksForShop: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('api-src/services/shopify-client.factory', () => ({
  createShopifyGraphQLClient: jest.fn(() => {
    throw new Error('LIVE_SHOPIFY_FORBIDDEN');
  }),
}));

import crypto from 'crypto';
import {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import {
  createTenantShop,
} from '@lasyncro/backend-core/services/pre-tenant.service.js';
import {
  seedShopifyOpeningBalances,
} from 'api-src/services/inventory/seedShopifyOpeningBalances';
import { performInitialSync } from 'api-src/services/shopify.service';

jest.setTimeout(120000);

type Item = {
  productId: string;
  variantId: string;
  externalProductId: string;
  externalVariantId: string;
  quantity: number;
};

function makeItems(count: number): Item[] {
  return Array.from({ length: count }, (_, i) => ({
    productId: crypto.randomUUID(),
    variantId: crypto.randomUUID(),
    externalProductId: `gid://shopify/Product/${90000 + i}`,
    externalVariantId: `gid://shopify/ProductVariant/${90000 + i}`,
    quantity: i + 1,
  }));
}

async function createShop(): Promise<number> {
  const shopId = await systemTransaction(async trx => {
    const id = await createTenantShop(
      trx,
      `gh1262-a2-${crypto.randomBytes(6).toString('hex')}`
    );
    await setTenantContext(trx, id);
    return id;
  });

  await withTenant(shopId, trx =>
    trx('shop_wms_settings').insert({
      shop_id: shopId,
      bootstrap_model: 'reconcile_opening_expectation_v2',
    })
  );

  return shopId;
}

async function storeMappedItems(shopId: number, items: Item[]) {
  await withTenant(shopId, async trx => {
    await trx('products').insert(items.map((v, i) => ({
      lasyncro_product_id: v.productId,
      shop_id: shopId,
      title: `Synthetic product ${i}`,
      status: 'active',
      product_type: 'physical',
    })));

    await trx('variants').insert(items.map((v, i) => ({
      lasyncro_variant_id: v.variantId,
      lasyncro_product_id: v.productId,
      shop_id: shopId,
      sku: `GH1262-A2-${i}`,
      title: `Synthetic variant ${i}`,
      unit_cost: '5.00',
      status: 'active',
    })));

    await trx('external_product_identity_map').insert(
      items.map(v => ({
        id: crypto.randomUUID(),
        lasyncro_variant_id: v.variantId,
        shop_id: shopId,
        platform: 'shopify',
        external_product_id: v.externalProductId,
        external_variant_id: v.externalVariantId,
      }))
    );
  });
}

function productPage(
  items: Item[],
  hasNextPage: boolean,
  endCursor: string | null
) {
  return {
    data: {
      products: {
        edges: items.map(v => ({
          node: {
            id: v.externalProductId,
            variants: {
              edges: [{
                node: {
                  id: v.externalVariantId,
                  inventoryQuantity: v.quantity,
                },
              }],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        })),
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

async function runSeed(shopId: number, client: any) {
  return withTenant(shopId, trx =>
    seedShopifyOpeningBalances(
      trx,
      'unused-synthetic-token',
      'synthetic.myshopify.com',
      shopId,
      client
    )
  );
}

async function snapshot(shopId: number) {
  return withTenant(shopId, async trx => {
    const expectations = await trx(
      'shopify_opening_inventory_expectations'
    ).where({ shop_id: shopId }).select(
      'external_variant_id',
      'reported_quantity'
    );

    const movements = await trx('inventory_movements')
      .where({ shop_id: shopId })
      .count('* as count')
      .first();

    return {
      expectations,
      movementCount: Number(movements?.count ?? 0),
    };
  });
}

describe('GH-1262 A2.1 — complete V2 opening snapshot RED', () => {
  it('A2I-01 — 51 mapped products produce 51 expectations', async () => {
    const shopId = await createShop();
    const items = makeItems(51);
    items[50].quantity = 999;

    await storeMappedItems(shopId, items);

    const client = {
      request: jest.fn()
        .mockResolvedValueOnce(
          productPage(items.slice(0, 50), true, 'product-cursor-50')
        )
        .mockResolvedValueOnce(
          productPage(items.slice(50), false, null)
        ),
    };

    await runSeed(shopId, client);

    const result = await snapshot(shopId);
    const last = result.expectations.find(
      r => r.external_variant_id === items[50].externalVariantId
    );

    expect({
      requests: client.request.mock.calls.length,
      cursorForwarded: JSON.stringify(
        client.request.mock.calls[1] ?? []
      ).includes('product-cursor-50'),
      expectationCount: result.expectations.length,
      lastQuantity: last ? Number(last.reported_quantity) : null,
      movementCount: result.movementCount,
    }).toEqual({
      requests: 2,
      cursorForwarded: true,
      expectationCount: 51,
      lastQuantity: 999,
      movementCount: 0,
    });
  });

  it('A2I-02 — page-two failure leaves no accepted V2 snapshot', async () => {
    const shopId = await createShop();
    const items = makeItems(1);

    await storeMappedItems(shopId, items);

    const client = {
      request: jest.fn()
        .mockResolvedValueOnce(
          productPage(items, true, 'product-cursor-next')
        )
        .mockRejectedValueOnce(
          new Error('SYNTHETIC_PROVIDER_PAGE_2_FAILED')
        ),
    };

    let observedError: string | null = null;

    try {
      await runSeed(shopId, client);
    } catch (error) {
      observedError = (error as Error).message;
    }

    const result = await snapshot(shopId);

    expect({
      requests: client.request.mock.calls.length,
      observedError,
      expectationCount: result.expectations.length,
      movementCount: result.movementCount,
    }).toEqual({
      requests: 2,
      observedError: 'SYNTHETIC_PROVIDER_PAGE_2_FAILED',
      expectationCount: 0,
      movementCount: 0,
    });
  });
});

/**
 * A2I-03/04: 101 variants belong to ONE product.
 * Only the opening snapshot is exercised; Shopify is mocked.
 */
async function createNestedFixture() {
  const shopId = await createShop();
  const productId = crypto.randomUUID();
  const externalProductId = 'gid://shopify/Product/880001';

  const items = makeItems(101).map(item => ({
    ...item,
    productId,
    externalProductId,
  }));

  items[100].quantity = 999;

  await withTenant(shopId, async trx => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Synthetic 101-variant product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert(items.map((v, i) => ({
      lasyncro_variant_id: v.variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `GH1262-NESTED-${i}`,
      title: `Nested variant ${i}`,
      unit_cost: '5.00',
      status: 'active',
    })));

    await trx('external_product_identity_map').insert(
      items.map(v => ({
        id: crypto.randomUUID(),
        lasyncro_variant_id: v.variantId,
        shop_id: shopId,
        platform: 'shopify',
        external_product_id: externalProductId,
        external_variant_id: v.externalVariantId,
      }))
    );
  });

  return { shopId, items, externalProductId };
}

function nestedEdges(items: Item[]) {
  return items.map(v => ({
    node: {
      id: v.externalVariantId,
      inventoryQuantity: v.quantity,
    },
  }));
}

function firstNestedPage(items: Item[], productId: string) {
  return {
    data: {
      products: {
        edges: [{
          node: {
            id: productId,
            variants: {
              edges: nestedEdges(items.slice(0, 100)),
              pageInfo: {
                hasNextPage: true,
                endCursor: 'variant-cursor-100',
              },
            },
          },
        }],
        pageInfo: {
          hasNextPage: false,
          endCursor: null,
        },
      },
    },
  };
}

describe('GH-1262 A2.1 — nested variant pagination RED', () => {
  it('A2I-03 — persists all 101 variants from one product', async () => {
    const { shopId, items, externalProductId } =
      await createNestedFixture();

    const nextVariants = {
      edges: nestedEdges(items.slice(100)),
      pageInfo: {
        hasNextPage: false,
        endCursor: null,
      },
    };

    const secondPage = {
      data: {
        product: {
          id: externalProductId,
          variants: nextVariants,
        },
        node: {
          id: externalProductId,
          variants: nextVariants,
        },
      },
    };

    const client = {
      request: jest.fn()
        .mockResolvedValueOnce(
          firstNestedPage(items, externalProductId)
        )
        .mockResolvedValueOnce(secondPage),
    };

    await runSeed(shopId, client);

    const result = await snapshot(shopId);
    const last = result.expectations.find(
      r => r.external_variant_id === items[100].externalVariantId
    );

    expect({
      requests: client.request.mock.calls.length,
      cursorForwarded: JSON.stringify(
        client.request.mock.calls[1] ?? []
      ).includes('variant-cursor-100'),
      expectationCount: result.expectations.length,
      lastQuantity: last ? Number(last.reported_quantity) : null,
      movementCount: result.movementCount,
    }).toEqual({
      requests: 2,
      cursorForwarded: true,
      expectationCount: 101,
      lastQuantity: 999,
      movementCount: 0,
    });
  });

  it('A2I-04 — nested-page failure cannot accept a partial snapshot', async () => {
    const { shopId, items, externalProductId } =
      await createNestedFixture();

    const client = {
      request: jest.fn()
        .mockResolvedValueOnce(
          firstNestedPage(items, externalProductId)
        )
        .mockRejectedValueOnce(
          new Error('SYNTHETIC_NESTED_PAGE_FAILURE')
        ),
    };

    let observedError: string | null = null;

    try {
      await runSeed(shopId, client);
    } catch (error) {
      observedError = (error as Error).message;
    }

    const result = await snapshot(shopId);

    expect({
      requests: client.request.mock.calls.length,
      observedError,
      expectationCount: result.expectations.length,
      movementCount: result.movementCount,
    }).toEqual({
      requests: 2,
      observedError: 'SYNTHETIC_NESTED_PAGE_FAILURE',
      expectationCount: 0,
      movementCount: 0,
    });
  });
});

/**
 * GH-1262 A2.1 — initial-sync completion boundary.
 * The real orchestrator and persistence paths are used.
 * Shopify, webhook registration, and refund backfill are mocked.
 */

function makeInitialSyncClient(items: Item[], failSecondPage: boolean) {
  const cursor = 'a2-fullsync-cursor-50';

  const client = {
    request: jest.fn(async (query: string, opts?: any) => {
      if (query.includes('orders(')) {
        return {
          data: {
            orders: {
              edges: [],
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }

      const isContinuation = JSON.stringify([query, opts ?? null])
        .includes(cursor);

      if (isContinuation && failSecondPage) {
        throw new Error('SYNTHETIC_CATALOG_CONTINUATION_FAILED');
      }

      const selected = isContinuation
        ? items.slice(50)
        : items.slice(0, 50);

      return {
        data: {
          products: {
            edges: selected.map(item => ({
              node: {
                id: item.externalProductId,
                title: `A2 initial product ${item.externalProductId}`,
                status: 'ACTIVE',
                productType: 'physical',
                featuredImage: null,
                variants: {
                  edges: [{
                    node: {
                      id: item.externalVariantId,
                      title: 'A2 initial variant',
                      sku: item.externalVariantId.split('/').pop(),
                      barcode: null,
                      image: null,
                      inventoryQuantity: item.quantity,
                      inventoryItem: {
                        id: `gid://shopify/InventoryItem/${
                          item.externalVariantId.split('/').pop()
                        }`,
                        unitCost: { amount: '5.00' },
                      },
                    },
                  }],
                  pageInfo: { hasNextPage: false, endCursor: null },
                },
              },
            })),
            pageInfo: {
              hasNextPage: !isContinuation,
              endCursor: isContinuation ? null : cursor,
            },
          },
          shop: {
            id: 'gid://shopify/Shop/1262',
            name: 'Synthetic A2 Store',
            email: 'synthetic@lasyncro.internal',
            currencyCode: 'USD',
          },
        },
      };
    }),
  };

  return client;
}

async function initialSyncFixture(failSecondPage: boolean) {
  const shopId = await createShop();

  const shopDomain = `gh1262-a2-${shopId}.myshopify.com`;

  const [integration] = await withTenant(shopId, trx =>
    trx('integrations')
      .insert({
        shop_id: shopId,
        platform: 'shopify',
        platform_shop_name: shopDomain,
        sync_status: 'PENDING',
        updated_at: new Date(),
      })
      .returning(['id'])
  );

  const items = makeItems(51);
  const client = makeInitialSyncClient(items, failSecondPage);

  return {
    shopId,
    shopDomain,
    integrationId: integration.id as number,
    client,
    items,
  };
}

async function initialSyncState(shopId: number, integrationId: number) {
  return withTenant(shopId, async trx => {
    const integration = await trx('integrations')
      .where({ id: integrationId, shop_id: shopId })
      .first('sync_status');

    const count = async (table: string) => {
      const row = await trx(table)
        .where({ shop_id: shopId })
        .count('* as count')
        .first();

      return Number(row?.count ?? 0);
    };

    const completionEvents = await trx('domain_events')
      .where({
        shop_id: shopId,
        event_type: 'integration/sync_completed',
      })
      .count('* as count')
      .first();

    return {
      status: integration?.sync_status,
      products: await count('products'),
      variants: await count('variants'),
      mappings: await count('external_product_identity_map'),
      expectations: await count('shopify_opening_inventory_expectations'),
      movements: await count('inventory_movements'),
      completionEvents: Number(completionEvents?.count ?? 0),
    };
  });
}

describe('GH-1262 A2.1 — initial sync completion RED', () => {
  it('A2I-05 — COMPLETED requires all 51 Shopify products', async () => {
    const f = await initialSyncFixture(false);

    await performInitialSync(
      'unused-synthetic-token',
      f.shopDomain,
      f.shopId,
      f.integrationId,
      { shopifyClient: f.client }
    );

    const state = await initialSyncState(f.shopId, f.integrationId);

    expect(state).toEqual({
      status: 'COMPLETED',
      products: 51,
      variants: 51,
      mappings: 51,
      expectations: 51,
      movements: 0,
      completionEvents: 1,
    });
  }, 120000);

  it('A2I-06 — failed continuation never completes initial sync', async () => {
    const f = await initialSyncFixture(true);

    let observedError: string | null = null;

    try {
      await performInitialSync(
        'unused-synthetic-token',
        f.shopDomain,
        f.shopId,
        f.integrationId,
        { shopifyClient: f.client }
      );
    } catch (error) {
      observedError = (error as Error).message;
    }

    const state = await initialSyncState(f.shopId, f.integrationId);

    expect({
      observedError,
      status: state.status,
      expectations: state.expectations,
      movements: state.movements,
      completionEvents: state.completionEvents,
    }).toEqual({
      observedError: 'SYNTHETIC_CATALOG_CONTINUATION_FAILED',
      status: 'FAILED',
      expectations: 0,
      movements: 0,
      completionEvents: 0,
    });
  }, 120000);
});

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
import { syncProducts } from 'api-src/services/shopify/shopifyProducts.core';
import { GET_PRODUCTS_QUERY } from 'api-src/services/shopify/shopify.queries';
import { handleProductUpdated } from 'api-src/api/shopify/handlers/handleProductUpdated';
import type { WebhookEnvelope } from 'api-src/api/webhooks/types';
import { seedOfflineShopifySyncAuthority } from '../lifecycle/shopify-sync-authority.fixture';

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
  // GH-1068 T2: performInitialSync requires the current installation and
  // credential generation (canonical offline fixture; no provider call).
  const executionAuthority = await seedOfflineShopifySyncAuthority(shopId, shopDomain);

  return {
    shopId,
    shopDomain,
    integrationId: integration.id as number,
    client,
    items,
    executionAuthority,
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
      { shopifyClient: f.client, executionAuthority: f.executionAuthority }
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
        { shopifyClient: f.client, executionAuthority: f.executionAuthority }
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

/**
 * GH-1262 A2.2 C4a — fenced full-sync snapshot apply.
 * A reconnect / recovery sync re-runs the real performInitialSync over a
 * catalog already ingested with watermarks (the post-reset state: catalog kept,
 * integration PENDING). Shopify, webhook registration and refund backfill are
 * mocked; the product webhook handler is the real one.
 */
describe('GH-1262 A2.2 — full-sync freshness baseline (C4a)', () => {
  const T1 = '2026-09-01T10:00:00Z';

  function catalogNode(item: Item, title: string) {
    return {
      id: item.externalProductId,
      title,
      status: 'ACTIVE',
      productType: 'physical',
      featuredImage: null,
      updatedAt: T1,
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
              id: `gid://shopify/InventoryItem/${item.externalVariantId.split('/').pop()}`,
              unitCost: { amount: '5.00' },
            },
          },
        }],
        pageInfo: { hasNextPage: false, endCursor: null },
      },
    };
  }

  /** One-page Shopify stub; `onCatalogFetch` runs inside the first catalog-sync request. */
  function resyncClient(nodes: any[], onCatalogFetch?: () => Promise<void>) {
    let catalogFetches = 0;
    return {
      request: jest.fn(async (query: string) => {
        if (query.includes('orders(')) {
          return { data: { orders: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
        }
        if (query === GET_PRODUCTS_QUERY && catalogFetches++ === 0 && onCatalogFetch) {
          await onCatalogFetch();
        }
        return {
          data: {
            products: {
              edges: nodes.map(node => ({ node })),
              pageInfo: { hasNextPage: false, endCursor: null },
            },
          },
        };
      }),
    };
  }

  /** Catalog previously ingested at T1, integration PENDING after a reset, canonical authority. */
  async function ingestedCatalog(count: number) {
    const shopId = await createShop();
    const shopDomain = `gh1262-a2c4a-${shopId}.myshopify.com`;
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
    const executionAuthority = await seedOfflineShopifySyncAuthority(shopId, shopDomain);
    const items = makeItems(count);
    const ingest = await withTenant(shopId, trx =>
      syncProducts(trx, shopId, items.map(item => ({ node: catalogNode(item, `ingested ${item.externalProductId}`) }))));
    expect(ingest.map(r => r.outcome)).toEqual(items.map(() => 'applied'));
    return { shopId, shopDomain, integrationId: integration.id as number, executionAuthority, items };
  }

  async function catalogFacts(shopId: number) {
    return withTenant(shopId, async trx => ({
      watermarks: await trx('shopify_product_source_watermarks')
        .where({ shop_id: shopId, platform: 'shopify' })
        .orderBy('external_product_id')
        .select(
          'external_product_id',
          'reconcile_generation',
          'reconcile_attempts',
          trx.raw('reconcile_requested_at IS NOT NULL AS pending'),
          trx.raw(`to_char(source_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS source_updated_at`)
        ),
      products: await trx('external_product_identity_map as m')
        .join('variants as v', 'v.lasyncro_variant_id', 'm.lasyncro_variant_id')
        .join('products as p', 'p.lasyncro_product_id', 'v.lasyncro_product_id')
        .where({ 'm.shop_id': shopId, 'm.platform': 'shopify' })
        .orderBy('m.external_product_id')
        .select('m.external_product_id', 'm.id as mapping_id', 'v.lasyncro_variant_id',
          'p.lasyncro_product_id', 'p.title', 'p.status'),
    }));
  }

  const resync = (f: Awaited<ReturnType<typeof ingestedCatalog>>, client: unknown) =>
    performInitialSync('unused-synthetic-token', f.shopDomain, f.shopId, f.integrationId,
      { shopifyClient: client as any, executionAuthority: f.executionAuthority });

  it('M2a — an unchanged reconnect sync over an ingested catalog records zero obligations and changes no identity', async () => {
    const f = await ingestedCatalog(3);
    const before = await catalogFacts(f.shopId);
    expect(before.watermarks.map(w => [w.pending, w.reconcile_generation, w.source_updated_at]))
      .toEqual(f.items.map(() => [false, 0, '2026-09-01T10:00:00.000000Z']));

    await resync(f, resyncClient(f.items.map(item => catalogNode(item, `ingested ${item.externalProductId}`))));

    const after = await catalogFacts(f.shopId);
    expect((await initialSyncState(f.shopId, f.integrationId)).status).toBe('COMPLETED');
    expect(after.watermarks).toEqual(before.watermarks);
    expect(after.products).toEqual(before.products);

    // Control: the same equal-timestamp input WITHOUT a pre-fetch baseline is
    // untrusted and still queues exactly one obligation (no unfenced fast path).
    const control = await withTenant(f.shopId, trx =>
      syncProducts(trx, f.shopId, [{ node: catalogNode(f.items[0], `ingested ${f.items[0].externalProductId}`) }]));
    expect(control.map(r => r.outcome)).toEqual(['reconcile_requested']);
  });

  it('M2b — an equal-timestamp webhook committed between the baseline and the apply prevents the snapshot overwrite and stays pending', async () => {
    const f = await ingestedCatalog(3);
    const [target, ...unchanged] = f.items;
    const numeric = (gid: string) => Number(gid.split('/').pop());

    const envelope: WebhookEnvelope = {
      integration: 'shopify',
      eventId: crypto.randomUUID(),
      eventType: 'products/update',
      verified: true,
      receivedAt: new Date(),
      shopDomain: f.shopDomain,
      rawPayload: {
        id: numeric(target.externalProductId),
        title: `webhook ${target.externalProductId}`,
        status: 'archived',
        product_type: 'physical',
        image: null,
        updated_at: T1,
        variants: [{
          id: numeric(target.externalVariantId),
          title: 'A2 initial variant',
          sku: target.externalVariantId.split('/').pop(),
          barcode: null,
          inventory_item_id: numeric(target.externalVariantId),
        }],
      },
    };

    // Shopify serves the target with different content at the SAME timestamp.
    const client = resyncClient(
      [catalogNode(target, `snapshot ${target.externalProductId}`),
        ...unchanged.map(item => catalogNode(item, `ingested ${item.externalProductId}`))],
      () => withTenant(f.shopId, trx => handleProductUpdated(envelope, trx)));

    const before = await catalogFacts(f.shopId);
    await resync(f, client);
    const after = await catalogFacts(f.shopId);

    expect((await initialSyncState(f.shopId, f.integrationId)).status).toBe('COMPLETED');
    // Target: neither the snapshot nor the webhook state was applied; one
    // coalesced obligation remains pending (webhook + snapshot generations).
    expect(after.products.filter(p => p.external_product_id === target.externalProductId))
      .toEqual(before.products.filter(p => p.external_product_id === target.externalProductId));
    expect(after.watermarks.find(w => w.external_product_id === target.externalProductId))
      .toMatchObject({ pending: true, reconcile_attempts: 0, reconcile_generation: 2,
        source_updated_at: '2026-09-01T10:00:00.000000Z' });
    // The untouched products took the fenced fast path: no obligation.
    expect(after.watermarks.filter(w => w.external_product_id !== target.externalProductId))
      .toEqual(before.watermarks.filter(w => w.external_product_id !== target.externalProductId));
  });
});

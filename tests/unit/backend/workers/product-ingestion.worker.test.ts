//tests/unit/backend/workers/product-ingestion.worker.test.ts
import db from 'api-db';
import { processProductMessage } from 'api-src/workers/product-worker';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

describe('product ingestion → canonical persistence', () => {
  const shopId = 3001;
  const userId = 4001;

  afterEach(async () => {
    await db('shop_ingestion_events').del();
    await db('products').del();
    await db('users').del();
    await db('shops').del();
  });

  it('persists a canonical product when a Shopify product is processed', async () => {
    await seedShopAndUser({ shopId, userId });

    const rawShopifyProduct = {
      id: 'gid://shopify/Product/123',
      title: 'Test Product',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variants: {
        edges: [],
      },
    };

    await processProductMessage({
      shopId,
      platform: 'shopify',
      rawProduct: rawShopifyProduct,
    });

    const rows = await db('products').where({ shop_id: shopId });

    expect(rows.length).toBeGreaterThan(0);
  });

  it('records a sku-os ingestion event on first successful product ingestion', async () => {
    await seedShopAndUser({ shopId, userId });

    const rawShopifyProduct = {
      id: 'gid://shopify/Product/ingestion-event-1',
      title: 'Event Product',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variants: {
        edges: [],
      },
    };

    // sanity: no ingestion events yet
    const before = await db('shop_ingestion_events')
      .where({ shop_id: shopId, module_id: 'sku-os' });

    expect(before.length).toBe(0);

    await processProductMessage({
      shopId,
      platform: 'shopify',
      rawProduct: rawShopifyProduct,
    });

    const events = await db('shop_ingestion_events')
      .where({
        shop_id: shopId,
        module_id: 'sku-os',
        event: 'product_ingested',
      });

    expect(events.length).toBe(1);
  });

  it('does NOT create a second sku-os ingestion event when multiple products are ingested', async () => {
    await seedShopAndUser({ shopId, userId });

    const productA = {
      id: 'gid://shopify/Product/idempotent-1',
      title: 'First Product',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variants: { edges: [] },
    };

    const productB = {
      id: 'gid://shopify/Product/idempotent-2',
      title: 'Second Product',
      status: 'ACTIVE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      variants: { edges: [] },
    };

    await processProductMessage({
      shopId,
      platform: 'shopify',
      rawProduct: productA,
    });

    await processProductMessage({
      shopId,
      platform: 'shopify',
      rawProduct: productB,
    });

    const events = await db('shop_ingestion_events').where({
      shop_id: shopId,
      module_id: 'sku-os',
      event: 'product_ingested',
    });

    expect(events.length).toBe(1);
  });
});
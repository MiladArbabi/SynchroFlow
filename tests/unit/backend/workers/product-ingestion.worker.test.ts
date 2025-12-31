//tests/unit/backend/workers/product-ingestion.worker.test.ts
import db from 'api-db';
import { processProductMessage } from 'api-src/workers/product-worker';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';

describe('product ingestion → canonical persistence', () => {
  const shopId = 3001;
  const userId = 4001;

  afterEach(async () => {
    await db('canonical_products').del();
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

    const rows = await db('canonical_products').where({ shop_id: shopId });

    expect(rows.length).toBeGreaterThan(0);
  });
});
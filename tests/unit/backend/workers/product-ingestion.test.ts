// tests/unit/backend/workers/product-ingestion.test.ts

import db from 'api-db';
import { seedShopAndUser } from '../../helpers/seedShopAndUser';
import { seedIntegration } from '../../helpers/seedIntegration';
import { processProductMessage } from 'api-src/workers/product-worker';

describe('product ingestion → canonical_products', () => {
  const shopId = 1001;
  const userId = 2001;

  beforeEach(async () => {
    await db('canonical_products').del();
    await db('integrations').del();
    await db('users').del();
    await db('shops').del();

    await seedShopAndUser({ shopId, userId });
    await seedIntegration({ shopId });
  });

  it('inserts a canonical product when processing a Shopify product message', async () => {
    const rawShopifyProduct = {
      id: 'gid://shopify/Product/123456789',
      title: 'Test Shopify Product',
      status: 'ACTIVE',
      variants: {
        edges: [],
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // sanity: canonical_products starts empty
    const before = await db('canonical_products').count<{ count: string }>('* as count').first();
    expect(Number(before?.count)).toBe(0);

    await processProductMessage({
      shopId,
      platform: 'shopify',
      rawProduct: rawShopifyProduct,
    });

    const after = await db('canonical_products').count<{ count: string }>('* as count').first();
    expect(Number(after?.count)).toBe(1);
  });
});
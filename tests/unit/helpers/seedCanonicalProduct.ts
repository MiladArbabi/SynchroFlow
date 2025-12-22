// tests/unit/helpers/seedCanonicalProduct.ts

import db from 'api-db';

type SeedCanonicalProductInput = {
  shopId: number;
  platformProductId?: string;
  title?: string;
};

export async function seedCanonicalProduct({
  shopId,
  platformProductId = 'shopify-product-001',
  title = 'Test Product',
}: SeedCanonicalProductInput) {
  await db('canonical_products').insert({
    shop_id: shopId,
    platform: 'shopify',
    platform_product_id: platformProductId,
    title,
    // canonical_product_id is auto-generated
    // status defaults to 'active'
  });
}

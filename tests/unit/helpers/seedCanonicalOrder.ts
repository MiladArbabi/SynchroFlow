// tests/unit/helpers/seedCanonicalOrder.ts

import db from 'api-db';

type SeedCanonicalOrderInput = { 
  shopId: number;
  canonicalOrderId?: string;
  platformOrderId?: string;
};

export async function seedCanonicalOrder({
  shopId,
  canonicalOrderId = 'order-001',
  platformOrderId = 'shopify-order-001',
}: SeedCanonicalOrderInput) {
  const now = new Date();

  await db('canonical_orders').insert({
    shop_id: shopId,

    canonical_order_id: canonicalOrderId,
    platform: 'shopify',
    platform_order_id: platformOrderId,

    currency: 'USD',
    subtotal_price: 100.0,
    total_tax: 10.0,
    total_price: 110.0,

    order_created_at: now,
    order_updated_at: now,
  });
}

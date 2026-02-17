// tests/unit/helpers/seedCanonicalOrder.ts

import db from '@lasyncro/backend-core/db.js';
import { randomUUID } from 'crypto';

type SeedCanonicalOrderInput = { 
  shopId: number;
  canonicalOrderId?: string;
  platformOrderId?: string;
  createdAt?: string;
};

export async function seedCanonicalOrder({
  shopId,
  canonicalOrderId = `order-${randomUUID()}`,
  platformOrderId = `shopify-order-${randomUUID()}`,
  createdAt,
}: SeedCanonicalOrderInput) {
  const now = createdAt ? new Date(createdAt) : new Date();

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

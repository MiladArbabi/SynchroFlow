// tests/unit/helpers/seedShopAndUser.ts

import db from 'api-db';

type SeedArgs = {
  shopId: number;
  userId: number;
};

export async function seedShopAndUser({ shopId, userId }: SeedArgs) {
  // --- Shop ---
  await db('shops').insert({
    id: shopId,
    name: `FT0 Test Shop ${shopId}`,
    contact_email: `shop-${shopId}@example.com`,
    auth_secret: `test-secret-${shopId}`,
    primary_erp_type: 'NONE',
    primary_ecomm_type: 'SHOPIFY',
  });

  // --- User ---
  await db('users').insert({
    id: userId,
    shop_id: shopId,
    email: `user-${userId}@example.com`,
    password_hash: 'test-hash',
    first_insight_delivered: false,
  });
}
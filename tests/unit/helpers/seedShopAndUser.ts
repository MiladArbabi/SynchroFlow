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
    email: `user-${userId}@example.com`,
    password_hash: 'test-hash',
    first_insight_delivered: false,
  });

  // --- REQUIRED: Active shop membership ---
  await db('shop_memberships').insert({
    user_id: userId,
    shop_id: shopId,
    role: 'owner',
    revoked_at: null,
    created_at: new Date(),
  });
}
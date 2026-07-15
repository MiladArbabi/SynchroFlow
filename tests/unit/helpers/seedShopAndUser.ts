import db, { withTenant } from '@lasyncro/backend-core/db.js';

type SeedArgs = {
  shopId: number;
  userId: number;
};

export async function seedShopAndUser({ shopId, userId }: SeedArgs) {
  // --- Shop ---
  // ISS-C29: helper previously inserted columns (auth_secret, contact_email,
  // primary_erp_type, primary_ecomm_type) that no longer exist on shops,
  // and omitted shop_id on the users insert despite it being NOT NULL —
  // both tests using this helper have never actually run successfully.
  await db('shops').insert({
    id: shopId,
    name: `FT0 Test Shop ${shopId}`,
    first_insight_delivered: false,
  });
  // --- User ---
  await db('users').insert({
    id: userId,
    shop_id: shopId,
    email: `user-${userId}@example.com`,
    password_hash: 'test-hash',
  });

  // --- REQUIRED: Active shop membership ---
  // ISS-C30: shop_memberships enforces a strict tenant-scoped write policy
  // (unlike shops/users, which have an open bootstrap insert policy) —
  // must set app.current_tenant via withTenant() or this insert is
  // blocked by RLS.
  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      user_id: userId,
      shop_id: shopId,
      role: 'owner',
      revoked_at: null,
      created_at: new Date(),
    });
  });
}
// apps/backend/seeds/dev_seed.ts
import type { Knex } from 'knex';
import bcrypt from 'bcrypt';

/**
 * DEV SEED — IDENTITY-AWARE
 * ------------------------
 *
 * This seed is intentionally strict.
 *
 * Auth in SynchroFlow REQUIRES:
 *   user
 * + shop
 * + active shop_membership
 *
 * Creating users without memberships is a VALID state
 * but those users MUST NOT be able to log in.
 *
 * Use DEV_SEED_MODE=full_identity
 * if you explicitly want a loginable dev user.
 */

const DEV_USER_EMAIL = 'test@example.com';
const DEV_USER_PASSWORD = 'password123';

export async function seed(knex: Knex): Promise<void> {
  console.log('────────────────────────────────────────');
  console.log('[DEV_SEED] Starting development seed');
  console.log('[DEV_SEED] Mode:', process.env.DEV_SEED_MODE ?? 'safe');
  console.log('────────────────────────────────────────');

  /**
   * 1️⃣ CLEAN DATABASE (ORDER MATTERS)
   * --------------------------------
   * We delete from leaf tables upward to avoid FK issues.
   */
  console.log('[DEV_SEED] Clearing existing data…');

  await knex('order_line_items').del();
  await knex('order_fulfillment_status').del();
  await knex('shop_memberships').del();
  await knex('users').del();
  await knex('shops').del();

  /**
   * 2️⃣ CREATE SHOP
   * --------------
   * A shop is required for ANY meaningful activity.
   */
  console.log('[DEV_SEED] Creating dev shop…');

  const [shop] = await knex('shops')
    .insert({
      name: 'Default Dev Shop',
    })
    .returning('*');

  if (!shop) {
    throw new Error('[DEV_SEED] Failed to create shop');
  }

  console.log(`[DEV_SEED] Shop created (id=${shop.id})`);

  /**
   * 3️⃣ CREATE USER (NO MAGIC)
   * ------------------------
   * Users alone are NOT a valid identity.
   */
  console.log('[DEV_SEED] Creating dev user…');

  const passwordHash = await bcrypt.hash(DEV_USER_PASSWORD, 10);

  const [user] = await knex('users')
    .insert({
      shop_id: shop.id,
      email: DEV_USER_EMAIL,
      password_hash: passwordHash,
      first_name: 'Test',
      last_name: 'User',
    })
    .returning('*');

  if (!user) {
    throw new Error('[DEV_SEED] Failed to create user');
  }

  console.log(`[DEV_SEED] User created (id=${user.id}, email=${user.email})`);

  /**
   * 4️⃣ OPTIONALLY CREATE MEMBERSHIP
   * -------------------------------
   * This is the ENTIRE difference between:
   *  - "login works"
   *  - "403 NO_ACTIVE_SHOP_MEMBERSHIP"
   */
  if (process.env.DEV_SEED_MODE === 'full_identity') {
    console.log('[DEV_SEED] Creating ACTIVE shop membership (OWNER)…');

    await knex('shop_memberships').insert({
      shop_id: shop.id,
      user_id: user.id,
      role: 'owner',
    });

    console.log('[DEV_SEED] ✅ Full identity seeded');
    console.log('[DEV_SEED] → This user CAN log in');
  } else {
    console.log('[DEV_SEED] ⚠️ No shop membership created');
    console.log('[DEV_SEED] → This user CANNOT log in');
  }

  /**
   * 5️⃣ OPTIONAL DOMAIN DATA
   * -----------------------
   * These do NOT affect auth. They are safe.
   */
  console.log('[DEV_SEED] Seeding example order data…');

  // ❌ REMOVED
  // Fulfillment execution truth is NOT seeded.
  // It is derived asynchronously via fulfillment reconciliation worker.

  console.log('────────────────────────────────────────');
  console.log('[DEV_SEED] Completed successfully');
  console.log('────────────────────────────────────────');
}

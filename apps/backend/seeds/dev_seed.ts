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

const DEV_USER_EMAIL = process.env.DEV_SEED_EMAIL ?? 'owner@test.com';
const DEV_USER_PASSWORD = 'password123';

export async function seed(knex: Knex): Promise<void> {
  console.log('────────────────────────────────────────');
  console.log('[DEV_SEED] Starting development seed');
  console.log('[DEV_SEED] Mode:', process.env.DEV_SEED_MODE ?? 'safe');
  console.log('────────────────────────────────────────');

  await knex.transaction(async (trx) => {
    // Unlock projection-protected tables for seed writes
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

  /**
   * 1️⃣ SKIP DESTRUCTIVE CLEAN
   * --------------------------
   * Several tables (domain_events, ft0_state, ft2_state, order_revenue_units)
   * have immutability triggers that block DELETE.
   * Seed uses idempotent upserts instead — safe to re-run.
   */
  console.log('[DEV_SEED] Skipping destructive clean (immutable tables present)…');

  /**
   * 2️⃣ CREATE SHOP
   * --------------
   * A shop is required for ANY meaningful activity.
   */
  console.log('[DEV_SEED] Creating dev shop…');

  // RLS bypassed for seed via raw SQL — shops table uses id-based policy
  // Find existing user by email first, derive shop from user
  const existingUserByEmail = await trx.raw(
    `SELECT * FROM users WHERE email = ? LIMIT 1`, [DEV_USER_EMAIL]
  );
  const existingUserRow = existingUserByEmail.rows?.[0] ?? null;

  let shop: any;
  if (existingUserRow) {
    const shopResult = await trx.raw(`SELECT * FROM shops WHERE id = ? LIMIT 1`, [existingUserRow.shop_id]);
    shop = shopResult.rows?.[0] ?? null;
  }

  if (!shop) {
    const result = await trx.raw(`INSERT INTO shops (name) VALUES (?) RETURNING *`, ['Default Dev Shop']);
    shop = result.rows[0];
    console.log(`[DEV_SEED] Shop created (id=${shop.id})`);
  } else {
    console.log(`[DEV_SEED] Reusing existing shop (id=${shop.id})`);
  }

  if (!shop) {
    throw new Error('[DEV_SEED] Failed to create shop');
  }

  /**
   * 3️⃣ CREATE USER (NO MAGIC)
   * ------------------------
   * Users alone are NOT a valid identity.
   */
  console.log('[DEV_SEED] Creating dev user…');

  const passwordHash = await bcrypt.hash(DEV_USER_PASSWORD, 10);

// Reuse existing user by email (globally unique)
  let user = existingUserRow;
  if (!user) {
    const [inserted] = await trx('users')
      .insert({
        shop_id: shop.id,
        email: DEV_USER_EMAIL,
        password_hash: passwordHash,
        first_name: 'Owner',
        last_name: 'Dev',
      })
      .returning('*');
    user = inserted;
    console.log(`[DEV_SEED] User created (id=${user.id}, email=${user.email})`);
  } else {
    console.log(`[DEV_SEED] Reusing existing user (id=${user.id})`);
  }

  if (!user) {
    throw new Error('[DEV_SEED] Failed to create user');
  }

  /**
   * 4️⃣ OPTIONALLY CREATE MEMBERSHIP
   * -------------------------------
   * This is the ENTIRE difference between:
   *  - "login works"
   *  - "403 NO_ACTIVE_SHOP_MEMBERSHIP"
   */
  if (process.env.DEV_SEED_MODE === 'full_identity') {
    console.log('[DEV_SEED] Creating ACTIVE shop membership (OWNER)…');

    await trx('shop_memberships').insert({
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
   * DEV_SEED_MODE=full_data seeds realistic operational data.
   * Produces enough data for trust gate to pass and all FT2
   * surfaces (morning brief, cash flow, demand) to render.
   *
   * Requires full_identity to have run first (user + membership).
   */
  if (process.env.DEV_SEED_MODE === 'full_data' || process.env.DEV_SEED_MODE === 'full_identity') {
    // full_data requires full_identity — ensure membership exists
    const membershipExists = await trx('shop_memberships')
      .where({ shop_id: shop.id, user_id: user.id })
      .first();

    if (!membershipExists) {
      await trx('shop_memberships').insert({
        shop_id: shop.id,
        user_id: user.id,
        role: 'owner',
      });
    }
  }

  if (process.env.DEV_SEED_MODE === 'full_data') {
    console.log('[DEV_SEED] Seeding full operational data (trust + FT2)…');

    // ── PRODUCTS + VARIANTS ──────────────────────────────────────────────────
    // Trust needs: products.updated_at non-null, variants with clean SKUs
    const now = new Date();

    const productDefs = [
      { title: 'Linen Shirt', sku_prefix: 'LINEN', variants: ['GRY-S', 'GRY-M', 'GRY-L', 'NVY-M', 'NVY-L'] },
      { title: 'Wool Sweater', sku_prefix: 'WOOL', variants: ['NVY', 'GRN', 'BLK'] },
      { title: 'Canvas Tote', sku_prefix: 'TOTE', variants: ['NAT', 'BLK'] },
    ];

    const productIds: string[] = [];
    const variantIds: { lasyncro_variant_id: string; sku: string; product_id: string }[] = [];

    for (const def of productDefs) {
      let product = await trx('products')
        .where({ shop_id: shop.id, title: def.title })
        .first();
      if (!product) {
        const [inserted] = await trx('products').insert({
          shop_id: shop.id,
          lasyncro_product_id: trx.raw('gen_random_uuid()'),
          title: def.title,
          updated_at: now,
          created_at: now,
        }).returning('*');
        product = inserted;
      }

      productIds.push(product.lasyncro_product_id);

      for (const variantSuffix of def.variants) {
        const sku = `${def.sku_prefix}-${variantSuffix}`;
        let variant = await trx('variants')
          .where({ shop_id: shop.id, sku })
          .first();
        if (!variant) {
          const [inserted] = await trx('variants').insert({
            shop_id: shop.id,
            lasyncro_variant_id: trx.raw('gen_random_uuid()'),
            lasyncro_product_id: product.lasyncro_product_id,
            sku,
            title: variantSuffix,
            unit_cost: 25.00,
            updated_at: now,
            created_at: now,
          }).returning('*');
          variant = inserted;
        };

        variantIds.push({
          lasyncro_variant_id: variant.lasyncro_variant_id,
          sku: variant.sku,
          product_id: product.lasyncro_product_id,
        });
      }
    }

    console.log(`[DEV_SEED] Created ${productIds.length} products, ${variantIds.length} variants`);

    // ── INVENTORY TRUTH ──────────────────────────────────────────────────────
    // Trust needs: inventory_truth with non-null updated_at
    const locationCode = `WH-${shop.id}-ROOT`;

    for (const v of variantIds) {
      await trx('inventory_truth').insert({
        shop_id: shop.id,
        lasyncro_variant_id: v.lasyncro_variant_id,
        location_code: locationCode,
        on_hand_quantity: Math.floor(Math.random() * 80) + 20,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: Math.floor(Math.random() * 80) + 20,
        sellable_quantity: Math.floor(Math.random() * 80) + 20,
        last_evaluated_at: now,
      }).onConflict(['shop_id', 'lasyncro_variant_id', 'location_code']).merge();
    }

    console.log(`[DEV_SEED] Created inventory_truth for ${variantIds.length} variants`);

    // ── CUSTOMERS ────────────────────────────────────────────────────────────
    const customerHashes: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const hash = `dev_customer_hash_${i}_shop_${shop.id}`;
      await trx('customers').insert({
        shop_id: shop.id,
        external_customer_id: hash,
        email: `customer${i}@devshop.com`,
        first_name: `Customer`,
        last_name: `${i}`,
        created_at: now,
        updated_at: now,
      }).onConflict(['shop_id', 'external_customer_id']).ignore();
      customerHashes.push(hash);
    }

    console.log(`[DEV_SEED] Created 5 customers`);

    // ── ORDERS + REVENUE UNITS + FULFILLMENT ─────────────────────────────────
    // Trust needs: orders + order_revenue_units + order_fulfillment_status
    // All within past_30_days window
    const orderCount = 15;
    const orderIds: string[] = [];

    for (let i = 0; i < orderCount; i++) {
      const orderDate = new Date(now);
      orderDate.setDate(orderDate.getDate() - Math.floor(Math.random() * 28));

      const variant = variantIds[Math.floor(Math.random() * variantIds.length)];
      const qty = Math.floor(Math.random() * 3) + 1;
      const unitPrice = 59.95;
      const totalPrice = qty * unitPrice;
      const customerHash = customerHashes[Math.floor(Math.random() * customerHashes.length)];

      const [order] = await trx('orders').insert({
        shop_id: shop.id,
        lasyncro_order_id: trx.raw('gen_random_uuid()'),
        aggregate_version: 1,
        last_projected_version: 1,
        payment_state: 'paid',
        currency: 'USD',
        total_price: totalPrice,
        subtotal_price: totalPrice,
        total_tax: 0,
        customer_hashed_id: customerHash,
        order_created_at: orderDate,
        order_updated_at: orderDate,
        created_at: orderDate,
        updated_at: orderDate,
      }).returning('*');

      orderIds.push(order.lasyncro_order_id);

      // Revenue units
      await trx('order_revenue_units').insert({
        lasyncro_revenue_unit_id: trx.raw('gen_random_uuid()'),
        lasyncro_order_id: order.lasyncro_order_id,
        lasyncro_product_id: variant.product_id,
        lasyncro_variant_id: variant.lasyncro_variant_id,
        sku: variant.sku,
        title: variant.sku,
        quantity: qty,
        fulfilled_quantity: 0,
        unit_price: unitPrice,
        line_total: totalPrice,
        estimated_unit_cost: 25.00,
        created_at: orderDate,
        updated_at: orderDate,
      }).onConflict(['lasyncro_order_id', 'lasyncro_variant_id']).ignore();

      // Fulfillment status — requires projection writer bypass
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      const isFulfilled = i < 8; // first 8 orders fulfilled
      await trx('order_fulfillment_status').insert({
        lasyncro_fulfillment_id: trx.raw('gen_random_uuid()'),
        lasyncro_order_id: order.lasyncro_order_id,
        status: isFulfilled ? 'fulfilled' : 'pending',
        status_reason: isFulfilled ? 'seed_fulfilled' : 'seed_pending',
        status_updated_at: now,
        fulfilled_at: isFulfilled ? now : null,
        created_at: orderDate,
        updated_at: now,
      }).onConflict(['lasyncro_order_id']).ignore();
    }

    console.log(`[DEV_SEED] Created ${orderCount} orders with revenue units and fulfillment status`);

    // ── SHOPIFY INTEGRATION (for Shopify-dependent services) ─────────────────
    await trx('integrations').insert({
      shop_id: shop.id,
      platform: 'shopify',
      platform_shop_name: 'dev-shop.myshopify.com',
      access_token_encrypted: 'dev_seed_placeholder_not_real',
      sync_status: 'COMPLETED',
      created_at: now,
      updated_at: now,
    }).onConflict(['shop_id', 'platform']).ignore();

    console.log('[DEV_SEED] ✅ Full operational data seeded');
    console.log('[DEV_SEED] → Trust gate will pass');
    console.log('[DEV_SEED] → Morning brief, cash flow, and FT2 surfaces ready');
  }

  console.log('────────────────────────────────────────');
  console.log('[DEV_SEED] Completed successfully');
  console.log('────────────────────────────────────────');
  }); 
}

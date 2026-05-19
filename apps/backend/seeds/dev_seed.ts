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

    // Seed growth tier subscription — required for WMS + FT2 access
    await trx('shop_subscriptions')
      .insert({
        shop_id: shop.id,
        tier: 'growth',
        billing_interval: 'monthly',
        status: 'active',
      })
      .onConflict('shop_id')
      .merge({ tier: 'growth', status: 'active' });

  /**
   * 4️⃣ OPTIONALLY CREATE MEMBERSHIP
   * -------------------------------
   * This is the ENTIRE difference between:
   *  - "login works"
   *  - "403 NO_ACTIVE_SHOP_MEMBERSHIP"
   */
  if (process.env.DEV_SEED_MODE === 'full_identity') {
    console.log('[DEV_SEED] Creating ACTIVE shop membership (OWNER)…');
    
    await trx('shop_memberships')
      .insert({
        shop_id: shop.id,
        user_id: user.id,
        role: 'owner',
      })
      .onConflict(['shop_id', 'user_id'])
      .merge({ role: 'owner' });

    console.log('[DEV_SEED] ✅ Full identity seeded');
    console.log('[DEV_SEED] → This user CAN log in');

    // Seed WMS settings — required for batch release
    await trx('shop_wms_settings')
      .insert({ shop_id: shop.id })
      .onConflict('shop_id')
      .ignore();

    // ── OPERATOR USER ──────────────────────────────────────────────────────
    // Provides mobile login credentials for operator-role testing.
    // Email: operator@test.com / password123
    const OPERATOR_EMAIL = 'operator@test.com';
    const operatorPasswordHash = await bcrypt.hash('password123', 10);

    const existingOperator = await trx('users')
      .where({ email: OPERATOR_EMAIL })
      .first();

    let operatorUser = existingOperator;
    if (!operatorUser) {
      const [inserted] = await trx('users')
        .insert({
          shop_id: shop.id,
          email: OPERATOR_EMAIL,
          password_hash: operatorPasswordHash,
          first_name: 'Operator',
          last_name: 'Dev',
        })
        .returning('*');
      operatorUser = inserted;
      console.log(`[DEV_SEED] Operator user created (id=${operatorUser.id}, email=${operatorUser.email})`);
    } else {
      console.log(`[DEV_SEED] Reusing existing operator user (id=${operatorUser.id})`);
    }

    await trx('shop_memberships')
      .insert({
        shop_id: shop.id,
        user_id: operatorUser.id,
        role: 'operator',
      })
      .onConflict(['shop_id', 'user_id'])
      .ignore();

    console.log('[DEV_SEED] ✅ Operator identity seeded');
    console.log('[DEV_SEED] → operator@test.com / password123 (role: operator)');

    // ── LIFECYCLE SNAPSHOT (FT2) ───────────────────────────────────────────
    // Seeds shop lifecycle to FT2 so mobile operator flows work immediately
    // without requiring manual owner onboarding after every dev:full-reset.
    await trx('user_lifecycle_snapshot')
      .insert({
        shop_id: shop.id,
        user_id: user.id,
        phase: 'FT2',
        subphase: null,
        since: new Date(),
        last_event_id: trx.raw('gen_random_uuid()'),
        updated_at: new Date(),
      })
      .onConflict('shop_id')
      .merge({
        phase: 'FT2',
        subphase: null,
        since: new Date(),
        last_event_id: trx.raw('gen_random_uuid()'),
        updated_at: new Date(),
      });

    console.log('[DEV_SEED] ✅ Lifecycle snapshot seeded → FT2');

    // ── WAREHOUSE LOCATIONS ──────────────────────────────────────────────────
    // Seed minimal bin locations for dev stow/canvas testing.
    // Floor coordinates (metres from top-left origin) match a 3-aisle 4-bin layout:
    //   Aisles A/B/C run left-to-right, 3m apart on Y axis.
    //   Each bin is 1.0m wide × 0.8m deep, 0.1m gap between bins.
    const locationRows = [
    // Warehouse root — full floor envelope
    { location_code: 'WH-1-ROOT', barcode: null,           type: 'warehouse', parent_location_code: null,      position_x: 0,    position_y: 0,    width: 12,   depth: 10,   orientation: 0, rack_levels: null, zone_type: 'storage' },
    // Aisles (lane type) — 1m wide walking paths, full depth
    { location_code: 'A',         barcode: null,           type: 'lane',      parent_location_code: 'WH-1-ROOT', position_x: 1,  position_y: 1,    width: 4.4,  depth: 1,    orientation: 0, rack_levels: null, zone_type: 'pick' },
    { location_code: 'B',         barcode: null,           type: 'lane',      parent_location_code: 'WH-1-ROOT', position_x: 1,  position_y: 4,    width: 4.4,  depth: 1,    orientation: 0, rack_levels: null, zone_type: 'pick' },
    { location_code: 'C',         barcode: null,           type: 'lane',      parent_location_code: 'WH-1-ROOT', position_x: 1,  position_y: 7,    width: 4.4,  depth: 1,    orientation: 0, rack_levels: null, zone_type: 'pick' },
    // Aisle A bins — 1.0m wide × 0.8m deep, 0.1m gap, 3 rack levels
    { location_code: 'A-1',       barcode: 'LOC-A-1',     type: 'bin',       parent_location_code: 'A',          position_x: 1,    position_y: 2,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'A-2',       barcode: 'LOC-A-2',     type: 'bin',       parent_location_code: 'A',          position_x: 2.1,  position_y: 2,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'A-3',       barcode: 'LOC-A-3',     type: 'bin',       parent_location_code: 'A',          position_x: 3.2,  position_y: 2,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'A-4',       barcode: 'LOC-A-4',     type: 'bin',       parent_location_code: 'A',          position_x: 4.3,  position_y: 2,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    // Aisle B bins
    { location_code: 'B-1',       barcode: 'LOC-B-1',     type: 'bin',       parent_location_code: 'B',          position_x: 1,    position_y: 5,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'B-2',       barcode: 'LOC-B-2',     type: 'bin',       parent_location_code: 'B',          position_x: 2.1,  position_y: 5,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'B-3',       barcode: 'LOC-B-3',     type: 'bin',       parent_location_code: 'B',          position_x: 3.2,  position_y: 5,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'B-4',       barcode: 'LOC-B-4',     type: 'bin',       parent_location_code: 'B',          position_x: 4.3,  position_y: 5,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    // Aisle C bins
    { location_code: 'C-1',       barcode: 'LOC-C-1',     type: 'bin',       parent_location_code: 'C',          position_x: 1,    position_y: 8,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'C-2',       barcode: 'LOC-C-2',     type: 'bin',       parent_location_code: 'C',          position_x: 2.1,  position_y: 8,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'C-3',       barcode: 'LOC-C-3',     type: 'bin',       parent_location_code: 'C',          position_x: 3.2,  position_y: 8,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    { location_code: 'C-4',       barcode: 'LOC-C-4',     type: 'bin',       parent_location_code: 'C',          position_x: 4.3,  position_y: 8,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 3,    zone_type: 'pick' },
    // Problem bin — quarantine zone, no floor position needed for canvas
    { location_code: 'PROBLEM',   barcode: 'LOC-PROBLEM',  type: 'bin',       parent_location_code: 'A',          position_x: 8,    position_y: 1,    width: 1,    depth: 0.8,  orientation: 0, rack_levels: 1,    zone_type: 'quarantine' },
  ];

    await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);
    for (const loc of locationRows) {
      await trx('warehouse_locations')
        .insert({ shop_id: shop.id, ...loc })
        .onConflict(['shop_id', 'location_code'])
        .ignore();
    }
    await trx.raw(`SET LOCAL "app.current_tenant" = '0'`); // reset after warehouse inserts

    console.log('[DEV_SEED] ✅ Warehouse locations seeded (ROOT + 3 aisles + 12 bins + PROBLEM)');

    // Seed problem bin location in WMS settings
    await trx('shop_wms_settings')
      .where({ shop_id: shop.id })
      .update({ problem_bin_location: 'PROBLEM' });

    // ── QA OPERATIONAL DATA ──────────────────────────────────────────────────
    // Seeds a complete end-to-end flow for QA:
    // Supplier → PO (shipped) → ready for receive → stow → pick → pack → ship

    // 1. Supplier
    const [supplier] = await trx('suppliers')
      .insert({
        shop_id: shop.id,
        name: 'QA Test Supplier',
        contact_email: 'supplier@qa.test',
        active: true,
      })
      .onConflict(['shop_id', 'name'])
      .merge({ active: true })
      .returning('*');

    console.log(`[DEV_SEED] QA supplier created (id=${supplier.id})`);

    // 2. Create minimal QA variants for end-to-end flow testing
    const now = new Date();
    const qaProductDefs = [
      { title: 'QA Shirt', sku: 'QA-SHIRT-S', cost: 2500 },
      { title: 'QA Hoodie', sku: 'QA-HOODIE-M', cost: 3500 },
      { title: 'QA Cap', sku: 'QA-CAP-OS', cost: 1500 },
    ];

    // Upsert a QA product
    let qaProduct = await trx('products')
      .where({ shop_id: shop.id, title: 'QA Products' })
      .first();
    if (!qaProduct) {
      const [inserted] = await trx('products').insert({
        shop_id: shop.id,
        lasyncro_product_id: trx.raw('gen_random_uuid()'),
        title: 'QA Products',
        updated_at: now,
        created_at: now,
      }).returning('*');
      qaProduct = inserted;
    }

    const qaVariants: Array<{ lasyncro_variant_id: string; sku: string; title: string }> = [];
    for (const def of qaProductDefs) {
      let variant = await trx('variants').where({ shop_id: shop.id, sku: def.sku }).first();
      if (!variant) {
        const [inserted] = await trx('variants').insert({
          shop_id: shop.id,
          lasyncro_variant_id: trx.raw('gen_random_uuid()'),
          lasyncro_product_id: qaProduct.lasyncro_product_id,
          sku: def.sku,
          title: def.title,
          unit_cost: def.cost / 100,
          updated_at: now,
          created_at: now,
        }).returning('*');
        variant = inserted;
      }
      qaVariants.push({
        lasyncro_variant_id: variant.lasyncro_variant_id,
        sku: variant.sku,
        title: variant.title,
      });
    }

    console.log(`[DEV_SEED] QA variants created (${qaVariants.length})`);

    if (qaVariants.length === 0) {
      console.log('[DEV_SEED] ⚠️ QA variants failed — skipping QA PO seed');
    } else {
      // 3. Purchase Order (status: shipped — ready to receive)
      const [po] = await trx('purchase_orders')
        .insert({
          shop_id: shop.id,
          supplier_id: supplier.id,
          status: 'confirmed',
          expected_delivery_date: new Date().toISOString().split('T')[0],
          notes: 'QA test PO — full flow seed',
        })
        .returning('*');

      console.log(`[DEV_SEED] QA PO created (id=${po.id})`);

      // 4. PO line items — one per variant
      for (const variant of qaVariants) {
        await trx('purchase_order_line_items').insert({
          po_id: po.id,
          shop_id: shop.id,
          lasyncro_variant_id: variant.lasyncro_variant_id,
          description: variant.title ?? variant.sku ?? 'QA Product',
          quantity_ordered: 10,
          quantity_received: 0,
          unit_cost_cents: 2500,
        });
      }

      console.log(`[DEV_SEED] QA PO line items created (${qaVariants.length} variants)`);

      // 5. Seed barcodes for variants so scanner can resolve them
    for (let idx = 0; idx < qaVariants.length; idx++) {
      const variant = qaVariants[idx];
      const barcodeValue = variant.sku ?? `QA${variant.lasyncro_variant_id.replace(/-/g, '').slice(0, 10).toUpperCase()}`;
      await trx('external_product_identity_map')
        .insert({
          id: trx.raw('gen_random_uuid()'),
          lasyncro_variant_id: variant.lasyncro_variant_id,
          shop_id: shop.id,
          platform: 'shopify',
          external_product_id: `100000${idx}`,
          external_variant_id: `200000${idx}`,
          external_sku: variant.sku ?? null,
          barcode: barcodeValue,
        })
        .onConflict(['shop_id', 'platform', 'external_product_id', 'external_variant_id'])
        .ignore();
    }

    console.log(`[DEV_SEED] QA barcodes registered for ${qaVariants.length} variants`);

    // 6. Seed 3 orders in the pool (pending, no batch, no constraints)
    for (let i = 0; i < 3; i++) {
        const variant = qaVariants[i]; // each order gets a unique variant

      const variantRow = await trx('variants')
        .where({ lasyncro_variant_id: variant.lasyncro_variant_id })
        .first();

      const [order] = await trx('orders')
        .insert({
          shop_id: shop.id,
          lasyncro_order_id: trx.raw('gen_random_uuid()'),
          aggregate_version: 1,
          last_projected_version: 1,
          payment_state: 'paid',
          currency: 'USD',
          total_price: 59.95,
          subtotal_price: 59.95,
          total_tax: 0,
          order_created_at: new Date(),
          order_updated_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .returning('*');

      // external_order_id must be numeric only
      await trx('external_order_identity_map')
        .insert({
          lasyncro_order_id: order.lasyncro_order_id,
          shop_id: shop.id,
          platform: 'shopify',
          external_order_id: `${900001 + i}`,
        })
        .onConflict(['shop_id', 'platform', 'external_order_id'])
        .ignore();

      await trx('order_line_items')
        .insert({
          lasyncro_line_item_id: trx.raw('gen_random_uuid()'),
          lasyncro_order_id: order.lasyncro_order_id,
          lasyncro_product_id: variantRow?.lasyncro_product_id,
          lasyncro_variant_id: variant.lasyncro_variant_id,
          title: variant.title ?? variant.sku ?? 'QA Product',
          sku: variant.sku ?? null,
          quantity: 1,
          unit_price: 59.95,
          line_total: 59.95,
          platform: 'shopify',
          external_line_item_id: `${800001 + i}`,
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict(['platform', 'external_line_item_id'])
        .ignore();

      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await trx('order_fulfillment_status')
        .insert({
          lasyncro_fulfillment_id: trx.raw('gen_random_uuid()'),
          lasyncro_order_id: order.lasyncro_order_id,
          status: 'pending',
          status_updated_at: new Date(),
          created_at: new Date(),
          updated_at: new Date(),
        })
        .onConflict('lasyncro_order_id')
        .ignore();
    }

      console.log('[DEV_SEED] ✅ QA orders seeded (3 orders in pool)');
      console.log('[DEV_SEED] ✅ QA flow ready:');
      console.log('[DEV_SEED]    Owner → Dispatch → Receive → create receive job from QA PO');
      console.log('[DEV_SEED]    Owner → Dispatch → Pick → release batch (3 orders in pool)');
      console.log('[DEV_SEED]    Operator → claim receive job → inspect → close → barcodes generated');
      console.log('[DEV_SEED]    Operator → claim stow → scan LOC-A01 → scan product barcode');
      console.log('[DEV_SEED]    Operator → claim pick batch → scan product barcodes');
      console.log('[DEV_SEED]    Operator → claim pack → scan items → scan QA-ORD-100x → ship');
    }

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

    // ── REFUND EXECUTIONS + LINE ITEMS ───────────────────────────────────────
    // Required for: Returns intelligence (revenue leakage, return rate charts)
    // Uses fulfilled orders only — refunds reference real order_revenue_units
    // RLS note: refund_executions has no shop_id — enforced via orders join
    const fulfilledOrderIds = orderIds.slice(0, 3); // refund 3 of the 8 fulfilled orders
    for (const refundOrderId of fulfilledOrderIds) {
      // Fetch the revenue unit seeded for this order
      const revenueUnit = await trx('order_revenue_units')
        .where({ lasyncro_order_id: refundOrderId })
        .first();
      if (!revenueUnit) continue;

      const refundedQty = 1;
      const refundedAmount = Number(revenueUnit.unit_price) * refundedQty;
      const executedAt = new Date(now);
      executedAt.setDate(executedAt.getDate() - Math.floor(Math.random() * 14));

      const [refundExecution] = await trx('refund_executions').insert({
        lasyncro_refund_execution_id: trx.raw('gen_random_uuid()'),
        lasyncro_order_id: refundOrderId,
        platform: 'shopify',
        // external_refund_id must be unique per platform — use order id slice as surrogate
        external_refund_id: `seed-refund-${refundOrderId.slice(0, 8)}`,
        total_refund_amount: refundedAmount,
        executed_at: executedAt,
        created_at: executedAt,
        updated_at: executedAt,
      }).returning('*');

      await trx('refund_execution_line_items').insert({
        lasyncro_refund_line_item_id: trx.raw('gen_random_uuid()'),
        lasyncro_refund_execution_id: refundExecution.lasyncro_refund_execution_id,
        lasyncro_revenue_unit_id: revenueUnit.lasyncro_revenue_unit_id,
        refunded_quantity: refundedQty,
        refunded_amount: refundedAmount,
        created_at: executedAt,
      });
    }
    console.log(`[DEV_SEED] Created 3 refund executions with line items (Returns intelligence ready)`);

    // ── SHOPIFY INTEGRATION (for Shopify-dependent services) ─────────────────
    await trx('integrations').insert({
      shop_id: shop.id,
      platform: 'shopify',
      platform_shop_name: 'development-store-15820042357.myshopify.com',
      access_token_encrypted: 'dev_seed_placeholder_not_real',
      sync_status: 'PENDING', // OAuth will update token; sync runs after OAuth completes
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

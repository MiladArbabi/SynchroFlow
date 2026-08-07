// apps/backend/seeds/dev_seed.ts
import type { Knex } from 'knex';
import bcrypt from 'bcrypt';
import { encrypt } from '../src/security/encryption.service.js';
import { getTierConfig } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';
import { runWithTenantContext } from '@lasyncro/backend-core/db.js';
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

    // Seed Growth subscription and derive its grants from the same canonical
    // tier configuration used by registration and billing webhooks.
    await trx('shop_subscriptions')
      .insert({
        shop_id: shop.id,
        tier: 'growth',
        billing_interval: 'monthly',
        status: 'active',
      })
      .onConflict('shop_id')
      .merge({ tier: 'growth', status: 'active' });

    const growthConfig = getTierConfig('growth');
    const growthModuleRows = growthConfig.modules.map((moduleKey) => ({
      shop_id: shop.id,
      module_key: moduleKey,
      flag_key: null as string | null,
      source: 'dev_seed:growth',
    }));
    const growthFlagRows = growthConfig.flags.map((flagKey) => ({
      shop_id: shop.id,
      module_key: flagKey.split('.')[0],
      flag_key: flagKey,
      source: 'dev_seed:growth',
    }));

    await EntitlementsService.applyFromCommercialGrant(
      trx,
      [...growthModuleRows, ...growthFlagRows]
    );

    console.log('[DEV_SEED] ✅ Canonical Growth entitlements seeded');

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

    // Seed WMS settings — SET LOCAL required: shop_wms_settings has RLS enabled
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);
    await trx('shop_wms_settings')
      .insert({ shop_id: shop.id })
      .onConflict('shop_id')
      .ignore();
    await trx('shop_operational_settings')
      .insert({
        shop_id: shop.id,
        fulfillment_sla_hours: 24,
        monthly_overhead_amount: 0,
        starting_cash_balance: 0,
      })
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

    // ── WAREHOUSE LOCATIONS ──────────────────────────────────────────────────
    // Seed minimal bin locations for dev stow/canvas testing.
    // Floor coordinates (metres from top-left origin) match a 3-aisle 4-bin layout:
    //   Aisles A/B/C run left-to-right, 3m apart on Y axis.
    //   Each bin is 1.0m wide × 0.8m deep, 0.1m gap between bins.
    const rootLocationCode = `WH-${shop.id}-ROOT`;

    const [defaultWarehouse] = await trx('warehouses')
      .insert({
        shop_id: shop.id,
        name: 'Main warehouse',
        root_location_code: rootLocationCode,
        is_default: true,
        active: true,
      })
      .onConflict(['shop_id', 'root_location_code'])
      .merge({
        name: 'Main warehouse',
        active: true,
        updated_at: new Date(),
      })
      .returning(['warehouse_id', 'name', 'root_location_code']);

    if (!defaultWarehouse?.warehouse_id) {
      throw new Error('[DEV_SEED] Warehouse bootstrap failed');
    }

    console.log(
      `[DEV_SEED] ✅ Warehouse identity seeded (${defaultWarehouse.name}, id=${defaultWarehouse.warehouse_id})`
    );

  const locationRows = [
    { location_code: rootLocationCode, barcode: null, type: 'warehouse', parent_location_code: null, position_x: 0, position_y: 0, width: 12, depth: 12, orientation: 0, rack_levels: null, zone_type: 'storage' },
    { location_code: 'A', barcode: null, type: 'lane', parent_location_code: rootLocationCode, position_x: 1.0, position_y: 0.0, width: 4.4, depth: 1.0, orientation: 0, rack_levels: null, zone_type: 'pick' },
    { location_code: 'B', barcode: null, type: 'lane', parent_location_code: rootLocationCode, position_x: 1.0, position_y: 4.0, width: 4.4, depth: 1.0, orientation: 0, rack_levels: null, zone_type: 'pick' },
    { location_code: 'C', barcode: null, type: 'lane', parent_location_code: rootLocationCode, position_x: 1.0, position_y: 8.0, width: 4.4, depth: 1.0, orientation: 0, rack_levels: null, zone_type: 'pick' },
    // Aisle A bins — 1.0m wide × 0.8m deep, 0.1m gap, 3 rack levels
    { location_code: 'A-1',       barcode: 'LOC-A-1',     type: 'bin',       parent_location_code: 'A',          position_x: 1.0,  position_y: 1.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'A-2',       barcode: 'LOC-A-2',     type: 'bin',       parent_location_code: 'A',          position_x: 2.1,  position_y: 1.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'A-3',       barcode: 'LOC-A-3',     type: 'bin',       parent_location_code: 'A',          position_x: 3.2,  position_y: 1.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'A-4',       barcode: 'LOC-A-4',     type: 'bin',       parent_location_code: 'A',          position_x: 4.3,  position_y: 1.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    // Aisle B bins
    { location_code: 'B-1',       barcode: 'LOC-B-1',     type: 'bin',       parent_location_code: 'B',          position_x: 1.0,  position_y: 5.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'B-2',       barcode: 'LOC-B-2',     type: 'bin',       parent_location_code: 'B',          position_x: 2.1,  position_y: 5.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'B-3',       barcode: 'LOC-B-3',     type: 'bin',       parent_location_code: 'B',          position_x: 3.2,  position_y: 5.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'B-4',       barcode: 'LOC-B-4',     type: 'bin',       parent_location_code: 'B',          position_x: 4.3,  position_y: 5.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    // Aisle C bins
    { location_code: 'C-1',       barcode: 'LOC-C-1',     type: 'bin',       parent_location_code: 'C',          position_x: 1.0,  position_y: 9.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'C-2',       barcode: 'LOC-C-2',     type: 'bin',       parent_location_code: 'C',          position_x: 2.1,  position_y: 9.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'C-3',       barcode: 'LOC-C-3',     type: 'bin',       parent_location_code: 'C',          position_x: 3.2,  position_y: 9.0,  width: 1.0,  depth: 0.5,  orientation: 0, rack_levels: 3, zone_type: 'pick' },
    { location_code: 'C-4',       barcode: 'LOC-C-4',       type: 'bin', parent_location_code: 'C',                position_x: 4.3, position_y: 9.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },

    // Operational work zones demonstrate map colours without changing pick-stock assignments.
    { location_code: 'PACK-1',       barcode: 'LOC-PACK-1',       type: 'bin', parent_location_code: rootLocationCode, position_x: 7.0, position_y: 2.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'pack' },
    { location_code: 'RECEIVE-1',    barcode: 'LOC-RECEIVE-1',    type: 'bin', parent_location_code: rootLocationCode, position_x: 9.0, position_y: 2.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'receive' },
    { location_code: 'RETURNS-1',    barcode: 'LOC-RETURNS-1',    type: 'bin', parent_location_code: rootLocationCode, position_x: 7.0, position_y: 5.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'returns' },
    { location_code: 'SHIP-1',       barcode: 'LOC-SHIP-1',       type: 'bin', parent_location_code: rootLocationCode, position_x: 9.0, position_y: 5.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'ship' },
    { location_code: 'QUARANTINE-1', barcode: 'LOC-QUARANTINE-1', type: 'bin', parent_location_code: rootLocationCode, position_x: 7.0, position_y: 8.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'quarantine' },
    { location_code: 'KITTING-1',    barcode: 'LOC-KITTING-1',    type: 'bin', parent_location_code: rootLocationCode, position_x: 9.0, position_y: 8.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'kitting' },

    // Problem bin
    { location_code: 'PROBLEM', barcode: 'LOC-PROBLEM', type: 'bin', parent_location_code: 'A', position_x: 8.0, position_y: 1.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 1, zone_type: 'problem' },
  ];

    await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);

    for (const loc of locationRows) {
      await trx('warehouse_locations')
        .insert({
          shop_id: shop.id,
          warehouse_id: defaultWarehouse.warehouse_id,
          ...loc,
        })
        .onConflict(['shop_id', 'location_code'])
        .merge([
          'warehouse_id',
          'position_x',
          'position_y',
          'width',
          'depth',
          'orientation',
          'rack_levels',
          'zone_type',
          'barcode',
          'parent_location_code',
        ]);
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
          status: 'shipped',
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
          external_product_id: `gid://shopify/Product/100000${idx}`,
          external_variant_id: `gid://shopify/ProductVariant/200000${idx}`,
          external_sku: variant.sku ?? null,
          barcode: barcodeValue,
        })
        .onConflict(['shop_id', 'platform', 'external_product_id', 'external_variant_id'])
        .ignore();
    }

    console.log(`[DEV_SEED] QA barcodes registered for ${qaVariants.length} variants`);

    // 6. Seed 3 zero-stock QA orders through the canonical event pipeline.
    // REV-HARD-05: direct order/projection writes are erased by rebuild and
    // bypass the same constraint lifecycle exercised by real Shopify orders.
    for (let i = 0; i < 3; i++) {
      const externalOrderId = `${800001 + i}`;
      const externalProductId = `100000${i}`;
      const externalVariantId = `200000${i}`;
      const eventTime = new Date();

      await trx('domain_events')
        .insert([
          {
            shop_id: shop.id,
            event_type: 'orders/paid',
            event_payload: {
              id: externalOrderId,
            },
            event_time: eventTime,
            external_event_id: `${externalOrderId}:paid`,
          },
          {
            shop_id: shop.id,
            event_type: 'orders/sync',
            event_payload: {
              id: externalOrderId,
              name: `#QA-${externalOrderId}`,
              createdAt: eventTime.toISOString(),
              updatedAt: eventTime.toISOString(),
              processedAt: eventTime.toISOString(),
              sourceName: 'web',
              currencyCode: 'USD',
              displayFinancialStatus: 'PAID',
              displayFulfillmentStatus: 'UNFULFILLED',

              // REV-HARD-05: keep this QA scenario inventory-only.
              // A complete shipping address prevents an unrelated customer block.
              shippingAddress: {
                address1: '1 QA Street',
                city: 'Stockholm',
                zip: '111 22',
                countryCode: 'SE',
              },

              totalTaxSet: {
                shopMoney: { amount: '0.00' },
              },
              subtotalPriceSet: {
                shopMoney: { amount: '59.95' },
              },
              totalPriceSet: {
                shopMoney: {
                  amount: '59.95',
                  currencyCode: 'USD',
                },
              },
              lineItems: {
                edges: [
                  {
                    node: {
                      id: `gid://shopify/LineItem/${externalOrderId}`,
                      product: {
                        id: `gid://shopify/Product/${externalProductId}`,
                      },
                      variant: {
                        id: `gid://shopify/ProductVariant/${externalVariantId}`,
                      },
                      quantity: 1,
                      originalTotalSet: {
                        shopMoney: { amount: '59.95' },
                      },
                      originalUnitPriceSet: {
                        shopMoney: { amount: '59.95' },
                      },
                      discountedUnitPriceSet: {
                        shopMoney: { amount: '59.95' },
                      },
                    },
                  },
                ],
              },
            },
            event_time: eventTime,
            external_event_id: externalOrderId,
          },
          {
            shop_id: shop.id,
            event_type: 'orders/fulfillment_updated',
            event_payload: {
              status: 'pending',
              order_id: externalOrderId,
            },
            event_time: eventTime,
            external_event_id: `${externalOrderId}:fulfillment_updated`,
          },
        ])
        .onConflict(
          trx.raw('(shop_id, external_event_id) WHERE external_event_id IS NOT NULL')
        )
        .ignore();
    }

      console.log('[DEV_SEED] ✅ QA orders seeded via domain events (3 zero-stock orders)');
      console.log('[DEV_SEED] ✅ QA flow ready:');
      console.log('[DEV_SEED]    Owner → Dispatch → Receive → create receive job from QA PO');
      console.log('[DEV_SEED]    Zero-stock QA orders remain blocked until inventory becomes pickable');
      console.log('[DEV_SEED]    Operator → claim receive job → inspect → close → barcodes generated');
      console.log('[DEV_SEED]    Operator → claim stow → scan LOC-A01 → scan product barcode');
      console.log('[DEV_SEED]    Operator → claim pick batch → scan product barcodes');
     console.log('[DEV_SEED]    Operator → claim pack → scan items → scanQA-ORD-100x → ship');
    }
  } else if (process.env.DEV_SEED_MODE !== 'full_data') {
    console.log('[DEV_SEED] ⚠️ No shop membership created');
    console.log('[DEV_SEED] → This user CANNOT log in');
  }

  /**
   * 5️⃣ SHARED LOGIN IDENTITIES
   * ---------------------------
   * Both full_identity and full_data must produce a loginable owner.
   * The standard dev:full-reset path uses full_data, so it must also
   * provision the operator identity required for warehouse-flow testing.
   */
  if (
    process.env.DEV_SEED_MODE === 'full_data' ||
    process.env.DEV_SEED_MODE === 'full_identity'
  ) {
    await trx('shop_memberships')
      .insert({
        shop_id: shop.id,
        user_id: user.id,
        role: 'owner',
      })
      .onConflict(['shop_id', 'user_id'])
      .merge({ role: 'owner' });

    console.log('[DEV_SEED] ✅ Owner identity verified');
    console.log('[DEV_SEED] → owner@test.com / password123 (role: owner)');

    /**
     * SHARED FT2 LIFECYCLE
     * --------------------
     * Lifecycle is shop-scoped, so one confirmed FT2 snapshot unlocks the
     * warehouse module for every authenticated member of the seeded shop.
     */
    if (
      process.env.DEV_SEED_MODE === 'full_data' ||
      process.env.DEV_SEED_MODE === 'full_identity'
    ) {
      await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);

      const [lifecycleSnapshot] = await trx('user_lifecycle_snapshot')
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
          user_id: user.id,
          phase: 'FT2',
          subphase: null,
          since: new Date(),
          last_event_id: trx.raw('gen_random_uuid()'),
          updated_at: new Date(),
        })
        .returning(['shop_id', 'user_id', 'phase']);

      if (
        lifecycleSnapshot?.shop_id !== shop.id ||
        lifecycleSnapshot?.phase !== 'FT2'
      ) {
        throw new Error('[DEV_SEED] FT2 lifecycle bootstrap failed');
      }

      console.log(
        `[DEV_SEED] ✅ Shop lifecycle verified → FT2 (shop=${lifecycleSnapshot.shop_id})`
      );
    }

    if (process.env.DEV_SEED_MODE === 'full_data') {
      const operatorEmail = 'operator@test.com';
      const operatorPasswordHash = await bcrypt.hash(DEV_USER_PASSWORD, 10);

      let operatorUser = await trx('users')
        .where({ email: operatorEmail })
        .first();

      if (!operatorUser) {
        const [insertedOperator] = await trx('users')
          .insert({
            shop_id: shop.id,
            email: operatorEmail,
            password_hash: operatorPasswordHash,
            first_name: 'Operator',
            last_name: 'Dev',
          })
          .returning('*');

        operatorUser = insertedOperator;
      } else {
        await trx('users')
          .where({ id: operatorUser.id })
          .update({
            shop_id: shop.id,
            password_hash: operatorPasswordHash,
            updated_at: new Date(),
          });
      }

      if (!operatorUser?.id) {
        throw new Error('[DEV_SEED] Operator identity bootstrap failed');
      }

      await trx('shop_memberships')
        .insert({
          shop_id: shop.id,
          user_id: operatorUser.id,
          role: 'operator',
        })
        .onConflict(['shop_id', 'user_id'])
        .merge({ role: 'operator' });

      console.log(
        `[DEV_SEED] ✅ Operator identity verified (id=${operatorUser.id})`
      );
      console.log(
        '[DEV_SEED] → operator@test.com / password123 (role: operator)'
      );
    }
  }

  if (process.env.DEV_SEED_MODE === 'full_data') {
    console.log('[DEV_SEED] Seeding full operational data (trust + FT2)…');
    // ── WAREHOUSE LOCATIONS (full_data) ──────────────────────────────────────
    // Also seed/reset warehouse locations in full_data mode so dev:full-reset
    // always restores clean coordinates regardless of which mode was used.
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);

    const rootLocationCode = `WH-${shop.id}-ROOT`;

    const [defaultWarehouse] = await trx('warehouses')
      .insert({
        shop_id: shop.id,
        name: 'Main warehouse',
        root_location_code: rootLocationCode,
        is_default: true,
        active: true,
      })
      .onConflict(['shop_id', 'root_location_code'])
      .merge({
        name: 'Main warehouse',
        active: true,
        updated_at: new Date(),
      })
      .returning(['warehouse_id', 'name', 'root_location_code']);

    if (!defaultWarehouse?.warehouse_id) {
      throw new Error('[DEV_SEED] Warehouse bootstrap failed');
    }

    console.log(
      `[DEV_SEED] ✅ Warehouse identity seeded (${defaultWarehouse.name}, id=${defaultWarehouse.warehouse_id})`
    );

    const fdLocationRows = [
      { location_code: rootLocationCode, barcode: null, type: 'warehouse', parent_location_code: null, position_x: 0, position_y: 0, width: 12, depth: 12, orientation: 0, rack_levels: null, zone_type: 'storage' },
      { location_code: 'A', barcode: null, type: 'lane', parent_location_code: rootLocationCode, position_x: 1.0, position_y: 0.0, width: 4.4, depth: 1.0, orientation: 0, rack_levels: null, zone_type: 'pick' },
      { location_code: 'B', barcode: null, type: 'lane', parent_location_code: rootLocationCode, position_x: 1.0, position_y: 4.0, width: 4.4, depth: 1.0, orientation: 0, rack_levels: null, zone_type: 'pick' },
      { location_code: 'C', barcode: null, type: 'lane', parent_location_code: rootLocationCode, position_x: 1.0, position_y: 8.0, width: 4.4, depth: 1.0, orientation: 0, rack_levels: null, zone_type: 'pick' },
      { location_code: 'A-1',       barcode: 'LOC-A-1',    type: 'bin',       parent_location_code: 'A',           position_x: 1.0, position_y: 1.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'A-2',       barcode: 'LOC-A-2',    type: 'bin',       parent_location_code: 'A',           position_x: 2.1, position_y: 1.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'A-3',       barcode: 'LOC-A-3',    type: 'bin',       parent_location_code: 'A',           position_x: 3.2, position_y: 1.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'A-4',       barcode: 'LOC-A-4',    type: 'bin',       parent_location_code: 'A',           position_x: 4.3, position_y: 1.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'B-1',       barcode: 'LOC-B-1',    type: 'bin',       parent_location_code: 'B',           position_x: 1.0, position_y: 5.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'B-2',       barcode: 'LOC-B-2',    type: 'bin',       parent_location_code: 'B',           position_x: 2.1, position_y: 5.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'B-3',       barcode: 'LOC-B-3',    type: 'bin',       parent_location_code: 'B',           position_x: 3.2, position_y: 5.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'B-4',       barcode: 'LOC-B-4',    type: 'bin',       parent_location_code: 'B',           position_x: 4.3, position_y: 5.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'C-1',       barcode: 'LOC-C-1',    type: 'bin',       parent_location_code: 'C',           position_x: 1.0, position_y: 9.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'C-2',       barcode: 'LOC-C-2',    type: 'bin',       parent_location_code: 'C',           position_x: 2.1, position_y: 9.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },
      { location_code: 'C-3',       barcode: 'LOC-C-3',    type: 'bin',       parent_location_code: 'C',           position_x: 3.2, position_y: 9.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },

      { location_code: 'C-4',       barcode: 'LOC-C-4',       type: 'bin', parent_location_code: 'C',                position_x: 4.3, position_y: 9.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 3, zone_type: 'pick' },

      // Keep full-data operational zones aligned with the minimal development seed.
      { location_code: 'PACK-1',       barcode: 'LOC-PACK-1',       type: 'bin', parent_location_code: rootLocationCode, position_x: 7.0, position_y: 2.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'pack' },
      { location_code: 'RECEIVE-1',    barcode: 'LOC-RECEIVE-1',    type: 'bin', parent_location_code: rootLocationCode, position_x: 9.0, position_y: 2.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'receive' },
      { location_code: 'RETURNS-1',    barcode: 'LOC-RETURNS-1',    type: 'bin', parent_location_code: rootLocationCode, position_x: 7.0, position_y: 5.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'returns' },
      { location_code: 'SHIP-1',       barcode: 'LOC-SHIP-1',       type: 'bin', parent_location_code: rootLocationCode, position_x: 9.0, position_y: 5.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'ship' },
      { location_code: 'QUARANTINE-1', barcode: 'LOC-QUARANTINE-1', type: 'bin', parent_location_code: rootLocationCode, position_x: 7.0, position_y: 8.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'quarantine' },
      { location_code: 'KITTING-1',    barcode: 'LOC-KITTING-1',    type: 'bin', parent_location_code: rootLocationCode, position_x: 9.0, position_y: 8.0, width: 2.0, depth: 1.5, orientation: 0, rack_levels: 1, zone_type: 'kitting' },

      { location_code: 'PROBLEM', barcode: 'LOC-PROBLEM', type: 'bin', parent_location_code: 'A', position_x: 8.0, position_y: 1.0, width: 1.0, depth: 0.5, orientation: 0, rack_levels: 1, zone_type: 'problem' },
    ];
    
    for (const loc of fdLocationRows) {
      await trx('warehouse_locations')
        .insert({
          shop_id: shop.id,
          warehouse_id: defaultWarehouse.warehouse_id,
          ...loc,
        })
        .onConflict(['shop_id', 'location_code'])
        .merge([
          'warehouse_id',
          'position_x',
          'position_y',
          'width',
          'depth',
          'orientation',
          'rack_levels',
          'zone_type',
          'barcode',
          'parent_location_code',
        ]);
    }

    console.log('[DEV_SEED] ✅ Warehouse locations seeded (full_data reset)');

    // WMS settings — upsert here since full_data runs with correct SET LOCAL context
    await trx('shop_wms_settings')
      .insert({ shop_id: shop.id, problem_bin_location: 'PROBLEM' })
      .onConflict('shop_id')
      .merge(['problem_bin_location']);
    console.log('[DEV_SEED] ✅ WMS settings seeded');

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

    // ── LEGACY BARCODE RESOLUTION (full_data variants — pick path) ──────────────
    // Seeds external_product_identity_map so full_data variants resolve via
    // legacy barcode/SKU path during pick scan (barcode = SKU string).
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);
    for (let idx = 0; idx < variantIds.length; idx++) {
      const v = variantIds[idx];
      await trx.raw(`
        INSERT INTO external_product_identity_map
          (id, lasyncro_variant_id, shop_id, platform, external_product_id, external_variant_id, external_sku, barcode)
        VALUES (gen_random_uuid(), ?, ?, 'shopify', ?, ?, ?, ?)
        ON CONFLICT DO NOTHING
      `, [v.lasyncro_variant_id, shop.id, `fd-product-${idx}`, `fd-variant-${idx}`, v.sku, v.sku]);
    }
    console.log(`[DEV_SEED] Legacy barcodes seeded for ${variantIds.length} full_data variants`);

    // ── SUPPLIERS + PURCHASE ORDERS ──────────────────────────────────────────
    // Wool & Co — 2 POs (one shipped/receivable, one ordered/in-transit)
    // Linen House — 1 PO (shipped/receivable)
    // All line items linked to real variants for full receive flow testing.
    const woolVariants = variantIds.filter(v => v.sku.startsWith('WOOL-'));
    const linenVariants = variantIds.filter(v => v.sku.startsWith('LINEN-'));

    const [woolSupplier] = await trx('suppliers')
      .insert({ shop_id: shop.id, name: 'Wool & Co', contact_email: 'orders@woolco.test', active: true })
      .onConflict(['shop_id', 'name']).merge({ active: true }).returning('*');

    const [linenSupplier] = await trx('suppliers')
      .insert({ shop_id: shop.id, name: 'Linen House', contact_email: 'orders@linenhouse.test', active: true })
      .onConflict(['shop_id', 'name']).merge({ active: true }).returning('*');

    // Wool & Co PO 1 — shipped, ready to receive
    const [woolPo1] = await trx('purchase_orders')
      .insert({
        shop_id: shop.id,
        supplier_id: woolSupplier.id,
        status: 'shipped',
        expected_delivery_date: new Date().toISOString().split('T')[0],
        notes: 'Seed PO — ready to receive',
      }).returning('*');

    for (const v of woolVariants) {
      await trx('purchase_order_line_items').insert({
        po_id: woolPo1.id, shop_id: shop.id,
        lasyncro_variant_id: v.lasyncro_variant_id,
        description: v.sku, quantity_ordered: 20, quantity_received: 0, unit_cost_cents: 2800,
      });
    }

    // Wool & Co PO 2 — ordered, in transit
    const [woolPo2] = await trx('purchase_orders')
      .insert({
        shop_id: shop.id,
        supplier_id: woolSupplier.id,
        status: 'ordered',
        expected_delivery_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
        notes: 'Seed PO — in transit',
      }).returning('*');

    for (const v of woolVariants) {
      await trx('purchase_order_line_items').insert({
        po_id: woolPo2.id, shop_id: shop.id,
        lasyncro_variant_id: v.lasyncro_variant_id,
        description: v.sku, quantity_ordered: 50, quantity_received: 0, unit_cost_cents: 2800,
      });
    }

    // Linen House PO — shipped, ready to receive
    const [linenPo] = await trx('purchase_orders')
      .insert({
        shop_id: shop.id,
        supplier_id: linenSupplier.id,
        status: 'shipped',
        expected_delivery_date: new Date().toISOString().split('T')[0],
        notes: 'Seed PO — ready to receive',
      }).returning('*');

    for (const v of linenVariants) {
      await trx('purchase_order_line_items').insert({
        po_id: linenPo.id, shop_id: shop.id,
        lasyncro_variant_id: v.lasyncro_variant_id,
        description: v.sku, quantity_ordered: 25, quantity_received: 0, unit_cost_cents: 1800,
      });
    }

    console.log(`[DEV_SEED] Wool & Co + Linen House suppliers and POs seeded`);

    // ── INVENTORY TRUTH ──────────────────────────────────────────────────────
    // Assign variants to specific bins — enables spatial pick route and zone_distribution in pool
    // Bin assignment: round-robin across A-1..A-4, B-1..B-4, C-1..C-4
    // SET LOCAL required: inventory_truth has forced RLS enabled
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shop.id}'`);
    const binLocations = ['A-1','A-2','A-3','A-4','B-1','B-2','B-3','B-4','C-1','C-2','C-3','C-4'];
    for (let vi = 0; vi < variantIds.length; vi++) {
      const v = variantIds[vi];
      const binCode = binLocations[vi % binLocations.length];
      const qty = Math.floor(Math.random() * 80) + 20;
      await trx('inventory_truth').insert({
        shop_id: shop.id,
        lasyncro_variant_id: v.lasyncro_variant_id,
        location_code: binCode,
        on_hand_quantity: qty,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: qty,
        sellable_quantity: qty,
        last_evaluated_at: now,
      }).onConflict(['shop_id', 'lasyncro_variant_id', 'location_code']).merge();
    }
    console.log(`[DEV_SEED] Created inventory_truth for ${variantIds.length} variants across bins A-1..C-4`);

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

      // order_line_items — required for pool line_item_count, unit_count, pick route
      await trx('order_line_items').insert({
        lasyncro_line_item_id: trx.raw('gen_random_uuid()'),
        lasyncro_order_id: order.lasyncro_order_id,
        lasyncro_product_id: variant.product_id,
        lasyncro_variant_id: variant.lasyncro_variant_id,
        title: variant.sku ?? 'FT2 Product',
        sku: variant.sku ?? null,
        quantity: qty,
        unit_price: unitPrice,
        line_total: totalPrice,
        platform: 'shopify',
        external_line_item_id: `ft2-${i}-${Date.now()}`,
        created_at: orderDate,
        updated_at: orderDate,
      }).onConflict(['platform', 'external_line_item_id']).ignore();

      // external_order_identity_map — required for pool external_order_id display
      await trx('external_order_identity_map').insert({
        lasyncro_order_id: order.lasyncro_order_id,
        shop_id: shop.id,
        platform: 'shopify',
        external_order_id: `${100100 + i}`,
      }).onConflict(['shop_id', 'platform', 'external_order_id']).ignore();
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

    // ── SHOPIFY_APP_INSTALLATIONS (RET-AUD-24 fix, 2026-07-04) ────────────────
    //
    // Root cause this seeds around: shopify_app_installations.shop_id has
    // ON DELETE CASCADE from shops (migration 0014). This seed's cleanup
    // step deletes `shops` on every run — which silently wiped this table
    // via cascade even though nothing here ever referenced its name
    // directly. Every Shopify webhook handler (handleRefundCreated,
    // handleOrderPaid, handleOrderFulfillment, etc. — see
    // webhookRouter.ts) resolves the target shop via this table; with it
    // empty, every inbound webhook was silently unroutable after any
    // dev:full-reset / dev:full-seed cycle, with no error anywhere.
    //
    // This is a PLACEHOLDER row, exactly like `integrations` above —
    // access_token is NOT a real Shopify token and cannot make real API
    // calls. Its only job is to let local webhook testing (via ngrok +
    // Shopify's legacy per-store webhook config, see
    // docs/blueprints/carrier-integration.md for why the app's own OAuth
    // can't point at localhost without touching the production app
    // registration) reach past the shop-resolution step instead of
    // failing at the very first lookup every handler makes.
    //
    // encrypt() used (not a raw string) because
    // shopify_app_installations.access_token IS actively decrypt()-ed by
    // every handler the moment a webhook arrives — unlike
    // integrations.access_token_encrypted, which sits untouched while
    // sync_status stays 'PENDING'. A non-JSON placeholder here would
    // throw inside decrypt() on the very first webhook instead of the
    // clean "no row found" skip this used to produce.
    //
    // If real Shopify API calls are needed in dev (not just receiving
    // webhooks), this row must still be replaced by a real OAuth
    // handshake — see RET-AUD-24/32 in the audit register for why a
    // fully automated real-token seed isn't possible (Shopify's OAuth
    // requires a live, signed, browser-interactive redirect; it cannot be
    // scripted from a seed file).
    await trx('shopify_app_installations')
      .insert({
        shop_id: shop.id,
        shop_domain: 'development-store-15820042357.myshopify.com',
        access_token: encrypt('dev_seed_placeholder_not_a_real_shopify_token'),
        scopes:
          'read_products,read_orders,read_returns,read_customers,read_inventory,read_fulfillments,write_fulfillments,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders',
        installed_at: now,
      })
      .onConflict(['shop_domain'])
      .merge({
        shop_id: shop.id,
        access_token: encrypt('dev_seed_placeholder_not_a_real_shopify_token'),
        scopes:
          'read_products,read_orders,read_returns,read_customers,read_inventory,read_fulfillments,write_fulfillments,read_merchant_managed_fulfillment_orders,write_merchant_managed_fulfillment_orders',
        updated_at: now,
      });

      console.log('[DEV_SEED] ✅ shopify_app_installations placeholder seeded (webhook shop-resolution will work; real API calls will not — see inline comment)');
    console.log('[DEV_SEED] ✅ Full operational data seeded');
    console.log('[DEV_SEED] → Trust gate will pass');
    console.log('[DEV_SEED] → Morning brief, cash flow, and FT2 surfaces ready');
  }

  console.log('────────────────────────────────────────');
  console.log('[DEV_SEED] Completed successfully');
  console.log('────────────────────────────────────────');
  });

  // ── LIFECYCLE DOMAIN EVENTS (FT0 + FT2) ────────────────────────────────────
  // ISSUE-01: direct-inserted orders/fulfillment never drove domain_events,
  // so system_readiness_state and ft2_state stayed empty for seeded shops.
  // MUST run after the seed transaction above commits — processDomainEvent
  // reads domain_events via its own separate connection/transaction, so an
  // event inserted inside the still-open seed trx is invisible to it
  // ([PROJECTION_EVENT_NOT_FOUND]). Uses the plain knex connection, not trx.
  // Skipped entirely if no shop membership exists (bare dev:setup).
  const seededShop = await knex('shops').orderBy('id', 'desc').first();
  if (!seededShop) return;

  const hasMembership = await knex('shop_memberships')
    .where({ shop_id: seededShop.id })
    .first();

  if (hasMembership) {
    console.log('[DEV_SEED] Emitting lifecycle domain events (ft0_completed, ft2_confirmed)…');

    const { processDomainEvent } = await import('../src/events/processDomainEvent.js');

    const owner = await knex('users').where({ shop_id: seededShop.id }).orderBy('id', 'asc').first();

    const countRow = await knex('orders')
      .where({ shop_id: seededShop.id })
      .count<{ count: string }>('* as count')
      .first();

    const liveOrderCount = Number(countRow?.count ?? 0);

    const ft0Result = await knex.raw(
      `INSERT INTO domain_events (shop_id, event_type, event_payload, event_time, event_version, external_event_id)
       VALUES (?, 'ft0/completed', ?, CURRENT_TIMESTAMP, 1, ?)
       ON CONFLICT (shop_id, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        seededShop.id,
        JSON.stringify({ orders: liveOrderCount, firstInsightDelivered: false }),
        `internal:ft0/completed:${seededShop.id}`,
      ]
    );

    const ft0Event = ft0Result.rows[0];

    if (ft0Event) {
      /**
       * SEED-RLS-01 (2026-08-06): processDomainEvent reaches backend-core's
       * guarded db proxy, which reads the shop ID from AsyncLocalStorage.
       * A knex seed has no such frame, so every query inside threw
       * TENANT_CONTEXT_MISSING and aborted dev:full-seed. Surfaced only once
       * the migration runner's RLS release gate started enforcing sf_app as
       * non-superuser — the seed itself did not change.
       */
      await runWithTenantContext(seededShop.id, () => processDomainEvent(ft0Event.id));
      console.log('[DEV_SEED] ✅ ft0_completed processed — system_readiness_state populated');
    } else {
      console.log('[DEV_SEED] ft0_completed already exists — skipped');
    }

    const ft2Result = await knex.raw(
      `INSERT INTO domain_events (shop_id, event_type, event_payload, event_time, event_version, external_event_id)
       VALUES (?, 'lifecycle/ft2_confirmed', ?, CURRENT_TIMESTAMP, 1, ?)
       ON CONFLICT (shop_id, external_event_id) WHERE external_event_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        seededShop.id,
        JSON.stringify({
          user_id: owner?.id ?? null,
          evaluator_version: 'ft2-evaluator@dev-seed',
          evaluation_snapshot: {
            eligible: true,
            status: 'ELIGIBLE',
            blockers: [],
            evidence: { source: 'dev_seed' },
          },
        }),
        `internal:lifecycle/ft2_confirmed:${seededShop.id}`,
      ]
    );
    const ft2Event = ft2Result.rows[0];

    if (ft2Event) {
      // SEED-RLS-01: same tenant frame requirement as ft0 above.
      await runWithTenantContext(seededShop.id, () => processDomainEvent(ft2Event.id));
      console.log('[DEV_SEED] ✅ ft2_confirmed processed — FT2 readiness populated');
    } else {
      console.log('[DEV_SEED] ft2_confirmed already exists — skipped');
    }

    // ── ISSUE-02 NOTE ──────────────────────────────────────────────────────
    // orders_operational_control_snapshot is NOT scheduled here.
    // dev_seed.ts runs before seed_overview.sql (which inserts real
    // domain_events) and before `npm run rebuild` (which replays them).
    // Scheduling the snapshot job this early captures a stale, near-empty
    // state. The snapshot job is scheduled at the npm-script level in
    // package.json's dev:full-seed / dev:full-reset chains, AFTER rebuild
    // completes, so it reflects the fully seeded + rebuilt order data.
  }
}
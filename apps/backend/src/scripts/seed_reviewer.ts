// apps/backend/src/scripts/seed-reviewer.ts
//
// REVIEWER SEED — Shopify App Review Account
// ------------------------------------------
// Creates contact@lasyncro.com as a Growth tenant with:
//   - Full identity (shop + user + owner membership)
//   - Growth subscription + entitlements
//   - Complete floor plan (9 zones → canvas renders on Overview load)
//   - 30 days of revenue_projection_daily
//   - orders_operational_control_snapshot with coherent pulse figures
//
// IDEMPOTENT — safe to run multiple times. All inserts use ON CONFLICT DO NOTHING
// or onConflict().ignore(). The orders_operational_control_snapshot table is
// append-only (immutable triggers block UPDATE/DELETE) — re-runs insert a new
// snapshot row, which is fine since getOverviewPulse reads the latest by date.
//
// RLS: all writes inside a single transaction with SET LOCAL app.current_tenant.
//
// Run: npx tsx apps/backend/src/scripts/seed-reviewer.ts

import db from '@lasyncro/backend-core/db.js';
import bcrypt from 'bcrypt';
import { getTierConfig } from '@lasyncro/backend-core/config/tiers.js';
import { EntitlementsService } from '@lasyncro/backend-core/services/entitlements.service.js';

const REVIEWER_EMAIL    = 'contact@lasyncro.com';
const REVIEWER_PASSWORD = 'ShopifyReview001!';
const SHOP_NAME         = 'LaSyncro Demo Store';
const WAREHOUSE_NAME    = 'Warehouse 01 · London';

async function main(): Promise<void> {
  console.log('────────────────────────────────────────');
  console.log('[REVIEWER_SEED] Starting');
  console.log('────────────────────────────────────────');

  await db.transaction(async (trx) => {

    // Unlock projection-protected tables for seed writes (same as dev_seed.ts).
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    // ── 1. SHOP ───────────────────────────────────────────────────────────────
    const existingShop = await trx.raw(
      `SELECT * FROM shops WHERE name = ? LIMIT 1`, [SHOP_NAME]
    );
    let shop = existingShop.rows?.[0] ?? null;

    if (!shop) {
      const result = await trx.raw(
        `INSERT INTO shops (name) VALUES (?) RETURNING *`, [SHOP_NAME]
      );
      shop = result.rows[0];
      console.log(`[REVIEWER_SEED] Shop created (id=${shop.id})`);
    } else {
      console.log(`[REVIEWER_SEED] Reusing existing shop (id=${shop.id})`);
    }

    const shopId: number = shop.id;

    // SET LOCAL must come after we know shopId — required for all RLS-protected
    // tables below (warehouses, warehouse_locations, revenue_projection_daily,
    // orders_operational_control_snapshot all enforce app.current_tenant).
    await trx.raw(`SET LOCAL "app.current_tenant" = '${shopId}'`);

    // ── 2. USER ───────────────────────────────────────────────────────────────
    const passwordHash = await bcrypt.hash(REVIEWER_PASSWORD, 10);
    const existingUser = await trx.raw(
      `SELECT * FROM users WHERE email = ? LIMIT 1`, [REVIEWER_EMAIL]
    );
    let user = existingUser.rows?.[0] ?? null;

    if (!user) {
      const [inserted] = await trx('users')
        .insert({
          shop_id:       shopId,
          email:         REVIEWER_EMAIL,
          password_hash: passwordHash,
          first_name:    'Shopify',
          last_name:     'Reviewer',
        })
        .returning('*');
      user = inserted;
      console.log(`[REVIEWER_SEED] User created (id=${user.id})`);
    } else {
      console.log(`[REVIEWER_SEED] Reusing existing user (id=${user.id})`);
    }

    // ── 3. MEMBERSHIP (owner) ─────────────────────────────────────────────────
    await trx('shop_memberships')
      .insert({ shop_id: shopId, user_id: user.id, role: 'owner' })
      .onConflict(['shop_id', 'user_id'])
      .merge({ role: 'owner' });

    // ── 4. SUBSCRIPTION + ENTITLEMENTS ────────────────────────────────────────
    await trx('shop_subscriptions')
      .insert({ shop_id: shopId, tier: 'growth', billing_interval: 'monthly', status: 'active' })
      .onConflict('shop_id')
      .merge({ tier: 'growth', status: 'active' });

    const growthConfig = getTierConfig('growth');
    const moduleRows = growthConfig.modules.map((moduleKey) => ({
      shop_id: shopId, module_key: moduleKey, flag_key: null as string | null,
      source: 'reviewer_seed:growth',
    }));
    const flagRows = growthConfig.flags.map((flagKey) => ({
      shop_id: shopId, module_key: flagKey.split('.')[0], flag_key: flagKey,
      source: 'reviewer_seed:growth',
    }));
    await EntitlementsService.applyFromCommercialGrant(trx, [...moduleRows, ...flagRows]);
    console.log('[REVIEWER_SEED] ✅ Growth entitlements seeded');

    // ── 5. WMS + OPERATIONAL SETTINGS ────────────────────────────────────────
    await trx('shop_wms_settings')
      .insert({ shop_id: shopId })
      .onConflict('shop_id').ignore();

    await trx('shop_operational_settings')
      .insert({
        shop_id: shopId,
        fulfillment_sla_hours:   24,
        monthly_overhead_amount: 0,
        starting_cash_balance:   0,
      })
      .onConflict('shop_id').ignore();

    // ── 6. WAREHOUSE ──────────────────────────────────────────────────────────
    const existingWarehouse = await trx('warehouses').where({ shop_id: shopId }).first();
    let warehouseId: string;

    if (!existingWarehouse) {
      const [wh] = await trx('warehouses')
        .insert({
          shop_id:            shopId,
          name:               WAREHOUSE_NAME,
          root_location_code: 'WH-01',
          is_default:         true,
          active:             true,
        })
        .returning('warehouse_id');
      warehouseId = wh.warehouse_id;
      console.log(`[REVIEWER_SEED] Warehouse created (id=${warehouseId})`);
    } else {
      warehouseId = existingWarehouse.warehouse_id;
      console.log(`[REVIEWER_SEED] Reusing existing warehouse (id=${warehouseId})`);
    }

    // ── 7. FLOOR PLAN ─────────────────────────────────────────────────────────
    // Root warehouse node — required parent for all zone lanes.
    await trx('warehouse_locations')
      .insert({
        location_code: 'WH-01', shop_id: shopId, warehouse_id: warehouseId,
        parent_location_code: null, type: 'warehouse', active: true,
        position_x: 0, position_y: 0, width: 32, depth: 22,
        orientation: 0, rack_levels: null, zone_type: null,
      })
      .onConflict(['shop_id', 'location_code']).ignore();

    // Nine operational zones matching the isometric canvas layout.
    // Positions are in metres from top-left origin; width/depth drive 3D geometry.
    const zones: Array<{
      code: string; zone_type: string;
      x: number; y: number; w: number; d: number; levels: number | null;
    }> = [
      { code: 'RECEIVE-1',    zone_type: 'receive',    x: 0,  y: 0,  w: 6, d: 5,  levels: null },
      { code: 'A-RACK',       zone_type: 'storage',    x: 7,  y: 0,  w: 6, d: 9,  levels: 4    },
      { code: 'B-RACK',       zone_type: 'storage',    x: 14, y: 0,  w: 6, d: 9,  levels: 4    },
      { code: 'C-RACK',       zone_type: 'pick',       x: 21, y: 0,  w: 6, d: 9,  levels: 3    },
      { code: 'PACK-1',       zone_type: 'pack',       x: 0,  y: 11, w: 6, d: 5,  levels: null },
      { code: 'SHIP-1',       zone_type: 'ship',       x: 7,  y: 11, w: 6, d: 5,  levels: null },
      { code: 'RETURNS-1',    zone_type: 'returns',    x: 14, y: 11, w: 6, d: 5,  levels: null },
      { code: 'QUARANTINE-1', zone_type: 'quarantine', x: 21, y: 11, w: 4, d: 5,  levels: null },
      { code: 'KITTING-1',    zone_type: 'kitting',    x: 26, y: 11, w: 4, d: 5,  levels: null },
    ];

    for (const z of zones) {
      await trx('warehouse_locations')
        .insert({
          location_code: z.code, shop_id: shopId, warehouse_id: warehouseId,
          parent_location_code: 'WH-01', type: 'lane', active: true,
          position_x: z.x, position_y: z.y, width: z.w, depth: z.d,
          orientation: 0, rack_levels: z.levels, zone_type: z.zone_type,
        })
        .onConflict(['shop_id', 'location_code']).ignore();
    }
    console.log('[REVIEWER_SEED] ✅ Floor plan seeded (9 zones)');

    // ── 8. REVENUE PROJECTION DAILY (30 days) ────────────────────────────────
    // Provides revenueToday + revenueDeltaVsYesterday for the pulse card.
    // today=$1,300 | yesterday=$3,575 → delta=-$2,275 (matches the mockup).
    // Remaining 28 days provide realistic revenue history for trend charts.
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const revenueRows = Array.from({ length: 30 }, (_, i) => {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      // Deterministic revenue pattern — no Math.random() so seed is stable.
      const base = 8000 + Math.round(Math.sin(i * 0.8) * 2800) + (i * 113 % 1900);
      const grossRevenue = i === 0 ? 1300 : i === 1 ? 3575 : base;
      return {
        shop_id:         shopId,
        revenue_date:    dateStr,
        gross_revenue:   grossRevenue,
        order_count:     i === 0 ? 4 : Math.max(1, Math.round(grossRevenue / 320)),
        at_risk_revenue: i === 0 ? 18210 : Math.round((i * 317) % 6000),
        evaluated_at:    new Date().toISOString(),
        updated_at:      new Date().toISOString(),
      };
    });

    await trx('revenue_projection_daily')
      .insert(revenueRows)
      .onConflict(['shop_id', 'revenue_date']).ignore();
    console.log('[REVIEWER_SEED] ✅ Revenue projection seeded (30 days)');

    // ── 9. OPERATIONAL CONTROL SNAPSHOT ──────────────────────────────────────
    // Append-only table — INSERT only, never UPDATE/DELETE (immutable triggers).
    // ON CONFLICT DO NOTHING: if script is re-run same second, no-op.
    // getOverviewPulse reads latest row by snapshot_date DESC, so re-runs that
    // land at a different timestamp just add a new identical row (harmless).
    //
    // Numbers are internally consistent with the pulse card mockup:
    //   collected=$6,135 | blocked=$18,210 | top_blocking_type=customer
    //   3 exception orders (2 address issues + 1 operational block)
    await trx.raw(`
      INSERT INTO orders_operational_control_snapshot (
        shop_id, aggregate_version, snapshot_date,
        realized_revenue, at_risk_revenue, blocked_revenue,
        total_at_risk_revenue, sla_breach_24h_revenue,
        top_blocking_type, pending_revenue, total_gmv, revenue_leakage,
        avg_contribution_margin_pct, orders_at_sla_risk,
        aging_under_24h, aging_24h, aging_48h, aging_72h, aging_72h_plus,
        pending_fulfillment, fulfilled_orders, pending_payment,
        exception_orders, constrained_orders,
        revenue_blocked_inventory, revenue_blocked_customer, revenue_blocked_operational,
        ready_to_ship_revenue,
        queue_manual_review, queue_awaiting_inventory, queue_ready_to_ship, queue_awaiting_customer,
        partial_fulfillment_opportunity, oldest_exception_order_age_hours
      ) VALUES (
        ${shopId}, 1, NOW(),
        6135.00, 0.00, 18210.00,
        18210.00, 18210.00,
        'customer', 975.00, 25320.00, 0.00,
        0.3200, 3,
        4, 1, 1, 1, 0,
        8, 22, 0,
        3, 0,
        0.00, 18210.00, 0.00,
        975.00,
        0, 0, 4, 3,
        0, 72
      )
      ON CONFLICT (shop_id, snapshot_date) DO NOTHING
    `);
    console.log('[REVIEWER_SEED] ✅ Operational snapshot seeded');

    // ── 10. FT0 + FT2 COMPLETION ─────────────────────────────────────────────
    // Required for the Overview module to render (ft2_confirmed gates the view).
    // Guard prevents duplicate events on re-run.
    const hasFt0 = await trx('domain_events')
      .where({ shop_id: shopId, event_type: 'ft0/completed' })
      .first();
    if (!hasFt0) {
      await trx('domain_events').insert({
        shop_id: shopId, event_type: 'ft0/completed',
        event_payload: { orders: 8, firstInsightDelivered: true },
        event_time: new Date(),
      });
    }

    const hasFt2 = await trx('domain_events')
      .where({ shop_id: shopId, event_type: 'lifecycle/ft2_confirmed' })
      .first();
    if (!hasFt2) {
      await trx('domain_events').insert({
        shop_id: shopId, event_type: 'lifecycle/ft2_confirmed',
        event_payload: { user_id: user.id, evaluator_version: 'reviewer-seed', evaluation_snapshot: {} },
        event_time: new Date(),
      });
    }
    console.log('[REVIEWER_SEED] ✅ FT0/FT2 completion events seeded');

  });

  console.log('────────────────────────────────────────');
  console.log('[REVIEWER_SEED] ✅ Complete');
  console.log(`[REVIEWER_SEED] Email:    ${REVIEWER_EMAIL}`);
  console.log(`[REVIEWER_SEED] Password: ${REVIEWER_PASSWORD}`);
  console.log('[REVIEWER_SEED] Tier:     Growth');
  console.log('[REVIEWER_SEED] Floor:    9 zones — canvas renders on Overview load');
  console.log('────────────────────────────────────────');

  await db.destroy();
}

main().catch((err) => {
  console.error('[REVIEWER_SEED] ❌ Failed:', err.message ?? err);
  process.exit(1);
});
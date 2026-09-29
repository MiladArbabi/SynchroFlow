// tests/integration/floor-planning/bin-occupancy-inventory-inspection.test.ts
//
// INVENTORY INTELLIGENCE RED-C — spatial inspection data on the EXISTING
// GET /api/v1/floor-planning/grid/occupancy route (no new endpoint).
//
// ADDITIVE TARGET — response.inventoryInspection:
//   Record<location_code, {
//     on_hand_quantity, available_quantity, reserved_quantity,
//     variants: [{ lasyncro_variant_id, sku, product_title, variant_title,
//                  on_hand_quantity, available_quantity, reserved_quantity }]
//   }>
// - every canonical inventory_truth row: positive, zero AND negative on_hand
// - each quantity is its own canonical column; on_hand stays signed
// - nullable variant/product metadata never drops a physical row
// - a location ABSENT from inventoryInspection has no canonical truth record
//   (it is not zero)
// - another tenant's rows never appear
//
// COMPATIBILITY — response.occupancy keeps today's positive-only contract
// (on_hand_quantity total + 4-field variants) for Overview / Floor Planning;
// zero and signed rows must never leak into it.
//
// Real Express app (createApp) + route middleware (authenticateToken →
// requireFt2 → requireCapability('warehouse.floor_planning') →
// requireAction('floor-planning:read')) with a Growth OWNER token. Route
// permissions are not altered. Fixture = inventory_movements replayed through
// rebuildInventoryProjectionForVariants on a disposable PostgreSQL DB.

import request from 'supertest';
import crypto from 'crypto';
import { createApp } from 'api-src/bootstrap/express';
import db, {
  withTenant,
  systemTransaction,
  setTenantContext,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { transitionShopSubscription } from 'api-src/services/billing/subscriptionTransition.service';
import { rebuildInventoryProjectionForVariants } from 'api-src/services/inventory/rebuildInventoryProjection';
import { issueTestToken } from '../../unit/helpers/auth';

jest.setTimeout(120000);

const app = createApp();

type Movement = {
  location: string;
  movement_type: 'inbound_purchase' | 'shrinkage' | 'reservation_hold';
  quantity_delta: number;
};

const POSITIVE_A = 'REDC-POSITIVE-A';
const ZERO_A = 'REDC-ZERO-A';
const PHANTOM_A = 'REDC-PHANTOM-A';
const METADATA_A = 'REDC-METADATA-A';
const NEVER_USED_A = 'REDC-NEVER-USED-A';

async function createFixtureShop(namePrefix: string): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');
  return systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${namePrefix}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });
}

/** Growth owner who clears requireFt2, warehouse.floor_planning and floor-planning:read. */
async function seedGrowthOwner(shopId: number): Promise<number> {
  const unique = crypto.randomBytes(6).toString('hex');

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `redc-inspection+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return row.id as number;
  });

  await withTenant(shopId, (trx) =>
    trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' }),
  );

  await withTenant(shopId, (trx) =>
    trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    }),
  );

  await withTenant(shopId, (trx) =>
    transitionShopSubscription(
      {
        shopId,
        to: { tier: 'growth', status: 'active', billingProvider: 'shopify' },
        source: 'red_c_inspection_test',
        reason: 'test_tier_fixture',
        actorType: 'shopify',
        actingProvider: 'shopify',
      },
      trx,
    ),
  );

  return userId;
}

async function seedWarehouse(shopId: number, binCodes: string[]): Promise<string> {
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'RED-C fixture warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert({
      shop_id: shopId,
      warehouse_id: warehouseId,
      location_code: rootCode,
      type: 'warehouse',
      parent_location_code: null,
      active: true,
      zone_type: null,
    });

    for (const code of binCodes) {
      await trx('warehouse_locations').insert({
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: code,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'storage',
      });
    }
  });

  return rootCode;
}

async function seedVariant(
  shopId: number,
  opts: { sku: string | null; variantTitle: string | null; productTitle: string | null }
): Promise<string> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: opts.productTitle,
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: opts.sku,
      title: opts.variantTitle,
      unit_cost: '5.00',
      status: 'active',
    });
  });

  return variantId;
}

async function recordMovements(shopId: number, variantId: string, movements: Movement[]) {
  await withTenant(shopId, async (trx) => {
    for (const m of movements) {
      await trx('inventory_movements').insert({
        lasyncro_inventory_movement_id: crypto.randomUUID(),
        device_event_id: crypto.randomUUID(),
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        movement_type: m.movement_type,
        quantity_delta: m.quantity_delta,
        reference_type: 'test_fixture_red_c',
        reference_id: crypto.randomUUID(),
        platform: 'wms',
        location_code: m.location,
        occurred_at: new Date(),
        triggered_by: 'test_fixture',
      });
    }
  });
}

async function rebuild(shopId: number, variantIds: string[]) {
  await withTenant(shopId, (trx) =>
    rebuildInventoryProjectionForVariants(shopId, variantIds, trx, new Date())
  );
}

function byVariantId<T extends { lasyncro_variant_id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.lasyncro_variant_id.localeCompare(b.lasyncro_variant_id));
}

describe('INVENTORY INTELLIGENCE RED-C — occupancy route carries additive inventoryInspection', () => {
  let shopA: number;
  let shopB: number;
  let token: string;
  let body: Record<string, any>;
  const v: Record<string, string> = {};

  beforeAll(async () => {
    shopA = await createFixtureShop('redc-inspection-a');
    shopB = await createFixtureShop('redc-inspection-b');
    const userId = await seedGrowthOwner(shopA);

    await seedWarehouse(shopA, [POSITIVE_A, ZERO_A, PHANTOM_A, METADATA_A, NEVER_USED_A]);

    v.a = await seedVariant(shopA, { sku: 'REDC-SKU-A', variantTitle: 'Variant A', productTitle: 'Product A' });
    v.b = await seedVariant(shopA, { sku: 'REDC-SKU-B', variantTitle: 'Variant B', productTitle: 'Product B' });
    v.zero = await seedVariant(shopA, { sku: 'REDC-SKU-ZERO', variantTitle: 'Variant Zero', productTitle: 'Product Zero' });
    v.phantom = await seedVariant(shopA, { sku: 'REDC-SKU-PHANTOM', variantTitle: 'Variant Phantom', productTitle: 'Product Phantom' });
    v.metadata = await seedVariant(shopA, { sku: null, variantTitle: null, productTitle: null });

    // POSITIVE-A: A on_hand 8 / reserved 3 / available 5; B on_hand 4 / available 4.
    await recordMovements(shopA, v.a, [
      { location: POSITIVE_A, movement_type: 'inbound_purchase', quantity_delta: 8 },
      { location: POSITIVE_A, movement_type: 'reservation_hold', quantity_delta: 3 },
    ]);
    await recordMovements(shopA, v.b, [
      { location: POSITIVE_A, movement_type: 'inbound_purchase', quantity_delta: 4 },
    ]);
    // ZERO-A: stock recorded and then removed → explicit 0 / 0 / 0 row.
    await recordMovements(shopA, v.zero, [
      { location: ZERO_A, movement_type: 'inbound_purchase', quantity_delta: 2 },
      { location: ZERO_A, movement_type: 'shrinkage', quantity_delta: -2 },
    ]);
    // PHANTOM-A: removal with no recorded receipt → signed on_hand −2.
    await recordMovements(shopA, v.phantom, [
      { location: PHANTOM_A, movement_type: 'shrinkage', quantity_delta: -2 },
    ]);
    // METADATA-A: physical stock whose SKU / variant title / product title are null.
    await recordMovements(shopA, v.metadata, [
      { location: METADATA_A, movement_type: 'inbound_purchase', quantity_delta: 3 },
    ]);

    await rebuild(shopA, [v.a, v.b, v.zero, v.phantom, v.metadata]);

    // TENANT B — stock at the same location code as tenant A's POSITIVE-A and
    // at a code tenant A mapped but never used.
    await seedWarehouse(shopB, [POSITIVE_A, NEVER_USED_A]);
    const shopBVariant = await seedVariant(shopB, { sku: 'REDC-SKU-B-TENANT', variantTitle: 'Other tenant', productTitle: 'Other tenant' });
    await recordMovements(shopB, shopBVariant, [
      { location: POSITIVE_A, movement_type: 'inbound_purchase', quantity_delta: 50 },
      { location: NEVER_USED_A, movement_type: 'inbound_purchase', quantity_delta: 7 },
    ]);
    await rebuild(shopB, [shopBVariant]);

    token = issueTestToken({ userId, shopId: shopA, tier: 'growth', roles: ['owner'] });
    const res = await request(app)
      .get('/api/v1/floor-planning/grid/occupancy')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    body = res.body;
  });

  afterAll(async () => {
    await db.destroy();
  });

  it('fixture precondition: projected truth rows carry the intended canonical values', async () => {
    const rows = await withTenant(shopA, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: shopA })
        .select('lasyncro_variant_id', 'location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity')
    );
    const at = (variantId: string, code: string) => {
      const row = rows.find((r: any) => r.lasyncro_variant_id === variantId && r.location_code === code);
      expect(row).toBeDefined();
      return [Number(row.on_hand_quantity), Number(row.reserved_quantity), Number(row.available_quantity)];
    };

    expect(at(v.a, POSITIVE_A)).toEqual([8, 3, 5]);
    expect(at(v.b, POSITIVE_A)).toEqual([4, 0, 4]);
    expect(at(v.zero, ZERO_A)).toEqual([0, 0, 0]);
    expect(at(v.phantom, PHANTOM_A)).toEqual([-2, 0, 0]);
    expect(at(v.metadata, METADATA_A)).toEqual([3, 0, 3]);
    expect(rows.some((r: any) => r.location_code === NEVER_USED_A)).toBe(false);
  });

  it('COMPATIBILITY: legacy occupancy keeps its positive-only contract', () => {
    expect(body.occupancy[POSITIVE_A]).toEqual({
      on_hand_quantity: 12,
      variants: expect.any(Array),
    });
    expect(byVariantId(body.occupancy[POSITIVE_A].variants)).toEqual(
      byVariantId([
        { lasyncro_variant_id: v.a, sku: 'REDC-SKU-A', product_title: 'Product A', on_hand_quantity: 8 },
        { lasyncro_variant_id: v.b, sku: 'REDC-SKU-B', product_title: 'Product B', on_hand_quantity: 4 },
      ])
    );

    // Zero and signed rows never reach Overview / Floor Planning through it.
    expect(body.occupancy).not.toHaveProperty([ZERO_A]);
    expect(body.occupancy).not.toHaveProperty([PHANTOM_A]);
    expect(body.occupancy).not.toHaveProperty([NEVER_USED_A]);
  });

  it('POSITIVE-A: location totals are the three canonical column sums, with both variant rows', () => {
    expect(body).toHaveProperty(['inventoryInspection', POSITIVE_A, 'on_hand_quantity'], 12);
    expect(body).toHaveProperty(['inventoryInspection', POSITIVE_A, 'available_quantity'], 9);
    expect(body).toHaveProperty(['inventoryInspection', POSITIVE_A, 'reserved_quantity'], 3);

    expect(byVariantId(body.inventoryInspection[POSITIVE_A].variants)).toEqual(
      byVariantId([
        {
          lasyncro_variant_id: v.a,
          sku: 'REDC-SKU-A',
          product_title: 'Product A',
          variant_title: 'Variant A',
          on_hand_quantity: 8,
          available_quantity: 5,
          reserved_quantity: 3,
        },
        {
          lasyncro_variant_id: v.b,
          sku: 'REDC-SKU-B',
          product_title: 'Product B',
          variant_title: 'Variant B',
          on_hand_quantity: 4,
          available_quantity: 4,
          reserved_quantity: 0,
        },
      ])
    );
  });

  it('ZERO-A: an explicit canonical zero row is present, not dropped', () => {
    expect(body).toHaveProperty(['inventoryInspection', ZERO_A, 'on_hand_quantity'], 0);
    expect(body).toHaveProperty(['inventoryInspection', ZERO_A, 'available_quantity'], 0);
    expect(body).toHaveProperty(['inventoryInspection', ZERO_A, 'reserved_quantity'], 0);
    expect(body.inventoryInspection[ZERO_A].variants).toEqual([
      expect.objectContaining({
        lasyncro_variant_id: v.zero,
        on_hand_quantity: 0,
        available_quantity: 0,
        reserved_quantity: 0,
      }),
    ]);
  });

  it('PHANTOM-A: signed negative on_hand is preserved, not clamped or removed', () => {
    expect(body).toHaveProperty(['inventoryInspection', PHANTOM_A, 'on_hand_quantity'], -2);
    expect(body).toHaveProperty(['inventoryInspection', PHANTOM_A, 'available_quantity'], 0);
    expect(body).toHaveProperty(['inventoryInspection', PHANTOM_A, 'reserved_quantity'], 0);
    expect(body.inventoryInspection[PHANTOM_A].variants).toEqual([
      expect.objectContaining({ lasyncro_variant_id: v.phantom, on_hand_quantity: -2 }),
    ]);
  });

  it('METADATA-A: null SKU / variant title / product title never drop the physical row', () => {
    expect(body).toHaveProperty(['inventoryInspection', METADATA_A, 'on_hand_quantity'], 3);
    expect(body.inventoryInspection[METADATA_A].variants).toEqual([
      {
        lasyncro_variant_id: v.metadata,
        sku: null,
        product_title: null,
        variant_title: null,
        on_hand_quantity: 3,
        available_quantity: 3,
        reserved_quantity: 0,
      },
    ]);
  });

  it('NEVER-USED-A: a mapped bin with no canonical truth is absent, not zero', () => {
    expect(body).toHaveProperty('inventoryInspection');
    expect(body.inventoryInspection).not.toHaveProperty([NEVER_USED_A]);
  });

  it('TENANT ISOLATION: tenant B rows at colliding codes never reach tenant A', () => {
    expect(body).toHaveProperty(['inventoryInspection', POSITIVE_A, 'on_hand_quantity'], 12);
    const variantIds = Object.values(body.inventoryInspection as Record<string, any>)
      .flatMap((loc: any) => loc.variants.map((row: any) => row.lasyncro_variant_id));
    expect(variantIds.sort()).toEqual([v.a, v.b, v.zero, v.phantom, v.metadata].sort());
    expect(body.inventoryInspection).not.toHaveProperty([NEVER_USED_A]);
  });
});

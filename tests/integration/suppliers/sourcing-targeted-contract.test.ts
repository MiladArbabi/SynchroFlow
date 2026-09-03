// SOURCING-UX-COGNITIVE-01 Slice 1A — TARGETED RECOVERY FOUNDATION
//
// Ratified backend contracts for GET /api/v1/suppliers/sourcing-recommendations/:variantId
// when a merchant arrives from a blocked order.
//
// These tests describe REQUIRED OBSERVABLE BEHAVIOUR of the endpoint. They are
// written against the ratified contracts, not against any implementation.
//
// SRC-L3-01  valid same-tenant target returns targeted sourcing data
// SRC-L3-02  identity: image_url / product_title / variant_title / sku
// SRC-L3-03  a variant with no image returns image_url: null (no fabricated fallback)
// SRC-L3-04  purchasing truth: available / open_demand / committed_inbound /
//            short_now / still_to_source
// SRC-L3-05  short_now      = max(0, open_demand - available)
// SRC-L3-06  still_to_source = max(0, open_demand - available - committed_inbound)
// SRC-L3-07  committed inbound status domain (inclusion AND exclusion)
// SRC-L3-08  partial receipt contributes the REMAINDER, never the ordered qty
// SRC-L3-09  pending reorder requests are intent, not committed inbound
// SRC-L3-10  canonical blocking orders for the requested variant
// SRC-L3-11  originating order is CONTEXT: echoed, never an input to the maths
// SRC-L3-11B unrelated same-tenant order is not echoed and is not injected
// SRC-L3-12  open_demand aggregates ALL open demand for the variant
// SRC-L3-15  unknown/non-tenant target is 404, distinct from 200-with-no-suppliers
// SRC-L3-16  the endpoint is a read — it mutates no purchasing/inventory state

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const now = new Date('2026-09-03T12:00:00.000Z');

const SOURCING_PATH = '/api/v1/suppliers/sourcing-recommendations';

/**
 * COMMITTED-INBOUND STATUS DOMAIN — the contract under test (SRC-L3-07).
 *
 * Declared as data rather than hard-coded into a single expected constant so a
 * status silently moving between the two lists changes the arithmetic the test
 * derives, not just a magic number a reader must trust.
 */
const INCLUDED_INBOUND_LINES = [
  { status: 'ordered',            ordered: 2, received: 0 }, // → 2
  { status: 'confirmed',          ordered: 1, received: 0 }, // → 1
  { status: 'in_production',      ordered: 1, received: 0 }, // → 1
  { status: 'shipped',            ordered: 1, received: 0 }, // → 1
  { status: 'partially_received', ordered: 5, received: 3 }, // → 2  (SRC-L3-08)
] as const;

/**
 * Each excluded status carries a deliberately large quantity: if any of them
 * were counted the derived numbers below could not possibly still hold.
 */
const EXCLUDED_INBOUND_LINES = [
  { status: 'draft',     ordered: 100, received: 0 },
  { status: 'received',  ordered: 100, received: 0 },
  { status: 'cancelled', ordered: 100, received: 0 },
] as const;

const remaining = (line: { ordered: number; received: number }) =>
  Math.max(line.ordered - line.received, 0);

const EXPECTED_COMMITTED_INBOUND = INCLUDED_INBOUND_LINES.reduce(
  (sum, line) => sum + remaining(line),
  0
); // 7

const EXPECTED_EXCLUDED_UNITS = EXCLUDED_INBOUND_LINES.reduce(
  (sum, line) => sum + remaining(line),
  0
); // 300

// Open demand is split across two orders so SRC-L3-12 proves aggregation.
const ORDER_ONE_UNITS = 6;
const ORDER_TWO_UNITS = 4;
const EXPECTED_OPEN_DEMAND = ORDER_ONE_UNITS + ORDER_TWO_UNITS;           // 10
const EXPECTED_AVAILABLE = 2;
const EXPECTED_SHORT_NOW = Math.max(0, EXPECTED_OPEN_DEMAND - EXPECTED_AVAILABLE); // 8
const EXPECTED_STILL_TO_SOURCE = Math.max(
  0,
  EXPECTED_OPEN_DEMAND - EXPECTED_AVAILABLE - EXPECTED_COMMITTED_INBOUND
); // 1

const TARGET_IMAGE_URL = 'https://cdn.test.invalid/targeted-shirt.png';
const PENDING_REORDER_QTY = 50;

type Fixture = {
  shopId: number;
  userId: number;
  token: string;
  supplierId: number;
  productId: string;
  productTitle: string;
  /** The targeted variant: has an image, open demand, stock and inbound. */
  targetVariantId: string;
  targetVariantTitle: string;
  targetSku: string;
  /** A same-tenant variant with NO image and NO supplier history. */
  bareVariantId: string;
  /** Orders that genuinely block the targeted variant. */
  blockingOrderOneId: string;
  blockingOrderOneExternalId: string;
  blockingOrderTwoId: string;
  blockingOrderTwoExternalId: string;
  /** Fully fulfilled — same variant, but nothing outstanding. */
  settledOrderId: string;
  /** Same tenant, different variant — never a blocker for the target. */
  unrelatedOrderId: string;
};

async function createFixture(): Promise<Fixture> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sourcing-targeted-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `sourcing-targeted+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    return Number(row.id ?? row);
  });

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: userId,
      role: 'owner',
    });

    // requireFt2 resolves the lifecycle phase for the token's user.
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: now,
      last_event_id: crypto.randomUUID(),
    });

    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'core',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
  });

  const productId = crypto.randomUUID();
  const productTitle = 'Targeted Recovery Product';
  const targetVariantId = crypto.randomUUID();
  const targetVariantTitle = 'Targeted Recovery Variant';
  const targetSku = `SRC-TGT-${unique}`;
  const bareVariantId = crypto.randomUUID();
  const unrelatedVariantId = crypto.randomUUID();

  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Targeted sourcing warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    await trx('warehouse_locations').insert([
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: rootCode,
        type: 'warehouse',
        parent_location_code: null,
        active: true,
        zone_type: null,
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'A-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
    ]);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: productTitle,
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert([
      {
        lasyncro_variant_id: targetVariantId,
        lasyncro_product_id: productId,
        shop_id: shopId,
        sku: targetSku,
        title: targetVariantTitle,
        image_url: TARGET_IMAGE_URL,
        unit_cost: '5.00',
        status: 'active',
      },
      {
        // SRC-L3-03: deliberately no image_url, and no supplier history.
        lasyncro_variant_id: bareVariantId,
        lasyncro_product_id: productId,
        shop_id: shopId,
        sku: `SRC-BARE-${unique}`,
        title: 'Bare Variant Without Image',
        unit_cost: '5.00',
        status: 'active',
      },
      {
        lasyncro_variant_id: unrelatedVariantId,
        lasyncro_product_id: productId,
        shop_id: shopId,
        sku: `SRC-OTHER-${unique}`,
        title: 'Unrelated Variant',
        unit_cost: '5.00',
        status: 'active',
      },
    ]);

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: targetVariantId,
      location_code: 'A-1',
      on_hand_quantity: EXPECTED_AVAILABLE,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: EXPECTED_AVAILABLE,
      last_evaluated_at: now,
    });
  });

  const blockingOrderOneId = crypto.randomUUID();
  const blockingOrderTwoId = crypto.randomUUID();
  const settledOrderId = crypto.randomUUID();
  const unrelatedOrderId = crypto.randomUUID();

  const externalId = (suffix: string) => `${Date.now()}${suffix}`;
  const blockingOrderOneExternalId = externalId('001');
  const blockingOrderTwoExternalId = externalId('002');

  async function seedOrder(
    trx: any,
    orderId: string,
    externalOrderId: string | null,
    line: { variantId: string; quantity: number; fulfilled: number }
  ) {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    if (externalOrderId) {
      await trx('external_order_identity_map').insert({
        lasyncro_order_id: orderId,
        shop_id: shopId,
        platform: 'shopify',
        external_order_id: externalOrderId,
      });
    }

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: line.variantId,
      sku: null,
      title: 'Targeted sourcing line',
      quantity: line.quantity,
      fulfilled_quantity: line.fulfilled,
      unit_price: '100.00',
      line_total: (100 * line.quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });
  }

  await withTenant(shopId, async (trx) => {
    await seedOrder(trx, blockingOrderOneId, blockingOrderOneExternalId, {
      variantId: targetVariantId,
      quantity: ORDER_ONE_UNITS,
      fulfilled: 0,
    });

    await seedOrder(trx, blockingOrderTwoId, blockingOrderTwoExternalId, {
      variantId: targetVariantId,
      quantity: ORDER_TWO_UNITS,
      fulfilled: 0,
    });

    // Same variant, nothing outstanding — must never be a blocking order.
    await seedOrder(trx, settledOrderId, externalId('003'), {
      variantId: targetVariantId,
      quantity: 3,
      fulfilled: 3,
    });

    // Same tenant, different variant — the SRC-L3-11B probe.
    await seedOrder(trx, unrelatedOrderId, externalId('004'), {
      variantId: unrelatedVariantId,
      quantity: 5,
      fulfilled: 0,
    });
  });

  const supplierId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({
        shop_id: shopId,
        name: 'Targeted Sourcing Supplier',
        active: true,
      })
      .returning('id');

    return Number(row.id ?? row);
  });

  await withTenant(shopId, async (trx) => {
    for (const line of [...INCLUDED_INBOUND_LINES, ...EXCLUDED_INBOUND_LINES]) {
      const [po] = await trx('purchase_orders')
        .insert({
          shop_id: shopId,
          supplier_id: supplierId,
          status: line.status,
        })
        .returning('id');

      await trx('purchase_order_line_items').insert({
        po_id: po.id ?? po,
        shop_id: shopId,
        lasyncro_variant_id: targetVariantId,
        description: `Inbound line (${line.status})`,
        quantity_ordered: line.ordered,
        quantity_received: line.received,
      });
    }

    // SRC-L3-09: buying INTENT pooled for MOQ. No supplier commitment, no ETA.
    await trx('reorder_requests').insert({
      shop_id: shopId,
      lasyncro_variant_id: targetVariantId,
      supplier_id: supplierId,
      qty_requested: PENDING_REORDER_QTY,
      source: 'manual',
      status: 'pending',
    });
  });

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'core' }),
    supplierId,
    productId,
    productTitle,
    targetVariantId,
    targetVariantTitle,
    targetSku,
    bareVariantId,
    blockingOrderOneId,
    blockingOrderOneExternalId,
    blockingOrderTwoId,
    blockingOrderTwoExternalId,
    settledOrderId,
    unrelatedOrderId,
  };
}

/** Tenant-scoped counters for the read-only guard (SRC-L3-16). */
async function purchasingStateSnapshot(shopId: number) {
  return withTenant(shopId, async (trx) => {
    const count = async (table: string) => {
      const row = await trx(table).where({ shop_id: shopId }).count({ n: '*' }).first();
      return Number(row?.n ?? 0);
    };

    const inboundRow = await trx('purchase_order_line_items')
      .where({ shop_id: shopId })
      .sum({ ordered: 'quantity_ordered', received: 'quantity_received' })
      .first();

    const availableRow = await trx('inventory_truth')
      .where({ shop_id: shopId })
      .sum({ available: 'available_quantity' })
      .first();

    return {
      purchase_orders: await count('purchase_orders'),
      purchase_order_line_items: await count('purchase_order_line_items'),
      reorder_requests: await count('reorder_requests'),
      suppliers: await count('suppliers'),
      inventory_truth: await count('inventory_truth'),
      units_ordered: Number(inboundRow?.ordered ?? 0),
      units_received: Number(inboundRow?.received ?? 0),
      units_available: Number(availableRow?.available ?? 0),
    };
  });
}

function getSourcing(fixture: Fixture, variantId: string, orderId?: string) {
  const req = request(app)
    .get(`${SOURCING_PATH}/${variantId}`)
    .set('Authorization', `Bearer ${fixture.token}`);

  return orderId ? req.query({ orderId }) : req;
}

/** The five purchasing-truth numbers, isolated so drift is asserted once. */
function purchasingTruth(body: any) {
  return {
    available: body.available,
    open_demand: body.open_demand,
    committed_inbound: body.committed_inbound,
    short_now: body.short_now,
    still_to_source: body.still_to_source,
  };
}

const EXPECTED_TRUTH = {
  available: EXPECTED_AVAILABLE,
  open_demand: EXPECTED_OPEN_DEMAND,
  committed_inbound: EXPECTED_COMMITTED_INBOUND,
  short_now: EXPECTED_SHORT_NOW,
  still_to_source: EXPECTED_STILL_TO_SOURCE,
};

describe('SOURCING-UX-COGNITIVE-01 Slice 1A — targeted sourcing contract', () => {
  let fixture: Fixture;

  beforeAll(async () => {
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
    fixture = await createFixture();
  });

  it('SRC-L3-01: a same-tenant canonical variant target returns targeted sourcing data', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(response.body.variant_id).toBe(fixture.targetVariantId);
    expect(Array.isArray(response.body.recommendations)).toBe(true);
  });

  it('SRC-L3-02: exposes the identity of the REQUESTED canonical variant', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      image_url: TARGET_IMAGE_URL,
      product_title: fixture.productTitle,
      variant_title: fixture.targetVariantTitle,
      sku: fixture.targetSku,
    });
  });

  it('SRC-L3-03: a variant with no image returns image_url null rather than a fabricated fallback', async () => {
    const response = await getSourcing(fixture, fixture.bareVariantId);

    expect(response.status).toBe(200);
    expect(response.body.image_url).toBeNull();
    expect(response.body.variant_title).toBe('Bare Variant Without Image');
  });

  it('SRC-L3-04: exposes available, open_demand, committed_inbound, short_now and still_to_source', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    for (const field of [
      'available',
      'open_demand',
      'committed_inbound',
      'short_now',
      'still_to_source',
    ]) {
      expect(response.body).toHaveProperty(field);
      expect(typeof response.body[field]).toBe('number');
    }
  });

  it('SRC-L3-05: short_now is open_demand minus available, ignoring anything already bought', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(response.body.open_demand).toBe(EXPECTED_OPEN_DEMAND);
    expect(response.body.available).toBe(EXPECTED_AVAILABLE);
    expect(response.body.short_now).toBe(EXPECTED_SHORT_NOW);
    expect(response.body.short_now).toBe(
      Math.max(0, response.body.open_demand - response.body.available)
    );
  });

  it('SRC-L3-06: still_to_source subtracts committed inbound from the gap', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(response.body.still_to_source).toBe(EXPECTED_STILL_TO_SOURCE);
    expect(response.body.still_to_source).toBe(
      Math.max(
        0,
        response.body.open_demand -
          response.body.available -
          response.body.committed_inbound
      )
    );
    // The two numbers are DISTINCT: a merchant with stock inbound must not be
    // told to re-order what they have already paid for.
    expect(response.body.still_to_source).toBeLessThan(response.body.short_now);
  });

  it('SRC-L3-07: committed inbound counts ordered/confirmed/in_production/shipped/partially_received and excludes draft/received/cancelled', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);

    // Inclusion: the total equals the remainder of exactly the included lines.
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);

    // Exclusion: the excluded statuses carry 300 outstanding units against this
    // same variant. Counting any one of them is arithmetically impossible here.
    expect(EXPECTED_EXCLUDED_UNITS).toBeGreaterThan(0);
    expect(response.body.committed_inbound).toBeLessThan(EXPECTED_EXCLUDED_UNITS);
    for (const line of EXCLUDED_INBOUND_LINES) {
      expect(response.body.committed_inbound).toBeLessThan(remaining(line));
    }
  });

  it('SRC-L3-08: a partially received line contributes only its remainder', async () => {
    const partial = INCLUDED_INBOUND_LINES.find(
      (line) => line.status === 'partially_received'
    )!;

    expect(partial.ordered).toBe(5);
    expect(partial.received).toBe(3);

    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    // If the line contributed its ordered quantity instead of its remainder the
    // total would be EXPECTED_COMMITTED_INBOUND + 3.
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);
    expect(response.body.committed_inbound).not.toBe(
      EXPECTED_COMMITTED_INBOUND + partial.received
    );
  });

  it('SRC-L3-09: a pending reorder request is intent, not committed inbound', async () => {
    const pending = await withTenant(fixture.shopId, async (trx) => {
      const row = await trx('reorder_requests')
        .where({
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.targetVariantId,
          status: 'pending',
        })
        .sum({ qty: 'qty_requested' })
        .first();
      return Number(row?.qty ?? 0);
    });

    expect(pending).toBe(PENDING_REORDER_QTY);

    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);
    expect(response.body.committed_inbound).toBeLessThan(PENDING_REORDER_QTY);
  });

  it('SRC-L3-10: exposes canonical blocking orders with outstanding units', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.blocking_orders)).toBe(true);

    const byId = new Map<string, any>(
      response.body.blocking_orders.map((o: any) => [o.order_id, o])
    );

    expect(byId.get(fixture.blockingOrderOneId)).toMatchObject({
      order_id: fixture.blockingOrderOneId,
      external_order_id: fixture.blockingOrderOneExternalId,
      units: ORDER_ONE_UNITS,
    });
    expect(byId.get(fixture.blockingOrderTwoId)).toMatchObject({
      order_id: fixture.blockingOrderTwoId,
      external_order_id: fixture.blockingOrderTwoExternalId,
      units: ORDER_TWO_UNITS,
    });

    // A fully fulfilled order for the same variant blocks nothing.
    expect(byId.has(fixture.settledOrderId)).toBe(false);
  });

  it('SRC-L3-11: a valid blocking orderId is echoed as context and changes no derived number', async () => {
    const withoutContext = await getSourcing(fixture, fixture.targetVariantId);
    const withContext = await getSourcing(
      fixture,
      fixture.targetVariantId,
      fixture.blockingOrderOneId
    );

    expect(withoutContext.status).toBe(200);
    expect(withContext.status).toBe(200);

    expect(withContext.body.originating_order_id).toBe(fixture.blockingOrderOneId);
    expect(withoutContext.body.originating_order_id).toBeNull();

    // Context in, arithmetic unchanged.
    expect(purchasingTruth(withContext.body)).toEqual(EXPECTED_TRUTH);
    expect(purchasingTruth(withContext.body)).toEqual(
      purchasingTruth(withoutContext.body)
    );
  });

  it('SRC-L3-11B: an unrelated same-tenant orderId is not echoed and is not injected as a blocker', async () => {
    const baseline = await getSourcing(fixture, fixture.targetVariantId);
    const response = await getSourcing(
      fixture,
      fixture.targetVariantId,
      fixture.unrelatedOrderId
    );

    expect(response.status).toBe(200);
    expect(response.body.originating_order_id).toBeNull();

    const blockingIds = (response.body.blocking_orders ?? []).map(
      (o: any) => o.order_id
    );
    expect(blockingIds).not.toContain(fixture.unrelatedOrderId);

    expect(purchasingTruth(response.body)).toEqual(EXPECTED_TRUTH);
    expect(purchasingTruth(response.body)).toEqual(purchasingTruth(baseline.body));
  });

  it('SRC-L3-12: open_demand aggregates every open order for the variant, not just the originating one', async () => {
    const response = await getSourcing(
      fixture,
      fixture.targetVariantId,
      fixture.blockingOrderOneId
    );

    expect(response.status).toBe(200);
    expect(response.body.open_demand).toBe(EXPECTED_OPEN_DEMAND);
    expect(response.body.open_demand).not.toBe(ORDER_ONE_UNITS);
  });

  it('SRC-L3-15: an unknown target is 404, while a valid target with no suppliers stays 200', async () => {
    const unknown = await getSourcing(fixture, crypto.randomUUID());

    expect(unknown.status).toBe(404);

    const validNoSuppliers = await getSourcing(fixture, fixture.bareVariantId);

    expect(validNoSuppliers.status).toBe(200);
    expect(validNoSuppliers.body.recommendations).toEqual([]);
  });

  it('SRC-L3-16: reading targeted sourcing mutates no purchasing or inventory state', async () => {
    const before = await purchasingStateSnapshot(fixture.shopId);

    const response = await getSourcing(
      fixture,
      fixture.targetVariantId,
      fixture.blockingOrderOneId
    );
    expect(response.status).toBe(200);

    const after = await purchasingStateSnapshot(fixture.shopId);

    expect(after).toEqual(before);
  });
});

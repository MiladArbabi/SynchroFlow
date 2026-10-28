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

/**
 * SLICE 1B — PURCHASING WORKFLOW FACTS
 * ------------------------------------
 * `in_purchasing` is the quantity already represented by pending reorder intent
 * and/or draft PO work for this canonical variant. `unplanned` is what is left
 * after that. Both are WORKFLOW facts, not supply truth: neither may alter
 * committed_inbound, and neither may reduce still_to_source.
 *
 * On the primary target fixture the workflow intent is deliberately larger than
 * the need (50 queued + 100 draft against 1 still to source), which exercises
 * the clamp. The partially-planned variant exercises the positive case.
 */
const DRAFT_PO_QTY = EXCLUDED_INBOUND_LINES.find(l => l.status === 'draft')!.ordered; // 100
const EXPECTED_IN_PURCHASING = PENDING_REORDER_QTY + DRAFT_PO_QTY;                    // 150

const PARTIAL_OPEN_DEMAND = 10;
const PARTIAL_QUEUE_QTY = 3;
const EXPECTED_PARTIAL_UNPLANNED = Math.max(
  0,
  PARTIAL_OPEN_DEMAND - PARTIAL_QUEUE_QTY
); // 7

/** A large intent on a DIFFERENT variant, used as the scoping probe. */
const UNRELATED_QUEUE_QTY = 999;

/**
 * SRC-ACT-BE-05 cross-tenant probe. Deliberately larger than anything the
 * target tenant holds, so leakage could not be mistaken for a rounding slip.
 */
const FOREIGN_QUEUE_QTY = 7777;
const FOREIGN_DRAFT_QTY = 8888;

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
  /**
   * Slice 1B: a variant whose purchasing workflow only PARTLY covers the need.
   * demand 10, available 0, no committed inbound, 3 units of pending queue
   * intent → still_to_source 10, in_purchasing 3, unplanned 7.
   */
  partiallyPlannedVariantId: string;
  /** Same tenant, different variant, carrying its own unrelated queue intent. */
  unrelatedWorkflowVariantId: string;
  /** A SECOND tenant, carrying deliberately large workflow quantities. */
  foreignShopId: number;
  foreignVariantId: string;
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
  const partiallyPlannedVariantId = crypto.randomUUID();
  const unrelatedWorkflowVariantId = crypto.randomUUID();

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
      {
        lasyncro_variant_id: partiallyPlannedVariantId,
        lasyncro_product_id: productId,
        shop_id: shopId,
        sku: `SRC-PARTIAL-${unique}`,
        title: 'Partially Planned Variant',
        unit_cost: '5.00',
        status: 'active',
      },
      {
        lasyncro_variant_id: unrelatedWorkflowVariantId,
        lasyncro_product_id: productId,
        shop_id: shopId,
        sku: `SRC-WFOTHER-${unique}`,
        title: 'Unrelated Workflow Variant',
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

    // Slice 1B: open demand for the partially-planned variant. No inventory and
    // no committed inbound, so still_to_source is the full 10.
    await seedOrder(trx, crypto.randomUUID(), externalId('005'), {
      variantId: partiallyPlannedVariantId,
      quantity: PARTIAL_OPEN_DEMAND,
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

    // Slice 1B: partial workflow coverage for its own variant …
    await trx('reorder_requests').insert({
      shop_id: shopId,
      lasyncro_variant_id: partiallyPlannedVariantId,
      supplier_id: supplierId,
      qty_requested: PARTIAL_QUEUE_QTY,
      source: 'manual',
      status: 'pending',
    });

    // … and a large unrelated intent on a DIFFERENT variant, which must never
    // leak into another variant's purchasing-workflow numbers (SRC-ACT-BE-05
    // scoping, asserted through the ratified numeric facts).
    await trx('reorder_requests').insert({
      shop_id: shopId,
      lasyncro_variant_id: unrelatedWorkflowVariantId,
      supplier_id: supplierId,
      qty_requested: UNRELATED_QUEUE_QTY,
      source: 'manual',
      status: 'pending',
    });
  });

  /**
   * SRC-ACT-BE-05 — A SECOND TENANT.
   *
   * Built with the same canonical bootstrap as the primary tenant
   * (createTenantShop → setTenantContext → withTenant), so every row below is
   * written under its OWN tenant context. Nothing here bypasses RLS; the point
   * is precisely that the target tenant's response must never see it.
   */
  const foreignUnique = crypto.randomBytes(6).toString('hex');

  const foreignShopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `sourcing-foreign-${foreignUnique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const foreignProductId = crypto.randomUUID();
  const foreignVariantId = crypto.randomUUID();

  await withTenant(foreignShopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: foreignProductId,
      shop_id: foreignShopId,
      title: 'Foreign Tenant Product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: foreignVariantId,
      lasyncro_product_id: foreignProductId,
      shop_id: foreignShopId,
      sku: `SRC-FOREIGN-${foreignUnique}`,
      title: 'Foreign Tenant Variant',
      unit_cost: '5.00',
      status: 'active',
    });

    const [foreignSupplier] = await trx('suppliers')
      .insert({
        shop_id: foreignShopId,
        name: 'Foreign Tenant Supplier',
        active: true,
      })
      .returning('id');

    const foreignSupplierId = Number(foreignSupplier.id ?? foreignSupplier);

    await trx('reorder_requests').insert({
      shop_id: foreignShopId,
      lasyncro_variant_id: foreignVariantId,
      supplier_id: foreignSupplierId,
      qty_requested: FOREIGN_QUEUE_QTY,
      source: 'manual',
      status: 'pending',
    });

    const [foreignPo] = await trx('purchase_orders')
      .insert({
        shop_id: foreignShopId,
        supplier_id: foreignSupplierId,
        status: 'draft',
      })
      .returning('id');

    await trx('purchase_order_line_items').insert({
      po_id: foreignPo.id ?? foreignPo,
      shop_id: foreignShopId,
      lasyncro_variant_id: foreignVariantId,
      description: 'Foreign tenant draft line',
      quantity_ordered: FOREIGN_DRAFT_QTY,
      quantity_received: 0,
    });
  });

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'growth' }),
    supplierId,
    foreignShopId,
    foreignVariantId,
    productId,
    productTitle,
    targetVariantId,
    targetVariantTitle,
    targetSku,
    bareVariantId,
    partiallyPlannedVariantId,
    unrelatedWorkflowVariantId,
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

  // ──────────────────────────────────────────────────────────────────────
  // SLICE 1B — TARGETED RECOVERY ACTIONS
  //
  // The merchant can already see how many units remain unsecured. They cannot
  // see whether they have ALREADY started buying them. Queue intent and draft
  // PO work are purchasing-workflow facts: they must be visible so the page
  // can stop offering to start work that is already underway, and they must
  // never be mistaken for supply.
  // ──────────────────────────────────────────────────────────────────────

  it('SRC-ACT-BE-01: pending reorder quantity is purchasing intent, not supply', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);

    // The pending queue quantity is represented as workflow intent …
    expect(response.body.in_purchasing).toBeGreaterThanOrEqual(PENDING_REORDER_QTY);

    // … and changes nothing about supply truth.
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);
    expect(response.body.still_to_source).toBe(EXPECTED_STILL_TO_SOURCE);
  });

  it('SRC-ACT-BE-02: draft PO remaining quantity is purchasing intent, not supply', async () => {
    const draftLine = EXCLUDED_INBOUND_LINES.find(l => l.status === 'draft')!;

    expect(remaining(draftLine)).toBe(DRAFT_PO_QTY);

    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);

    // Draft work counts toward what is already being planned …
    expect(response.body.in_purchasing).toBe(EXPECTED_IN_PURCHASING);

    // … while a draft remains excluded from committed inbound (nothing is
    // actually coming), and cannot reduce the canonical unsecured gap.
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);
    expect(response.body.still_to_source).toBe(EXPECTED_STILL_TO_SOURCE);
  });

  it('SRC-ACT-BE-03: committed inbound is not double-classified as purchasing intent', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);

    // The five committed statuses keep contributing to committed_inbound …
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);

    // … and those same rows are NOT also counted as purchasing intent. If they
    // were, in_purchasing would carry the extra EXPECTED_COMMITTED_INBOUND.
    expect(response.body.in_purchasing).toBe(EXPECTED_IN_PURCHASING);
    expect(response.body.in_purchasing).not.toBe(
      EXPECTED_IN_PURCHASING + EXPECTED_COMMITTED_INBOUND
    );
  });

  it('SRC-ACT-BE-04A: unplanned is what remains after partial workflow coverage', async () => {
    const response = await getSourcing(fixture, fixture.partiallyPlannedVariantId);

    expect(response.status).toBe(200);
    expect(response.body.still_to_source).toBe(PARTIAL_OPEN_DEMAND);
    expect(response.body.in_purchasing).toBe(PARTIAL_QUEUE_QTY);
    expect(response.body.unplanned).toBe(EXPECTED_PARTIAL_UNPLANNED);
    expect(response.body.unplanned).toBe(
      Math.max(0, response.body.still_to_source - response.body.in_purchasing)
    );
  });

  it('SRC-ACT-BE-04B: unplanned clamps at zero when intent exceeds the gap', async () => {
    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);
    expect(response.body.in_purchasing).toBeGreaterThan(response.body.still_to_source);
    expect(response.body.unplanned).toBe(0);
    expect(response.body.unplanned).toBe(
      Math.max(0, response.body.still_to_source - response.body.in_purchasing)
    );
  });

  it('SRC-ACT-BE-05: workflow quantities are scoped to this tenant and this variant', async () => {
    // Prove the noise actually exists before asserting it stays out: a large
    // same-tenant intent on another variant, and a second tenant carrying
    // larger quantities still. A test that passes because the distracting rows
    // were never written proves nothing.
    const sameTenantOtherVariant = await withTenant(fixture.shopId, async (trx) => {
      const row = await trx('reorder_requests')
        .where({
          shop_id: fixture.shopId,
          lasyncro_variant_id: fixture.unrelatedWorkflowVariantId,
          status: 'pending',
        })
        .sum({ qty: 'qty_requested' })
        .first();
      return Number(row?.qty ?? 0);
    });

    const foreignTenant = await withTenant(fixture.foreignShopId, async (trx) => {
      const queueRow = await trx('reorder_requests')
        .where({
          shop_id: fixture.foreignShopId,
          lasyncro_variant_id: fixture.foreignVariantId,
          status: 'pending',
        })
        .sum({ qty: 'qty_requested' })
        .first();

      const draftRow = await trx('purchase_order_line_items as poli')
        .join('purchase_orders as po', 'po.id', 'poli.po_id')
        .where('po.shop_id', fixture.foreignShopId)
        .andWhere('poli.lasyncro_variant_id', fixture.foreignVariantId)
        .andWhere('po.status', 'draft')
        .sum({
          qty: trx.raw(
            'GREATEST(poli.quantity_ordered - poli.quantity_received, 0)'
          ),
        })
        .first();

      return {
        queue: Number(queueRow?.qty ?? 0),
        draft: Number(draftRow?.qty ?? 0),
      };
    });

    expect(sameTenantOtherVariant).toBe(UNRELATED_QUEUE_QTY);
    expect(foreignTenant.queue).toBe(FOREIGN_QUEUE_QTY);
    expect(foreignTenant.draft).toBe(FOREIGN_DRAFT_QTY);

    const response = await getSourcing(fixture, fixture.targetVariantId);

    expect(response.status).toBe(200);

    // Only this tenant's, this variant's quantities.
    expect(response.body.pending_queue_qty).toBe(PENDING_REORDER_QTY);
    expect(response.body.draft_po_qty).toBe(DRAFT_PO_QTY);
    expect(response.body.in_purchasing).toBe(
      response.body.pending_queue_qty + response.body.draft_po_qty
    );
    expect(response.body.unplanned).toBe(
      Math.max(0, response.body.still_to_source - response.body.in_purchasing)
    );

    // None of the surrounding noise leaked in. Each of these quantities alone
    // is larger than anything the target legitimately holds.
    for (const leaked of [
      UNRELATED_QUEUE_QTY,
      FOREIGN_QUEUE_QTY,
      FOREIGN_DRAFT_QTY,
    ]) {
      expect(response.body.pending_queue_qty).toBeLessThan(leaked);
      expect(response.body.draft_po_qty).toBeLessThan(leaked);
      expect(response.body.in_purchasing).toBeLessThan(leaked);
    }
  });
});

// STOCK-SUPPLY-01 F1/F2 — independent fixtures; existing domain cases unchanged.
async function stockSupplyTargetFixture() {
  const fixture = await createFixture();
  // New regressions exercise purchasing.sourcing (Growth), not commercial denial.
  // Only this newly created tenant is made eligible; the legacy helper is unchanged.
  await withTenant(fixture.shopId, (trx) => trx('shop_subscriptions')
    .where({ shop_id: fixture.shopId }).update({ tier: 'growth' }));
  return fixture;
}

describe('STOCK-SUPPLY-01 targeted purchasing evidence', () => {
  it('F1 counts root and pick bins, excludes quarantine/staging/inactive stock and isolates tenants', async () => {
    const f = await stockSupplyTargetFixture();
    const foreign = await stockSupplyTargetFixture();
    await withTenant(f.shopId, async (trx) => {
      const root = await trx('warehouse_locations').where({ shop_id: f.shopId, type: 'warehouse' }).first();
      await trx('warehouse_locations').insert([
        { shop_id: f.shopId, warehouse_id: root.warehouse_id, location_code: 'SS-Q', parent_location_code: root.location_code, type: 'bin', zone_type: 'quarantine', active: true },
        { shop_id: f.shopId, warehouse_id: root.warehouse_id, location_code: 'SS-R', parent_location_code: root.location_code, type: 'bin', zone_type: 'receive', active: true },
        { shop_id: f.shopId, warehouse_id: root.warehouse_id, location_code: 'SS-I', parent_location_code: root.location_code, type: 'bin', zone_type: 'pick', active: false },
      ]);
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      for (const [location, qty] of [[root.location_code, 3], ['SS-Q', 40], ['SS-R', 60], ['SS-I', 50]] as Array<[string, number]>) {
        await trx('inventory_truth').insert({ shop_id: f.shopId, lasyncro_variant_id: f.targetVariantId, location_code: location,
          on_hand_quantity: qty, available_quantity: qty, reserved_quantity: 0, committed_quantity: 0, last_evaluated_at: now });
      }
    });
    const before = await purchasingStateSnapshot(f.shopId);
    const response = await getSourcing(f, f.targetVariantId);
    expect(response.status).toBe(200);
    expect(response.body.available).toBe(5); // existing A-1=2 plus ROOT=3, never 155
    expect(response.body.open_demand).toBe(10); // legacy missing-status demand remains valid
    expect(response.body.short_now).toBe(5);
    expect(response.body.committed_inbound).toBe(EXPECTED_COMMITTED_INBOUND);
    expect((await getSourcing(f, foreign.targetVariantId)).status).toBe(404);
    expect(await purchasingStateSnapshot(f.shopId)).toEqual(before);
  });

  it('F2 excludes terminal orders, preserves partial and missing-status demand, and aligns context', async () => {
    const f = await stockSupplyTargetFixture();
    const missingId = crypto.randomUUID();
    await withTenant(f.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx('order_fulfillment_status').insert([
        { lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: f.blockingOrderOneId, status: 'cancelled', status_updated_at: now },
        { lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: f.blockingOrderTwoId, status: 'partially_fulfilled', status_updated_at: now },
        { lasyncro_fulfillment_id: crypto.randomUUID(), lasyncro_order_id: f.settledOrderId, status: 'fulfilled', status_updated_at: now, fulfilled_at: now },
      ]);
      await trx('order_revenue_units').where({ lasyncro_order_id: f.blockingOrderTwoId }).update({ fulfilled_quantity: 1 });
      // Terminal status must win even when its economic quantity projection is stale.
      await trx('order_revenue_units').where({ lasyncro_order_id: f.settledOrderId }).update({ fulfilled_quantity: 0 });
      await trx('orders').insert({ lasyncro_order_id: missingId, shop_id: f.shopId, aggregate_version: 1, payment_state: 'paid',
        currency: 'USD', total_price: '20.00', subtotal_price: '20.00', total_tax: '0.00', order_created_at: now, order_updated_at: now, created_at: now, updated_at: now });
      // D1=B: deliberately no order_fulfillment_status row for this order.
      await trx('order_revenue_units').insert({ lasyncro_revenue_unit_id: crypto.randomUUID(), lasyncro_order_id: missingId,
        lasyncro_product_id: f.productId, lasyncro_variant_id: f.targetVariantId, sku: null, title: 'D1 missing status',
        quantity: 2, fulfilled_quantity: 0, unit_price: '10.00', line_total: '20.00', estimated_unit_cost: '5.00' });
    });
    const before = await purchasingStateSnapshot(f.shopId);
    const response = await getSourcing(f, f.targetVariantId, f.blockingOrderOneId);
    expect(response.status).toBe(200);
    expect(response.body.open_demand).toBe(5); // partial remainder 3 + missing-status 2
    expect(response.body.short_now).toBe(3);
    expect(response.body.originating_order_id).toBeNull();
    expect(response.body.blocking_orders.map((o: any) => o.order_id).sort()).toEqual([f.blockingOrderTwoId, missingId].sort());
    expect(response.body.blocking_orders.find((o: any) => o.order_id === f.blockingOrderTwoId).units).toBe(3);
    expect((await getSourcing(f, f.targetVariantId, missingId)).body.originating_order_id).toBe(missingId);
    expect(await purchasingStateSnapshot(f.shopId)).toEqual(before);
  });
});

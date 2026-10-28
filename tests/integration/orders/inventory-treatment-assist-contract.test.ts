// INV-TREAT-01 — INVENTORY TREATMENT ASSIST CONTRACT (RED)
//
// Ratified backend contract for FRESH, READ-ONLY, VARIANT-SCOPED inventory
// treatment assistance exposed through the existing Order Detail read surface:
//
//   GET /api/v1/orders/:orderId
//
// These tests describe REQUIRED OBSERVABLE BEHAVIOUR. They are written against
// the ratified contract, not against any implementation, and are expected to be
// RED until INV-TREAT-01 is built.
//
//   INV-TREAT-01-01  canonical shortage evidence (order-specific demand vs
//                    canonical pickable availability)
//   INV-TREAT-01-02  committed inbound wins — and is not available stock
//   INV-TREAT-01-03  purchasing already in progress — queue/draft are workflow
//                    facts, never supply
//   INV-TREAT-01-04  source remaining — genuinely unplanned requirement
//   INV-TREAT-01-05  find supplier — no supplier is fabricated
//   INV-TREAT-01-06  stale/contradictory blocker — investigate, never self-heal
//   INV-TREAT-01-07  multi-variant isolation
//   INV-TREAT-01-08  eligibility — only ACTIVE inventory/oversell participates
//   INV-TREAT-01-09  tenant isolation
//   INV-TREAT-01-10  the read mutates nothing
//
// ARCHITECTURAL RULES PROTECTED HERE
//   - blocker evidence uses ORDER-SPECIFIC remaining demand;
//   - pickable availability is the CANONICAL predicate (active pick bins +
//     warehouse root; quarantine/receive/staging excluded) — this suite does
//     not restate that predicate, it materialises the real blocker through
//     evaluateInventoryConstraint + projectOrderConstraints;
//   - committed inbound is FUTURE supply, never current availability;
//   - pending reorder intent and draft PO work are WORKFLOW, never supply;
//   - open_sourcing is navigation only;
//   - existing supplier ranking stays authoritative — no supplier score is
//     computed or asserted here, only whether usable options exist.

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { evaluateCustomerConstraint } from 'api-src/services/constraints/evaluators/customerConstraintEvaluator';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const now = new Date('2026-09-07T12:00:00.000Z');

/** Canonical pickable location (active pick bin). */
const PICK_BIN = 'A-1';
/** Deliberately NON-pickable zones — real stock that is not sellable-from. */
const QUARANTINE_BIN = 'QUARANTINE-1';
const RECEIVE_BIN = 'RECEIVE-1';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

type Tenant = {
  shopId: number;
  userId: number;
  token: string;
  rootCode: string;
};

async function createTenant(label: string): Promise<Tenant> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `${label}+${unique}@test.example`,
        password_hash: 'not-a-real-hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');

    const id = Number(row.id ?? row);

    await trx('shop_memberships').insert({
      shop_id: shopId,
      user_id: id,
      role: 'owner',
    });

    return id;
  });

  const rootCode = `WH-${shopId}-ROOT`;
  const warehouseId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Inventory treatment warehouse',
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
        location_code: PICK_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'pick',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: QUARANTINE_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'quarantine',
      },
      {
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: RECEIVE_BIN,
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'receive',
      },
    ]);
  });

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'core' }),
    rootCode,
  };
}

type Catalogue = {
  productId: string;
  productTitle: string;
  variantId: string;
  variantTitle: string;
  sku: string;
  imageUrl: string | null;
};

async function seedCatalogue(
  shopId: number,
  opts: {
    productTitle: string;
    variantTitle: string;
    imageUrl?: string | null;
  }
): Promise<Catalogue> {
  const unique = crypto.randomBytes(4).toString('hex');
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const sku = `INV-TREAT-${unique}`;

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
      sku,
      title: opts.variantTitle,
      image_url: opts.imageUrl ?? null,
      unit_cost: '5.00',
      status: 'active',
    });
  });

  return {
    productId,
    productTitle: opts.productTitle,
    variantId,
    variantTitle: opts.variantTitle,
    sku,
    imageUrl: opts.imageUrl ?? null,
  };
}

type OrderLine = {
  productId: string;
  variantId: string;
  quantity: number;
  fulfilled?: number;
};

/**
 * Seeds a real PAID order with canonical demand rows. Shipping address is left
 * complete by default so no customer blocker is materialised by accident; the
 * eligibility case overrides it deliberately.
 */
async function seedOrder(
  shopId: number,
  lines: OrderLine[],
  opts: { completeAddress?: boolean; createFulfillmentStatus?: boolean } = {}
): Promise<string> {
  const orderId = crypto.randomUUID();
  const complete = opts.completeAddress ?? true;

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '100.00',
      subtotal_price: '100.00',
      total_tax: '0.00',
      shipping_name: 'Jane Doe',
      shipping_address1: complete ? '221B Baker Street' : null,
      shipping_city: complete ? 'London' : null,
      shipping_zip: complete ? 'NW1 6XE' : null,
      shipping_country_code: complete ? 'GB' : null,
      order_created_at: now,
      order_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id:
        String(Date.now()) +
        String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });

    for (const line of lines) {
      await trx('order_revenue_units').insert({
        lasyncro_revenue_unit_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: line.productId,
        lasyncro_variant_id: line.variantId,
        sku: null,
        title: 'Inventory treatment line',
        quantity: line.quantity,
        fulfilled_quantity: line.fulfilled ?? 0,
        unit_price: '100.00',
        line_total: (100 * line.quantity).toFixed(2),
        estimated_unit_cost: '5.00',
      });

      await trx('order_line_items').insert({
        lasyncro_line_item_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: line.productId,
        lasyncro_variant_id: line.variantId,
        sku: null,
        title: 'Inventory treatment line',
        quantity: line.quantity,
        unit_price: '100.00',
        line_total: (100 * line.quantity).toFixed(2),
        created_at: now,
        updated_at: now,
      });
    }

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    if (opts.createFulfillmentStatus ?? true) {
      await trx('order_fulfillment_status').insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        status: 'pending',
        status_updated_at: now,
        created_at: now,
        updated_at: now,
      });
    }
  });

  return orderId;
}

/** Location-level stock. Only PICK_BIN and the warehouse root are pickable. */
async function setStock(
  shopId: number,
  variantId: string,
  entries: { location: string; available: number }[]
) {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    for (const entry of entries) {
      const existing = await trx('inventory_truth')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          location_code: entry.location,
        })
        .first('lasyncro_variant_id');

      if (existing) {
        await trx('inventory_truth')
          .where({
            shop_id: shopId,
            lasyncro_variant_id: variantId,
            location_code: entry.location,
          })
          .update({
            on_hand_quantity: entry.available,
            available_quantity: entry.available,
            last_evaluated_at: now,
          });
      } else {
        await trx('inventory_truth').insert({
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          location_code: entry.location,
          on_hand_quantity: entry.available,
          reserved_quantity: 0,
          committed_quantity: 0,
          available_quantity: entry.available,
          last_evaluated_at: now,
        });
      }
    }
  });
}

/**
 * Materialises the REAL inventory constraint through the canonical chain
 * (evaluateInventoryConstraint -> projectOrderConstraints). The suite never
 * hand-writes an oversell row, so it cannot invent a second definition of
 * pickable stock.
 */
async function materialiseInventoryConstraint(shopId: number, orderId: string) {
  await withTenant(shopId, async (trx) => {
    const evaluations = await evaluateInventoryConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, now, evaluations);
  });
}

/** Same canonical chain for the customer blocker (eligibility probe). */
async function materialiseCustomerConstraint(shopId: number, orderId: string) {
  await withTenant(shopId, async (trx) => {
    const evaluation = await evaluateCustomerConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, now, [evaluation]);
  });
}

async function activeConstraints(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId })
      .orderBy('constraint_type', 'asc')
      .select('constraint_type', 'block_type', 'target_id', 'is_active')
  );
}

async function seedSupplier(shopId: number, name: string): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({ shop_id: shopId, name, active: true })
      .returning('id');

    return Number(row.id ?? row);
  });
}

async function seedPoLine(
  shopId: number,
  supplierId: number,
  variantId: string,
  line: { status: string; ordered: number; received?: number }
) {
  await withTenant(shopId, async (trx) => {
    const [po] = await trx('purchase_orders')
      .insert({ shop_id: shopId, supplier_id: supplierId, status: line.status })
      .returning('id');

    await trx('purchase_order_line_items').insert({
      po_id: po.id ?? po,
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      description: `Inbound line (${line.status})`,
      quantity_ordered: line.ordered,
      quantity_received: line.received ?? 0,
    });
  });
}

async function seedReorderRequest(
  shopId: number,
  supplierId: number,
  variantId: string,
  qty: number
) {
  await withTenant(shopId, (trx) =>
    trx('reorder_requests').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      supplier_id: supplierId,
      qty_requested: qty,
      source: 'manual',
      status: 'pending',
    })
  );
}

const getOrderDetail = (token: string, orderId: string) =>
  request(app)
    .get(`/api/v1/orders/${orderId}`)
    .set('Authorization', `Bearer ${token}`);

type Treatment = {
  type: string;
  rank: number;
  quantity: number | null;
  reason: string;
  automationLevel: string;
  action: { type: string; variantId: string; orderId: string } | null;
};

type AssistItem = {
  variantId: string;
  identity: {
    productTitle: string | null;
    variantTitle: string | null;
    sku: string | null;
    imageUrl: string | null;
  };
  blockerEvidence: {
    orderRemainingQty: number;
    pickableAvailableQty: number;
    shortageQty: number;
  };
  purchasingEvidence: {
    variantOpenDemandQty: number;
    committedInboundQty: number;
    pendingQueueQty: number;
    draftPoQty: number;
    supplierOptionCount: number;
  };
  treatments: Treatment[];
};

/** Asserts the assist envelope and returns it. */
function assistOf(res: request.Response) {
  expect(res.status).toBe(200);

  const assist = res.body.inventoryAssist;
  expect(assist).toBeTruthy();
  expect(typeof assist.generatedAt).toBe('string');
  expect(Number.isNaN(new Date(assist.generatedAt).getTime())).toBe(false);
  expect(Array.isArray(assist.items)).toBe(true);

  return assist as { generatedAt: string; items: AssistItem[] };
}

function itemFor(
  assist: { items: AssistItem[] },
  variantId: string
): AssistItem {
  const item = assist.items.find((i) => i.variantId === variantId);
  expect(item).toBeTruthy();
  return item as AssistItem;
}

/**
 * The treatments array is a RANKED list: index order is the presented order and
 * `rank` ascends with it. Both halves are asserted so a service that emits the
 * right set in the wrong order cannot pass.
 */
function topTreatment(item: AssistItem): Treatment {
  expect(Array.isArray(item.treatments)).toBe(true);
  expect(item.treatments.length).toBeGreaterThan(0);

  const ranks = item.treatments.map((t) => t.rank);
  expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  expect(new Set(ranks).size).toBe(ranks.length);

  return item.treatments[0];
}

/** Proves a variant contributes NO inventory assist at all. */
function expectNoAssistFor(res: request.Response, variantId: string) {
  expect(res.status).toBe(200);

  const assist = res.body.inventoryAssist;
  const items: AssistItem[] = assist == null ? [] : assist.items;

  expect(Array.isArray(items)).toBe(true);
  expect(items.some((i) => i.variantId === variantId)).toBe(false);
  expect(JSON.stringify(res.body)).not.toContain(variantId);
}

describe('INV-TREAT-01 — inventory treatment assist contract', () => {
  it('INV-TREAT-01-01: shortage evidence is order-specific demand against canonical pickable availability', async () => {
    const tenant = await createTenant('inv-treat-01');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Treatment Product',
      variantTitle: 'Treatment Variant',
      imageUrl: 'https://cdn.test.invalid/treatment.png',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 8, fulfilled: 2 },
    ]);

    // 2 pickable units, plus deliberately large NON-pickable stock. Quarantine
    // and receive zones hold real units that are not sellable-from: if either
    // leaked into availability the shortage below could not still be 4.
    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 2 },
      { location: tenant.rootCode, available: 0 },
      { location: QUARANTINE_BIN, available: 50 },
      { location: RECEIVE_BIN, available: 40 },
    ]);

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    expect(item.blockerEvidence).toEqual({
      orderRemainingQty: 6,
      pickableAvailableQty: 2,
      shortageQty: 4,
    });

    expect(item.identity).toEqual({
      productTitle: 'Treatment Product',
      variantTitle: 'Treatment Variant',
      sku: catalogue.sku,
      imageUrl: 'https://cdn.test.invalid/treatment.png',
    });
  });

  it('INV-TREAT-01-02: committed inbound is the top treatment, and is future supply rather than available stock', async () => {
    const tenant = await createTenant('inv-treat-02');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Inbound Product',
      variantTitle: 'Inbound Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 6 },
    ]);

    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 2 },
    ]);

    const supplierId = await seedSupplier(tenant.shopId, 'Inbound Supplier');
    // Exactly covers the 4-unit shortage — committed, not yet received.
    await seedPoLine(tenant.shopId, supplierId, catalogue.variantId, {
      status: 'ordered',
      ordered: 4,
    });

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    const stockBefore = await withTenant(tenant.shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: tenant.shopId, lasyncro_variant_id: catalogue.variantId })
        .sum({ available: 'available_quantity' })
        .first()
    );

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    const treatment = topTreatment(item);
    expect(treatment.type).toBe('wait_for_inbound');
    expect(item.purchasingEvidence.committedInboundQty).toBe(4);

    // Assisted navigation, not a dead end: the merchant is routed to the same
    // targeted Sourcing view, carrying the exact variant and originating order.
    expect(treatment.automationLevel).toBe('assist');
    expect(treatment.action).toEqual({
      type: 'open_sourcing',
      variantId: catalogue.variantId,
      orderId,
    });

    // Inbound is NOT stock: availability and the shortage are untouched by it.
    expect(item.blockerEvidence).toEqual({
      orderRemainingQty: 6,
      pickableAvailableQty: 2,
      shortageQty: 4,
    });

    // The blocker survives the advice.
    const constraints = await activeConstraints(tenant.shopId, orderId);
    expect(constraints).toEqual([
      expect.objectContaining({
        constraint_type: 'inventory',
        block_type: 'oversell',
        target_id: catalogue.variantId,
        is_active: true,
      }),
    ]);

    const stockAfter = await withTenant(tenant.shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: tenant.shopId, lasyncro_variant_id: catalogue.variantId })
        .sum({ available: 'available_quantity' })
        .first()
    );
    expect(Number(stockAfter?.available ?? 0)).toBe(Number(stockBefore?.available ?? 0));
  });

  it('INV-TREAT-01-03: pending queue and draft PO work are reported as workflow, never as supply', async () => {
    const tenant = await createTenant('inv-treat-03');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Queued Product',
      variantTitle: 'Queued Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 10 },
    ]);

    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 2 },
    ]);

    const supplierId = await seedSupplier(tenant.shopId, 'Queued Supplier');
    // Committed inbound covers only part of the 8-unit shortage.
    await seedPoLine(tenant.shopId, supplierId, catalogue.variantId, {
      status: 'ordered',
      ordered: 3,
    });
    // Draft PO work — real workflow, explicitly NOT committed inbound.
    await seedPoLine(tenant.shopId, supplierId, catalogue.variantId, {
      status: 'draft',
      ordered: 2,
    });
    // Pooled buying intent — no supplier commitment, no ETA.
    await seedReorderRequest(tenant.shopId, supplierId, catalogue.variantId, 4);

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    const treatment = topTreatment(item);
    expect(treatment.type).toBe('continue_purchasing');

    // Assisted navigation: the queued and draft work lives in Sourcing, so the
    // CTA routes there with the exact variant and originating order.
    expect(treatment.automationLevel).toBe('assist');
    expect(treatment.action).toEqual({
      type: 'open_sourcing',
      variantId: catalogue.variantId,
      orderId,
    });

    // Each fact is reported on its own axis — none may be folded into another.
    expect(item.purchasingEvidence.committedInboundQty).toBe(3);
    expect(item.purchasingEvidence.pendingQueueQty).toBe(4);
    expect(item.purchasingEvidence.draftPoQty).toBe(2);
    expect(item.purchasingEvidence.variantOpenDemandQty).toBe(10);

    // Workflow intent does not reduce blocker truth.
    expect(item.blockerEvidence).toEqual({
      orderRemainingQty: 10,
      pickableAvailableQty: 2,
      shortageQty: 8,
    });

    const constraints = await activeConstraints(tenant.shopId, orderId);
    expect(constraints).toEqual([
      expect.objectContaining({ block_type: 'oversell', is_active: true }),
    ]);
  });

  it('INV-TREAT-01-04: an unplanned shortage with usable supplier history offers source_remaining for exactly the unplanned quantity', async () => {
    const tenant = await createTenant('inv-treat-04');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Sourceable Product',
      variantTitle: 'Sourceable Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 5 },
    ]);

    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 0 },
    ]);

    // Real, usable supplier history for this variant — a fully received PO.
    // Received units are history, not committed inbound, so the whole 5 stays
    // genuinely unplanned.
    const supplierId = await seedSupplier(tenant.shopId, 'Historic Supplier');
    await seedPoLine(tenant.shopId, supplierId, catalogue.variantId, {
      status: 'received',
      ordered: 10,
      received: 10,
    });

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    expect(item.purchasingEvidence.committedInboundQty).toBe(0);
    expect(item.purchasingEvidence.pendingQueueQty).toBe(0);
    expect(item.purchasingEvidence.draftPoQty).toBe(0);
    expect(item.purchasingEvidence.supplierOptionCount).toBeGreaterThan(0);

    const treatment = topTreatment(item);
    expect(treatment.type).toBe('source_remaining');
    expect(treatment.quantity).toBe(5);
    expect(['inform', 'assist']).toContain(treatment.automationLevel);
    expect(typeof treatment.reason).toBe('string');
    expect(treatment.reason.length).toBeGreaterThan(0);

    // open_sourcing is navigation only, and carries the exact scope it came from.
    expect(treatment.action).toEqual({
      type: 'open_sourcing',
      variantId: catalogue.variantId,
      orderId,
    });
  });

  it('INV-TREAT-01-05: with zero usable supplier options the treatment is find_supplier and no supplier is fabricated', async () => {
    const tenant = await createTenant('inv-treat-05');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Unsupplied Product',
      variantTitle: 'Unsupplied Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 4 },
    ]);

    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 0 },
    ]);

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    // The premise: this tenant genuinely has no supplier of any kind.
    const supplierCount = await withTenant(tenant.shopId, (trx) =>
      trx('suppliers').where({ shop_id: tenant.shopId }).count({ n: '*' }).first()
    );
    expect(Number(supplierCount?.n ?? 0)).toBe(0);

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    expect(item.blockerEvidence.shortageQty).toBe(4);
    expect(item.purchasingEvidence.supplierOptionCount).toBe(0);

    const treatment = topTreatment(item);
    expect(treatment.type).toBe('find_supplier');
    expect(treatment.action).toEqual({
      type: 'open_sourcing',
      variantId: catalogue.variantId,
      orderId,
    });

    // No supplier is invented anywhere in the payload.
    expect(JSON.stringify(res.body)).not.toContain('supplierId');
    expect(JSON.stringify(res.body)).not.toContain('supplierName');
  });

  it('INV-TREAT-01-06: a stale blocker contradicted by fresh stock returns investigate_inventory without clearing or mutating anything', async () => {
    const tenant = await createTenant('inv-treat-06');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Stale Product',
      variantTitle: 'Stale Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 3 },
    ]);

    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 0 },
    ]);

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    // Fresh canonical stock now covers the demand — but NO reconciliation is
    // run, so the blocker is genuinely stale rather than resolved.
    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 10 },
    ]);

    const constraintsBefore = await activeConstraints(tenant.shopId, orderId);
    expect(constraintsBefore).toEqual([
      expect.objectContaining({
        constraint_type: 'inventory',
        block_type: 'oversell',
        is_active: true,
      }),
    ]);

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    // Fresh evidence, not the stale blocker's original numbers.
    expect(item.blockerEvidence.pickableAvailableQty).toBe(10);
    expect(item.blockerEvidence.orderRemainingQty).toBe(3);
    expect(item.blockerEvidence.shortageQty).toBeLessThanOrEqual(0);

    expect(topTreatment(item).type).toBe('investigate_inventory');

    // The GET neither resolves the constraint nor touches stock.
    expect(await activeConstraints(tenant.shopId, orderId)).toEqual(constraintsBefore);

    const stockAfter = await withTenant(tenant.shopId, (trx) =>
      trx('inventory_truth')
        .where({ shop_id: tenant.shopId, lasyncro_variant_id: catalogue.variantId })
        .orderBy('location_code', 'asc')
        .select('location_code', 'available_quantity', 'on_hand_quantity')
    );
    expect(stockAfter).toEqual([
      expect.objectContaining({
        location_code: PICK_BIN,
        available_quantity: 10,
        on_hand_quantity: 10,
      }),
    ]);
  });

  it('INV-TREAT-01-07: two blocked variants on one order keep independent evidence and independent ranking', async () => {
    const tenant = await createTenant('inv-treat-07');

    const inboundCovered = await seedCatalogue(tenant.shopId, {
      productTitle: 'Multi Product A',
      variantTitle: 'Inbound Covered Variant',
      imageUrl: 'https://cdn.test.invalid/multi-a.png',
    });
    const unsupplied = await seedCatalogue(tenant.shopId, {
      productTitle: 'Multi Product B',
      variantTitle: 'Unsupplied Variant',
      imageUrl: null,
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: inboundCovered.productId, variantId: inboundCovered.variantId, quantity: 6 },
      { productId: unsupplied.productId, variantId: unsupplied.variantId, quantity: 9 },
    ]);

    await setStock(tenant.shopId, inboundCovered.variantId, [
      { location: PICK_BIN, available: 2 },
    ]);
    await setStock(tenant.shopId, unsupplied.variantId, [
      { location: PICK_BIN, available: 1 },
    ]);

    const supplierId = await seedSupplier(tenant.shopId, 'Multi Supplier');
    // Inbound exists ONLY for the first variant.
    await seedPoLine(tenant.shopId, supplierId, inboundCovered.variantId, {
      status: 'ordered',
      ordered: 4,
    });

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    const res = await getOrderDetail(tenant.token, orderId);
    const assist = assistOf(res);

    expect(assist.items).toHaveLength(2);

    const first = itemFor(assist, inboundCovered.variantId);
    const second = itemFor(assist, unsupplied.variantId);

    // Evidence does not collapse onto an arbitrary first variant.
    expect(first.blockerEvidence).toEqual({
      orderRemainingQty: 6,
      pickableAvailableQty: 2,
      shortageQty: 4,
    });
    expect(second.blockerEvidence).toEqual({
      orderRemainingQty: 9,
      pickableAvailableQty: 1,
      shortageQty: 8,
    });

    expect(first.purchasingEvidence.committedInboundQty).toBe(4);
    expect(second.purchasingEvidence.committedInboundQty).toBe(0);
    expect(second.purchasingEvidence.supplierOptionCount).toBe(0);

    // Ranking is per-variant, not shared.
    expect(topTreatment(first).type).toBe('wait_for_inbound');
    expect(topTreatment(second).type).toBe('find_supplier');

    // Identity is per-variant, and a variant with no image gets no fallback.
    expect(first.identity.imageUrl).toBe('https://cdn.test.invalid/multi-a.png');
    expect(second.identity.imageUrl).toBeNull();
    expect(second.identity.variantTitle).toBe('Unsupplied Variant');
  });

  it('INV-TREAT-01-08: only an ACTIVE inventory/oversell constraint produces assist — resolved inventory and customer blockers do not', async () => {
    const tenant = await createTenant('inv-treat-08');

    const blocked = await seedCatalogue(tenant.shopId, {
      productTitle: 'Eligible Product',
      variantTitle: 'Still Blocked Variant',
    });
    const recovered = await seedCatalogue(tenant.shopId, {
      productTitle: 'Recovered Product',
      variantTitle: 'Recovered Variant',
    });

    // Incomplete address, so this order carries a REAL customer blocker too.
    const orderId = await seedOrder(
      tenant.shopId,
      [
        { productId: blocked.productId, variantId: blocked.variantId, quantity: 5 },
        { productId: recovered.productId, variantId: recovered.variantId, quantity: 5 },
      ],
      { completeAddress: false }
    );

    await setStock(tenant.shopId, blocked.variantId, [{ location: PICK_BIN, available: 0 }]);
    await setStock(tenant.shopId, recovered.variantId, [{ location: PICK_BIN, available: 0 }]);

    await materialiseInventoryConstraint(tenant.shopId, orderId);
    await materialiseCustomerConstraint(tenant.shopId, orderId);

    // The second variant genuinely recovers, through the canonical path.
    await setStock(tenant.shopId, recovered.variantId, [{ location: PICK_BIN, available: 20 }]);
    await materialiseInventoryConstraint(tenant.shopId, orderId);

    const constraints = await activeConstraints(tenant.shopId, orderId);
    expect(constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          constraint_type: 'inventory',
          target_id: blocked.variantId,
          is_active: true,
        }),
        expect.objectContaining({
          constraint_type: 'inventory',
          target_id: recovered.variantId,
          is_active: false,
        }),
        expect.objectContaining({
          constraint_type: 'customer',
          block_type: 'incomplete_address',
          is_active: true,
        }),
      ])
    );

    const res = await getOrderDetail(tenant.token, orderId);
    const assist = assistOf(res);

    // Exactly one participant: the still-active inventory/oversell variant.
    expect(assist.items).toHaveLength(1);
    expect(itemFor(assist, blocked.variantId).blockerEvidence.shortageQty).toBe(5);

    // The resolved inventory constraint contributes nothing, and the active
    // customer blocker contributes nothing.
    expectNoAssistFor(res, recovered.variantId);
  });

  it('INV-TREAT-01-09: another tenant’s inventory, inbound, purchasing and supplier data never influences this tenant', async () => {
    const tenant = await createTenant('inv-treat-09a');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Isolated Product',
      variantTitle: 'Isolated Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 4 },
    ]);
    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 0 },
    ]);
    await materialiseInventoryConstraint(tenant.shopId, orderId);

    // A SECOND tenant, built through the same canonical bootstrap, carrying
    // deliberately large quantities of every shape this contract reads.
    const foreign = await createTenant('inv-treat-09b');
    const foreignCatalogue = await seedCatalogue(foreign.shopId, {
      productTitle: 'Foreign Product',
      variantTitle: 'Foreign Variant',
    });
    await setStock(foreign.shopId, foreignCatalogue.variantId, [
      { location: PICK_BIN, available: 5000 },
      { location: foreign.rootCode, available: 5000 },
    ]);
    const foreignSupplierId = await seedSupplier(foreign.shopId, 'Foreign Supplier');
    await seedPoLine(foreign.shopId, foreignSupplierId, foreignCatalogue.variantId, {
      status: 'ordered',
      ordered: 7777,
    });
    await seedPoLine(foreign.shopId, foreignSupplierId, foreignCatalogue.variantId, {
      status: 'draft',
      ordered: 8888,
    });
    await seedReorderRequest(
      foreign.shopId,
      foreignSupplierId,
      foreignCatalogue.variantId,
      9999
    );

    const res = await getOrderDetail(tenant.token, orderId);
    const item = itemFor(assistOf(res), catalogue.variantId);

    expect(item.blockerEvidence).toEqual({
      orderRemainingQty: 4,
      pickableAvailableQty: 0,
      shortageQty: 4,
    });
    expect(item.purchasingEvidence).toEqual({
      variantOpenDemandQty: 4,
      committedInboundQty: 0,
      pendingQueueQty: 0,
      draftPoQty: 0,
      supplierOptionCount: 0,
    });

    // Ranking is unaffected: without the foreign supply this is still a
    // supplier-less unplanned shortage.
    expect(topTreatment(item).type).toBe('find_supplier');

    expect(JSON.stringify(res.body)).not.toContain('Foreign Supplier');
    expect(JSON.stringify(res.body)).not.toContain(foreignCatalogue.variantId);
  });

  it('INV-TREAT-01-10: generating the assist mutates no constraint, inventory, purchasing or decision state', async () => {
    const tenant = await createTenant('inv-treat-10');
    const catalogue = await seedCatalogue(tenant.shopId, {
      productTitle: 'Read Only Product',
      variantTitle: 'Read Only Variant',
    });

    const orderId = await seedOrder(tenant.shopId, [
      { productId: catalogue.productId, variantId: catalogue.variantId, quantity: 7 },
    ]);
    await setStock(tenant.shopId, catalogue.variantId, [
      { location: PICK_BIN, available: 1 },
    ]);

    const supplierId = await seedSupplier(tenant.shopId, 'Read Only Supplier');
    await seedPoLine(tenant.shopId, supplierId, catalogue.variantId, {
      status: 'ordered',
      ordered: 2,
    });
    await seedPoLine(tenant.shopId, supplierId, catalogue.variantId, {
      status: 'draft',
      ordered: 3,
    });
    await seedReorderRequest(tenant.shopId, supplierId, catalogue.variantId, 4);

    await materialiseInventoryConstraint(tenant.shopId, orderId);

    /**
     * Stable row counts plus the fixture-scoped values that actually carry
     * meaning — deliberately not a whole-table dump, which would be brittle
     * without proving anything extra.
     */
    const snapshot = async () =>
      withTenant(tenant.shopId, async (trx) => {
        const count = async (table: string) => {
          const row = await trx(table)
            .where({ shop_id: tenant.shopId })
            .count({ n: '*' })
            .first();
          return Number(row?.n ?? 0);
        };

        const constraints = await trx('order_constraints')
          .where({ lasyncro_order_id: orderId })
          .orderBy('constraint_type', 'asc')
          .select('constraint_type', 'block_type', 'target_id', 'is_active', 'resolved_at');

        const truth = await trx('inventory_truth')
          .where({ shop_id: tenant.shopId, lasyncro_variant_id: catalogue.variantId })
          .orderBy('location_code', 'asc')
          .select('location_code', 'on_hand_quantity', 'reserved_quantity', 'available_quantity');

        const inbound = await trx('purchase_order_line_items')
          .where({ shop_id: tenant.shopId, lasyncro_variant_id: catalogue.variantId })
          .sum({ ordered: 'quantity_ordered', received: 'quantity_received' })
          .first();

        const queued = await trx('reorder_requests')
          .where({ shop_id: tenant.shopId, lasyncro_variant_id: catalogue.variantId })
          .sum({ qty: 'qty_requested' })
          .first();

        return {
          order_constraints: JSON.stringify(constraints),
          inventory_truth: JSON.stringify(truth),
          inventory_movements: await count('inventory_movements'),
          reorder_requests: await count('reorder_requests'),
          purchase_orders: await count('purchase_orders'),
          purchase_order_line_items: await count('purchase_order_line_items'),
          decisions: await count('decisions'),
          units_ordered: Number(inbound?.ordered ?? 0),
          units_received: Number(inbound?.received ?? 0),
          units_queued: Number(queued?.qty ?? 0),
        };
      });

    const before = await snapshot();

    const res = await getOrderDetail(tenant.token, orderId);
    // The read whose read-only-ness is under test must genuinely have produced
    // the assist — otherwise this proves nothing.
    itemFor(assistOf(res), catalogue.variantId);

    const after = await snapshot();

    expect(after).toEqual(before);
  });
});

describe('STOCK-SUPPLY-01 assist purchasing evidence', () => {
  it('F1 preserves canonical root/bin capacity and excludes exception/inactive stock', async () => {
    const f = await createTenant('ss-assist-f1');
    const c = await seedCatalogue(f.shopId, { productTitle: 'Capacity parity', variantTitle: 'Capacity parity' });
    const orderId = await seedOrder(f.shopId, [{ productId: c.productId, variantId: c.variantId, quantity: 10 }]);
    await withTenant(f.shopId, async (trx) => {
      const root = await trx('warehouse_locations').where({ shop_id: f.shopId, location_code: f.rootCode }).first();
      await trx('warehouse_locations').insert({ shop_id: f.shopId, warehouse_id: root.warehouse_id,
        location_code: 'SS-I', parent_location_code: f.rootCode, type: 'bin', zone_type: 'pick', active: false });
    });
    await setStock(f.shopId, c.variantId, [{ location: f.rootCode, available: 3 }, { location: PICK_BIN, available: 2 },
      { location: QUARANTINE_BIN, available: 40 }, { location: RECEIVE_BIN, available: 60 }, { location: 'SS-I', available: 50 }]);
    await materialiseInventoryConstraint(f.shopId, orderId);
    const item = itemFor(assistOf(await getOrderDetail(f.token, orderId)), c.variantId);
    expect(item.blockerEvidence).toEqual({ orderRemainingQty: 10, pickableAvailableQty: 5, shortageQty: 5 });
  });

  it('F2 excludes terminal sibling demand while preserving partial and missing-status orders', async () => {
    const f = await createTenant('ss-assist-f2');
    const c = await seedCatalogue(f.shopId, { productTitle: 'Live demand', variantTitle: 'Live demand' });
    const subject = await seedOrder(f.shopId, [{ productId: c.productId, variantId: c.variantId, quantity: 7, fulfilled: 2 }]);
    const cancelled = await seedOrder(f.shopId, [{ productId: c.productId, variantId: c.variantId, quantity: 100 }]);
    const fulfilled = await seedOrder(f.shopId, [{ productId: c.productId, variantId: c.variantId, quantity: 80 }]);
    const missing = await seedOrder(f.shopId, [{ productId: c.productId, variantId: c.variantId, quantity: 3 }], { createFulfillmentStatus: false });
    await withTenant(f.shopId, async (trx) => {
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
      await trx('order_fulfillment_status').where({ lasyncro_order_id: subject }).update({ status: 'partially_fulfilled' });
      await trx('order_fulfillment_status').where({ lasyncro_order_id: cancelled }).update({ status: 'cancelled' });
      await trx('order_fulfillment_status').where({ lasyncro_order_id: fulfilled }).update({ status: 'fulfilled', fulfilled_at: now });
      // D1=B discriminator confined to this new fixture: genuinely absent status.
      expect(await trx('order_fulfillment_status').where({ lasyncro_order_id: missing }).first()).toBeUndefined();
    });
    await setStock(f.shopId, c.variantId, [{ location: PICK_BIN, available: 2 }]);
    await materialiseInventoryConstraint(f.shopId, subject);
    const item = itemFor(assistOf(await getOrderDetail(f.token, subject)), c.variantId);
    expect(item.blockerEvidence).toEqual({ orderRemainingQty: 5, pickableAvailableQty: 2, shortageQty: 3 });
    expect(item.purchasingEvidence.variantOpenDemandQty).toBe(8); // partial 5 + missing 3, never 188
    expect(item.treatments[0]).toMatchObject({ type: 'find_supplier', quantity: 6 });
  });
});

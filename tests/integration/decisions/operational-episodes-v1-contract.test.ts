/**
 * SLICE D0 — CANONICAL OPERATIONAL EPISODE READ SEAM V1 CONTRACT.
 *
 * GET /api/v1/operations/episodes composes two existing canonical truths
 * via readCurrentOperationalEpisodesV1() (operationalEpisodeRead.service.ts):
 *
 *   order_constraints                 = active canonical problem truth
 *   readCurrentWaitingV1Records()      = canonical "merchant already acted;
 *                                         verification pending" truth
 *                                         (interventionOutcome.service.ts)
 *
 * Lifecycle:
 *   active constraint matched by readCurrentWaitingV1Records() -> verifying
 *   active constraint with no such match                        -> attention
 *
 * V1 ONLY: customer/incomplete_address, inventory/oversell — via the single
 * pairing authority getWaitingV1TreatmentForConstraint().
 *
 * No UI/map wiring in this slice. Semantic truth only — no presentation
 * copy, no severity colors, no routes.
 *
 * HARNESS — duplicated inline from ops-console-waiting-v1-contract.test.ts
 * per that file's own established convention (no shared fixture builder
 * module introduced): provisionTenant / seedCatalogue / seedOrder /
 * setStock / materialiseInventoryConstraint / materialiseCustomerConstraint
 * / canonicalRevalidate / constraintsFor / activeInventoryConstraint /
 * activeCustomerConstraint / seedSupplier / patchAddress / postReorder.
 *
 * Constraints and interventions are materialised through the REAL evaluator
 * + projectOrderConstraints path (never hand-written into order_constraints
 * directly), and interventions are written through the REAL authenticated
 * routes (PATCH shipping-address, POST reorder-requests). D0-10's malformed
 * inventory/oversell-without-target fixture is the one narrow, explicitly-
 * labelled exception: it calls the REAL, unmodified projectOrderConstraints
 * engine (the same call shape materialiseInventoryConstraint below uses),
 * with a hand-constructed evaluation result in place of the real
 * evaluateInventoryConstraint() output — never a direct order_constraints
 * insert, which the projection-write-guard trigger forbids outside the
 * projection engine (see WAITING-09's own established precedent for why a
 * direct insert is out of scope).
 *
 * Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { evaluateCustomerConstraint } from 'api-src/services/constraints/evaluators/customerConstraintEvaluator';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';
import { revalidateOrdersForReceivedVariants } from 'api-src/services/wms/receiveJob.service';
import { createUndeliveredReturnJob } from 'api-src/services/returns/returnJobs.service';
import type { ConstraintEvaluationResult } from 'api-src/services/constraints/constraint.types';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const PICK_BIN = 'A-1';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const EPISODES_ENDPOINT = '/api/v1/operations/episodes';
const getEpisodes = (token: string) =>
  request(app).get(EPISODES_ENDPOINT).set('Authorization', `Bearer ${token}`);

const patchAddress = (token: string, orderId: string, body: Record<string, unknown>) =>
  request(app)
    .patch(`/api/v1/orders/${orderId}/shipping-address`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);

const postReorder = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/suppliers/reorder-requests')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── canonical fixtures (duplicated from ops-console-waiting-v1-contract.test.ts; see header) ──

async function provisionTenant(
  label: string
): Promise<{ shopId: number; userId: number; token: string }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `op-episodes-v1-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `op-episodes-v1+${unique}@test.example`,
        password_hash: 'not_a_real_hash',
        first_name: 'Owner',
        role: 'owner',
      })
      .returning('id');
    return Number(row.id ?? row);
  });

  const rootCode = `WH-${shopId}-ROOT`;
  const warehouseId = crypto.randomUUID();

  await withTenant(shopId, async (trx) => {
    await trx('shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner' });
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });
    await trx('shop_subscriptions').insert({
      shop_id: shopId,
      tier: 'growth',
      allow_overage: true,
      billing_provider: 'stripe',
      stripe_customer_id: null,
    });
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Op Episodes V1 warehouse',
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
    ]);
  });

  return { shopId, userId, token: issueTestToken({ userId, shopId, tier: 'growth' }) };
}

type Catalogue = { productId: string; variantId: string };

async function seedCatalogue(shopId: number): Promise<Catalogue> {
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const unique = crypto.randomBytes(4).toString('hex');

  await withTenant(shopId, async (trx) => {
    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Op Episodes V1 product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `OPEP-V1-${unique}`,
      title: 'Op Episodes V1 variant',
      unit_cost: '5.00',
      status: 'active',
    });
  });

  return { productId, variantId };
}

async function seedOrder(
  shopId: number,
  catalogue: Catalogue,
  quantity: number,
  opts: { completeAddress?: boolean } = {}
): Promise<{ orderId: string; externalOrderId: string }> {
  const orderId = crypto.randomUUID();
  const complete = opts.completeAddress ?? true;
  const stamp = new Date();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

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
      order_created_at: stamp,
      order_updated_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: catalogue.productId,
      lasyncro_variant_id: catalogue.variantId,
      sku: null,
      title: 'Op Episodes V1 line',
      quantity,
      fulfilled_quantity: 0,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });

    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: catalogue.productId,
      lasyncro_variant_id: catalogue.variantId,
      sku: null,
      title: 'Op Episodes V1 line',
      quantity,
      unit_price: '100.00',
      line_total: (100 * quantity).toFixed(2),
      created_at: stamp,
      updated_at: stamp,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    });
  });

  return { orderId, externalOrderId };
}

/**
 * Seeds an order with TWO revenue-unit lines against two DIFFERENT
 * variants so both can independently oversell on the SAME order (D0-04).
 */
async function seedOrderWithTwoVariants(
  shopId: number,
  catalogueA: Catalogue,
  catalogueB: Catalogue,
  quantityEach: number
): Promise<{ orderId: string }> {
  const orderId = crypto.randomUUID();
  const stamp = new Date();
  const externalOrderId =
    String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      aggregate_version: 1,
      payment_state: 'paid',
      currency: 'USD',
      total_price: '200.00',
      subtotal_price: '200.00',
      total_tax: '0.00',
      shipping_name: 'Jane Doe',
      shipping_address1: '221B Baker Street',
      shipping_city: 'London',
      shipping_zip: 'NW1 6XE',
      shipping_country_code: 'GB',
      order_created_at: stamp,
      order_updated_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    });

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id: externalOrderId,
    });

    for (const catalogue of [catalogueA, catalogueB]) {
      await trx('order_revenue_units').insert({
        lasyncro_revenue_unit_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: catalogue.productId,
        lasyncro_variant_id: catalogue.variantId,
        sku: null,
        title: 'Op Episodes V1 line',
        quantity: quantityEach,
        fulfilled_quantity: 0,
        unit_price: '100.00',
        line_total: (100 * quantityEach).toFixed(2),
        estimated_unit_cost: '5.00',
      });

      await trx('order_line_items').insert({
        lasyncro_line_item_id: crypto.randomUUID(),
        lasyncro_order_id: orderId,
        lasyncro_product_id: catalogue.productId,
        lasyncro_variant_id: catalogue.variantId,
        sku: null,
        title: 'Op Episodes V1 line',
        quantity: quantityEach,
        unit_price: '100.00',
        line_total: (100 * quantityEach).toFixed(2),
        created_at: stamp,
        updated_at: stamp,
      });
    }

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: stamp,
      created_at: stamp,
      updated_at: stamp,
    });
  });

  return { orderId };
}

async function setStock(shopId: number, variantId: string, location: string, available: number) {
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    const existing = await trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: location })
      .first('lasyncro_variant_id');

    if (existing) {
      await trx('inventory_truth')
        .where({ shop_id: shopId, lasyncro_variant_id: variantId, location_code: location })
        .update({
          on_hand_quantity: available,
          available_quantity: available,
          last_evaluated_at: new Date(),
        });
      return;
    }

    await trx('inventory_truth').insert({
      shop_id: shopId,
      lasyncro_variant_id: variantId,
      location_code: location,
      on_hand_quantity: available,
      reserved_quantity: 0,
      committed_quantity: 0,
      available_quantity: available,
      last_evaluated_at: new Date(),
    });
  });
}

async function materialiseInventoryConstraint(shopId: number, orderId: string, anchor: Date) {
  await withTenant(shopId, async (trx) => {
    const evaluations = await evaluateInventoryConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, anchor, evaluations);
  });
}

async function materialiseCustomerConstraint(shopId: number, orderId: string, anchor: Date) {
  await withTenant(shopId, async (trx) => {
    const evaluation = await evaluateCustomerConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, anchor, [evaluation]);
  });
}

/**
 * D0-10 — malformed inventory/oversell fixture. Calls the REAL, unmodified
 * projection engine (same call shape as materialiseInventoryConstraint
 * above) with a hand-constructed evaluation result in place of the real
 * evaluator's output, so the row is materialised active with target_id
 * NULL — a state the real evaluator can never organically produce (it
 * always sets targetId from order_revenue_units.lasyncro_variant_id), but
 * one the read seam must still fail closed against. Never a direct
 * order_constraints insert — see file header.
 */
async function materialiseMalformedInventoryConstraint(shopId: number, orderId: string, anchor: Date) {
  const evaluations: ConstraintEvaluationResult[] = [
    { type: 'inventory', isActive: true, targetId: undefined, meta: { blockType: 'oversell' } },
  ];
  await withTenant(shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, anchor, evaluations);
  });
}

async function canonicalRevalidate(shopId: number, variantId: string) {
  await withTenant(shopId, (trx) => revalidateOrdersForReceivedVariants(trx, shopId, [variantId]));
}

async function constraintsFor(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints')
      .where({ lasyncro_order_id: orderId })
      .select(
        'constraint_id',
        'constraint_type',
        'block_type',
        'target_id',
        'is_active',
        'started_at',
        'resolved_at'
      )
  );
}

async function activeInventoryConstraint(shopId: number, orderId: string, variantId: string) {
  const rows = await constraintsFor(shopId, orderId);
  const match = rows.filter(
    (c) =>
      c.is_active &&
      c.constraint_type === 'inventory' &&
      c.block_type === 'oversell' &&
      c.target_id === variantId
  );
  expect(match).toHaveLength(1);
  return match[0];
}

async function activeCustomerConstraint(shopId: number, orderId: string) {
  const rows = await constraintsFor(shopId, orderId);
  const match = rows.filter(
    (c) => c.is_active && c.constraint_type === 'customer' && c.block_type === 'incomplete_address'
  );
  expect(match).toHaveLength(1);
  return match[0];
}

async function seedSupplier(shopId: number, name: string): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers').insert({ shop_id: shopId, name, active: true }).returning('id');
    return Number(row.id ?? row);
  });
}

function episodeFor(body: { items?: any[] }, constraintId: string) {
  return (body.items ?? []).find((r: any) => r.constraintId === constraintId);
}

// ── D0-01 — address active, no intervention -> attention ───────────────────

describe('D0-01 — address active constraint with no intervention => attention (item 1)', () => {
  it('exposes exactly one customer/incomplete_address episode with lifecycle attention', async () => {
    const { shopId, token } = await provisionTenant('addr-attention');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const item = episodeFor(res.body, constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        episodeId: expect.any(String),
        constraintId: constraint.constraint_id,
        lasyncroOrderId: orderId,
        constraintType: 'customer',
        blockType: 'incomplete_address',
        targetId: null,
        lifecycle: 'attention',
        treatment: 'address_correction',
        interventionId: null,
        occurredAt: expect.any(String),
      })
    );
  }, 180_000);
});

// ── D0-02 — oversell active, no intervention -> attention ──────────────────

describe('D0-02 — inventory/oversell active constraint with no intervention => attention (item 2)', () => {
  it('exposes exactly one inventory/oversell episode with lifecycle attention and the exact variant target', async () => {
    const { shopId, token } = await provisionTenant('inv-attention');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const item = episodeFor(res.body, constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        episodeId: expect.any(String),
        constraintId: constraint.constraint_id,
        lasyncroOrderId: orderId,
        constraintType: 'inventory',
        blockType: 'oversell',
        targetId: catalogue.variantId,
        lifecycle: 'attention',
        treatment: 'inventory_reorder_intent',
        interventionId: null,
        occurredAt: expect.any(String),
      })
    );
  }, 180_000);
});

// ── D0-03 — address + oversell on the same order -> TWO episodes ───────────

describe('D0-03 — address + oversell active on the SAME order => two distinct episodes (item 3)', () => {
  it('never collapses the two constraint types into one episode', async () => {
    const { shopId, token } = await provisionTenant('addr-inv-same-order');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10, { completeAddress: false });
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const addressConstraint = await activeCustomerConstraint(shopId, orderId);
    const inventoryConstraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const items = (res.body.items ?? []).filter((r: any) => r.lasyncroOrderId === orderId);
    expect(items).toHaveLength(2);
    expect(items.map((r: any) => r.constraintId).sort()).toEqual(
      [addressConstraint.constraint_id, inventoryConstraint.constraint_id].sort()
    );
    expect(new Set(items.map((r: any) => r.episodeId)).size).toBe(2);
  }, 180_000);
});

// ── D0-04 — two oversell variant constraints on the same order -> TWO episodes

describe('D0-04 — two independently oversold variants on the SAME order => two distinct inventory episodes (item 4)', () => {
  it('exposes one episode per over-committed variant, never collapsed by order', async () => {
    const { shopId, token } = await provisionTenant('inv-two-variants');
    const catalogueA = await seedCatalogue(shopId);
    const catalogueB = await seedCatalogue(shopId);
    const { orderId } = await seedOrderWithTwoVariants(shopId, catalogueA, catalogueB, 10);
    await setStock(shopId, catalogueA.variantId, PICK_BIN, 0);
    await setStock(shopId, catalogueB.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraintA = await activeInventoryConstraint(shopId, orderId, catalogueA.variantId);
    const constraintB = await activeInventoryConstraint(shopId, orderId, catalogueB.variantId);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const items = (res.body.items ?? []).filter((r: any) => r.lasyncroOrderId === orderId);
    expect(items).toHaveLength(2);
    expect(items.map((r: any) => r.targetId).sort()).toEqual(
      [catalogueA.variantId, catalogueB.variantId].sort()
    );
    expect(items.map((r: any) => r.constraintId).sort()).toEqual(
      [constraintA.constraint_id, constraintB.constraint_id].sort()
    );
    expect(new Set(items.map((r: any) => r.episodeId)).size).toBe(2);
  }, 180_000);
});

// ── D0-05 — address intervention pending verification -> verifying ─────────

describe('D0-05 — address_correction intervention pending verification => address episode is verifying (item 5)', () => {
  it('sets lifecycle=verifying, occurredAt=intervention occurredAt, interventionId populated', async () => {
    const { shopId, token } = await provisionTenant('addr-verifying');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    const intervention = await withTenant(shopId, (trx) =>
      trx('decision_interventions')
        .where({ shop_id: shopId, entity_id: orderId, constraint_id: constraint.constraint_id })
        .first()
    );
    expect(intervention).toBeTruthy();

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const item = episodeFor(res.body, constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        constraintId: constraint.constraint_id,
        lifecycle: 'verifying',
        interventionId: intervention.id,
      })
    );
    expect(new Date(item.occurredAt).getTime()).toBe(new Date(intervention.occurred_at).getTime());
  }, 180_000);
});

// ── D0-06 — stockout intervention pending verification -> verifying ────────

describe('D0-06 — inventory_reorder_intent intervention pending verification => inventory episode is verifying (item 6)', () => {
  it('sets lifecycle=verifying, occurredAt=intervention occurredAt, interventionId populated', async () => {
    const { shopId, token } = await provisionTenant('inv-verifying');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Op Episodes V1 Mills Ltd');
    const { orderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const reorder = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(reorder.status).toBe(201);

    const intervention = await withTenant(shopId, (trx) =>
      trx('decision_interventions')
        .where({ shop_id: shopId, entity_id: orderId, constraint_id: constraint.constraint_id })
        .first()
    );
    expect(intervention).toBeTruthy();

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const item = episodeFor(res.body, constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        constraintId: constraint.constraint_id,
        lifecycle: 'verifying',
        interventionId: intervention.id,
      })
    );
    expect(new Date(item.occurredAt).getTime()).toBe(new Date(intervention.occurred_at).getTime());
  }, 180_000);
});

// ── D0-07 — verifying address + untouched stockout sibling ─────────────────

describe('D0-07 — verifying address episode + untouched stockout sibling on the same order (item 7)', () => {
  it('address is verifying, stockout remains attention', async () => {
    const { shopId, token } = await provisionTenant('addr-verifying-inv-attn');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10, { completeAddress: false });
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const addressConstraint = await activeCustomerConstraint(shopId, orderId);
    const inventoryConstraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const addressItem = episodeFor(res.body, addressConstraint.constraint_id);
    const inventoryItem = episodeFor(res.body, inventoryConstraint.constraint_id);

    expect(addressItem).toEqual(expect.objectContaining({ lifecycle: 'verifying' }));
    expect(inventoryItem).toEqual(
      expect.objectContaining({ lifecycle: 'attention', interventionId: null })
    );
  }, 180_000);
});

// ── D0-08 — resolved constraint is absent ───────────────────────────────────

describe('D0-08 — a canonically resolved constraint is absent from the episode read (item 8)', () => {
  it('address_correction: the episode disappears once the constraint canonically resolves', async () => {
    const { shopId, token } = await provisionTenant('addr-resolved-absent');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    await materialiseCustomerConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    expect(episodeFor(res.body, constraint.constraint_id)).toBeUndefined();
  }, 180_000);
});

// ── D0-09 — malformed/non-V1 constraint absent ──────────────────────────────

describe('D0-09 — an active operational constraint is never exposed by the V1 episode read (item 9)', () => {
  it('is absent even though it is a real, active, canonical constraint', async () => {
    const { shopId, userId, token } = await provisionTenant('op-non-v1-absent');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1);

    await createUndeliveredReturnJob({
      shopId,
      lasyncroOrderId: orderId,
      undeliveredReason: 'carrier_error',
      operatorId: userId,
    });

    const operationalConstraint = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'operational',
          block_type: 'returned_undelivered',
          is_active: true,
        })
        .first('constraint_id')
    );
    expect(operationalConstraint?.constraint_id).toBeTruthy();

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    expect(episodeFor(res.body, operationalConstraint.constraint_id)).toBeUndefined();
  }, 180_000);
});

// ── D0-10 — malformed inventory/oversell with no target fails closed ───────

describe('D0-10 — inventory/oversell active constraint with NO target_id fails closed (item 10)', () => {
  it('is excluded entirely rather than exposed with a null/invented targetId', async () => {
    const { shopId, token } = await provisionTenant('inv-no-target');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10);

    await materialiseMalformedInventoryConstraint(shopId, orderId, new Date());

    const malformed = (await constraintsFor(shopId, orderId)).find(
      (c) => c.is_active && c.constraint_type === 'inventory' && c.target_id === null
    );
    expect(malformed).toBeTruthy();

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    expect(episodeFor(res.body, malformed!.constraint_id)).toBeUndefined();
  }, 180_000);
});

// ── D0-11 — re-raised episode not incorrectly marked verifying ─────────────

describe('D0-11 — a re-raised inventory episode is NOT marked verifying from a stale intervention (item 11)', () => {
  it('the fresh active episode reads as attention, not verifying, despite an old intervention against the reused constraint_id', async () => {
    const { shopId, token } = await provisionTenant('inv-reraise-attention');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Op Episodes V1 Mills Ltd');
    const { orderId } = await seedOrder(shopId, catalogue, 10);

    // Episode A: intervened, then genuinely resolved.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const episodeA = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const reorder = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(reorder.status).toBe(201);

    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);
    const resolvedA = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === episodeA.constraint_id
    )!;
    expect(resolvedA.is_active).toBe(false);

    // Episode B: SAME deterministic constraint_id re-raised, left active,
    // with NO new intervention against it.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const episodeB = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    expect(episodeB.constraint_id).toBe(episodeA.constraint_id);

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const item = episodeFor(res.body, episodeB.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({ lifecycle: 'attention', interventionId: null })
    );
  }, 180_000);
});

// ── D0-12 — episodeId changes when the same constraint is re-raised ────────

describe('D0-12 — episodeId changes when the SAME deterministic constraint_id is re-raised with a new started_at (item 12)', () => {
  it('episode A and episode B share constraint_id but carry different episodeId values', async () => {
    const { shopId, token } = await provisionTenant('inv-reraise-episode-id');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10);

    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const episodeA = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const resAfterA = await getEpisodes(token);
    const itemA = episodeFor(resAfterA.body, episodeA.constraint_id);
    expect(itemA).toBeTruthy();

    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);

    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const episodeB = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    expect(episodeB.constraint_id).toBe(episodeA.constraint_id);
    expect(new Date(episodeB.started_at as unknown as string).getTime()).not.toBe(
      new Date(episodeA.started_at as unknown as string).getTime()
    );

    const resAfterB = await getEpisodes(token);
    const itemB = episodeFor(resAfterB.body, episodeB.constraint_id);
    expect(itemB).toBeTruthy();

    expect(itemB.episodeId).not.toBe(itemA.episodeId);
  }, 180_000);
});

// ── D0-13 — tenant isolation ─────────────────────────────────────────────────

describe('D0-13 — cross-shop / tenant isolation (item 13)', () => {
  it('shop B never sees shop A active constraints through the shop-wide episode read', async () => {
    const shopA = await provisionTenant('tenant-a');
    const shopB = await provisionTenant('tenant-b');

    const catalogue = await seedCatalogue(shopA.shopId);
    const { orderId } = await seedOrder(shopA.shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopA.shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopA.shopId, orderId);

    const resA = await getEpisodes(shopA.token);
    expect(resA.status).toBe(200);
    expect(episodeFor(resA.body, constraint.constraint_id)).toBeTruthy();

    const resB = await getEpisodes(shopB.token);
    expect(resB.status).toBe(200);
    expect(episodeFor(resB.body, constraint.constraint_id)).toBeUndefined();
    expect(resB.body.items ?? []).toEqual([]);
  }, 180_000);
});

// ── D0-14 — endpoint returns no duplicate episode rows ──────────────────────

describe('D0-14 — the endpoint returns no duplicate episode rows (item 14)', () => {
  it('every episodeId in the response is unique, including across a multi-episode order', async () => {
    const { shopId, token } = await provisionTenant('no-duplicates');
    const catalogueA = await seedCatalogue(shopId);
    const catalogueB = await seedCatalogue(shopId);
    const { orderId } = await seedOrderWithTwoVariants(shopId, catalogueA, catalogueB, 10);
    await setStock(shopId, catalogueA.variantId, PICK_BIN, 0);
    await setStock(shopId, catalogueB.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());

    const res = await getEpisodes(token);
    expect(res.status).toBe(200);
    const items = res.body.items ?? [];
    const episodeIds = items.map((r: any) => r.episodeId);
    expect(episodeIds.length).toBeGreaterThanOrEqual(2);
    expect(new Set(episodeIds).size).toBe(episodeIds.length);

    const constraintIds = items.map((r: any) => r.constraintId);
    expect(new Set(constraintIds).size).toBe(constraintIds.length);
  }, 180_000);
});

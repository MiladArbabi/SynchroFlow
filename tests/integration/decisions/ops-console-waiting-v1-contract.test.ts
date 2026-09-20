/**
 * OPS-CONSOLE-WAITING-01 — WAITING V1 RED REGRESSION CONTRACT.
 *
 * RATIFIED CONTRACT (see OPS CONSOLE WAITING V1 audits, 2026-09-18):
 *   WAITING means a merchant/operator intervention has already happened and
 *   canonical domain truth (order_constraints, via the frozen
 *   interventionOutcome.service.ts episode semantics) says the result is
 *   still pending verification.
 *
 *   V1 treatment types: address_correction, inventory_reorder_intent.
 *   Outcome policy:
 *     pending_verification => WAITING
 *     verified_resolved     => leaves WAITING (HISTORY is a later slice)
 *     unknown                => NOT WAITING and MUST NOT suppress NOW
 *
 *   NOW/WAITING invariant, per exact constraint episode:
 *     no matching pending_verification intervention -> constraint contributes to NOW
 *     matching pending_verification intervention     -> excluded from NOW, appears in WAITING
 *     unknown                                          -> remains eligible for NOW, absent from WAITING
 *   An entire shop-level customer/inventory NOW aggregate must never be
 *   suppressed just because ONE underlying episode moved to WAITING — other
 *   unresolved entities of the same constraint_type must still count.
 *
 * THIS FILE IS TEST WORK ONLY. No production source is added by this
 * change. Every contract below is expected to fail (RED) because:
 *   (a) no dedicated shop-wide WAITING read/API exists yet, and
 *   (b) the NOW aggregate (aggregateConstraintAlerts in
 *       alerts.aggregator.ts) does not yet anti-join decision_interventions.
 *
 * ENDPOINT — RATIFIED (correction pass, 2026-09-18).
 *   GET /api/v1/operations/waiting -> { items: WaitingItem[] }
 *   Response ONLY ever contains outcome='pending_verification' items —
 *   verified_resolved/unknown episodes must never appear (proved by
 *   WAITING-07/08/10/13 asserting absence).
 *
 * COPY IS NOT RATIFIED. Only routing.route is locked exactly
 * (/overview?resolution=address, /orders/flow?constraint=inventory).
 * presentation.title/subtitle/actionLabel are asserted structurally
 * (backend-supplied, non-empty strings) — never pinned to exact text.
 *
 * WAITING-09 — MOVED. The original hand-written order_constraints fixture
 * (is_active=true WITH resolved_at set) is rejected by a real DB trigger
 * (`[PROJECTION_WRITE_VIOLATION] table=order_constraints must be written
 * only by projection.engine`) and cannot be constructed without bypassing a
 * production safety invariant, which is out of scope for this pass. That
 * contract is now proved at the unit level, against the real (unmodified)
 * interventionOutcome.service.ts derivation, in
 * tests/unit/backend/decisions/ops-console-waiting-v1-incoherent-outcome.test.ts.
 *
 * HARNESS — reused verbatim from the two existing OUTCOME-* canonical
 * suites (no new fixture builder module is introduced; helpers below are
 * duplicated inline per those files' own convention of file-local fixture
 * functions):
 *   - tests/integration/orders/inventory-outcome-attribution.test.ts
 *     (provisionTenant / seedCatalogue / seedOrder / setStock /
 *      materialiseInventoryConstraint / materialiseCustomerConstraint /
 *      canonicalRevalidate / constraintsFor / postReorder)
 *   - tests/integration/orders/address-outcome-attribution.test.ts
 *     (the real PATCH /shipping-address route, and the OUTCOME-ADDR-07
 *      hand-written sentinel-intervention-row precedent, reused below for
 *      the negative-latency diagnostic probe only)
 *
 * Constraints and interventions are materialised through the REAL evaluator
 * + projectOrderConstraints path (never hand-written), and interventions
 * are written through the REAL authenticated routes (PATCH shipping-address,
 * POST reorder-requests) — with exactly one narrow, explicitly-labelled
 * exception: the negative-latency diagnostic probe (WAITING-10), which
 * reproduces a state the real lifecycle cannot organically produce,
 * mirroring OUTCOME-ADDR-07's own established sentinel-row precedent.
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
import { aggregateAlertsForShop } from 'api-src/services/alerts/alerts.aggregator';
import { createUndeliveredReturnJob } from 'api-src/services/returns/returnJobs.service';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const PICK_BIN = 'A-1';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

const WAITING_ENDPOINT = '/api/v1/operations/waiting';
const getWaiting = (token: string) =>
  request(app).get(WAITING_ENDPOINT).set('Authorization', `Bearer ${token}`);

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

/**
 * Structural-only copy check: backend-supplied and non-empty, never pinned
 * to exact wording — copy is explicitly NOT ratified by the WAITING V1
 * contract correction. `expect.any(String)` alone would also accept ''.
 */
const NON_EMPTY_STRING = expect.stringMatching(/\S/);

/** Extracts the leading integer from an aggregator-produced alert title, e.g. "2 orders with address issues" -> 2. */
function countFromTitle(title: string | undefined | null): number {
  const match = /^(\d+)/.exec(title ?? '');
  return match ? Number(match[1]) : 0;
}

// ── canonical fixtures (duplicated from the OUTCOME-* suites; see header) ──

async function provisionTenant(
  label: string
): Promise<{ shopId: number; userId: number; token: string }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `waiting-v1-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `waiting-v1+${unique}@test.example`,
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
      name: 'Waiting V1 warehouse',
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
      title: 'Waiting V1 product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `WAIT-V1-${unique}`,
      title: 'Waiting V1 variant',
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
      title: 'Waiting V1 line',
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
      title: 'Waiting V1 line',
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

async function customerAlertRow(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('alerts').where({ shop_id: shopId, alert_key: `constraint:shop-${shopId}:customer` }).first()
  );
}

async function inventoryAlertRow(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('alerts').where({ shop_id: shopId, alert_key: `constraint:shop-${shopId}:inventory` }).first()
  );
}

async function operationalAlertRow(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('alerts').where({ shop_id: shopId, alert_key: `constraint:shop-${shopId}:operational` }).first()
  );
}

// ── WAITING-01 / 14 / 15 — address_correction pending_verification item ────

describe('WAITING-01 — address_correction: active episode + real intervention => pending_verification WAITING item (items 1, 14, 15)', () => {
  it('appears in the shop-wide WAITING read with a backend-presentation-ready shape and the locked /overview?resolution=address route', async () => {
    const { shopId, token } = await provisionTenant('addr-one');
    const catalogue = await seedCatalogue(shopId);
    const { orderId, externalOrderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street',
      city: 'London',
      zip: 'NW1 6XE',
      countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(patch.status).toBe(200);

    // Canonical resolution has not been projected yet — still active.
    const stillActive = await activeCustomerConstraint(shopId, orderId);
    expect(stillActive.constraint_id).toBe(constraint.constraint_id);

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        interventionId: expect.any(String),
        treatment: 'address_correction',
        lasyncroOrderId: orderId,
        externalOrderId,
        constraintId: constraint.constraint_id,
        constraintType: 'customer',
        blockType: 'incomplete_address',
        occurredAt: expect.any(String),
        outcome: 'pending_verification',
        // Copy is NOT ratified — structural presence/non-emptiness only.
        presentation: expect.objectContaining({
          title: NON_EMPTY_STRING,
          subtitle: NON_EMPTY_STRING,
          actionLabel: NON_EMPTY_STRING,
        }),
        // routing.route IS ratified — asserted exactly.
        routing: expect.objectContaining({ route: '/overview?resolution=address' }),
      })
    );
  }, 180_000);
});

// ── WAITING-02 / 14 / 16 — inventory_reorder_intent pending_verification ───

describe('WAITING-02 — inventory_reorder_intent: active episode + real intervention => pending_verification WAITING item (items 2, 14, 16)', () => {
  it('appears in the shop-wide WAITING read with the locked /orders/flow?constraint=inventory route', async () => {
    const { shopId, token } = await provisionTenant('inv-one');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Waiting V1 Mills Ltd');
    const { orderId, externalOrderId } = await seedOrder(shopId, catalogue, 10);
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

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toEqual(
      expect.objectContaining({
        interventionId: expect.any(String),
        treatment: 'inventory_reorder_intent',
        lasyncroOrderId: orderId,
        externalOrderId,
        constraintId: constraint.constraint_id,
        constraintType: 'inventory',
        blockType: 'oversell',
        occurredAt: expect.any(String),
        outcome: 'pending_verification',
        presentation: expect.objectContaining({
          title: NON_EMPTY_STRING,
          subtitle: NON_EMPTY_STRING,
          actionLabel: NON_EMPTY_STRING,
        }),
        routing: expect.objectContaining({ route: '/orders/flow?constraint=inventory' }),
      })
    );
  }, 180_000);
});

// ── WAITING-03 / 04 — pending episode excluded from its NOW aggregate ──────

describe('WAITING-03 — a pending_verification customer episode is excluded from the customer NOW aggregate (item 3)', () => {
  it('deactivates the shop customer alert once the only active customer constraint has a matching intervention', async () => {
    const { shopId, token } = await provisionTenant('addr-excl');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    await aggregateAlertsForShop(shopId);
    const customerAlert = await customerAlertRow(shopId);
    expect(customerAlert?.is_active ?? false).toBe(false);
  }, 180_000);
});

describe('WAITING-04 — a pending_verification inventory episode is excluded from the inventory NOW aggregate (item 4)', () => {
  it('deactivates the shop inventory alert once the only active inventory constraint has a matching intervention', async () => {
    const { shopId, token } = await provisionTenant('inv-excl');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Waiting V1 Mills Ltd');
    const { orderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());

    const reorder = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(reorder.status).toBe(201);

    await aggregateAlertsForShop(shopId);
    const inventoryAlert = await inventoryAlertRow(shopId);
    expect(inventoryAlert?.is_active ?? false).toBe(false);
  }, 180_000);
});

// ── WAITING-05 / 06 — partial exclusion preserves other unresolved entities ─

describe('WAITING-05 — two active customer episodes, intervention on only one: WAITING has exactly the intervened one; NOW customer count stays 1 (items 5, 12)', () => {
  it('does not suppress the whole customer NOW aggregate for the still-unresolved order', async () => {
    const { shopId, token } = await provisionTenant('addr-partial');
    const catalogue = await seedCatalogue(shopId);
    const { orderId: orderA } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    const { orderId: orderB } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderA, new Date());
    await materialiseCustomerConstraint(shopId, orderB, new Date());
    const constraintA = await activeCustomerConstraint(shopId, orderA);
    const constraintB = await activeCustomerConstraint(shopId, orderB);

    // Intervene on order A only.
    const patch = await patchAddress(token, orderA, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const items = res.body.items ?? [];
    expect(items.map((r: any) => r.constraintId)).toEqual([constraintA.constraint_id]);
    // Cross-order isolation (item 12): order B's episode never leaks into WAITING.
    expect(items.map((r: any) => r.constraintId)).not.toContain(constraintB.constraint_id);

    await aggregateAlertsForShop(shopId);
    const customerAlert = await customerAlertRow(shopId);
    expect(customerAlert?.is_active).toBe(true);
    expect(countFromTitle(customerAlert?.title)).toBe(1);
  }, 180_000);
});

describe('WAITING-06 — two active inventory episodes, intervention on only one: WAITING has exactly the intervened one; NOW inventory count stays 1 (items 6, 12)', () => {
  it('does not suppress the whole inventory NOW aggregate for the still-unresolved order', async () => {
    const { shopId, token } = await provisionTenant('inv-partial');
    const catalogueA = await seedCatalogue(shopId);
    const catalogueB = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Waiting V1 Mills Ltd');
    const { orderId: orderA } = await seedOrder(shopId, catalogueA, 10);
    const { orderId: orderB } = await seedOrder(shopId, catalogueB, 10);
    await setStock(shopId, catalogueA.variantId, PICK_BIN, 0);
    await setStock(shopId, catalogueB.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderA, new Date());
    await materialiseInventoryConstraint(shopId, orderB, new Date());
    const constraintA = await activeInventoryConstraint(shopId, orderA, catalogueA.variantId);
    const constraintB = await activeInventoryConstraint(shopId, orderB, catalogueB.variantId);

    const reorder = await postReorder(token, {
      lasyncro_variant_id: catalogueA.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderA,
    });
    expect(reorder.status).toBe(201);

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const items = res.body.items ?? [];
    expect(items.map((r: any) => r.constraintId)).toEqual([constraintA.constraint_id]);
    expect(items.map((r: any) => r.constraintId)).not.toContain(constraintB.constraint_id);

    await aggregateAlertsForShop(shopId);
    const inventoryAlert = await inventoryAlertRow(shopId);
    expect(inventoryAlert?.is_active).toBe(true);
    expect(countFromTitle(inventoryAlert?.title)).toBe(1);
  }, 180_000);
});

// ── WAITING-07 — verified_resolved leaves WAITING ───────────────────────────

describe('WAITING-07 — a verified_resolved episode is absent from WAITING (item 7)', () => {
  it('address_correction: the item disappears once the constraint canonically resolves', async () => {
    const { shopId, token } = await provisionTenant('addr-resolved');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const patch = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    // Real re-evaluation against the now-complete order row resolves the constraint.
    await materialiseCustomerConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const resolved = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    )!;
    expect(resolved.is_active).toBe(false);
    expect(resolved.resolved_at).toBeTruthy();

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toBeUndefined();
  }, 180_000);
});

// ── WAITING-08 / 11 — episode-anchor mismatch (resolve -> re-raise) ────────

describe('WAITING-08 — a re-raised episode never lets the OLD intervention claim it: absent from WAITING, but the fresh episode still counts in NOW (items 8, 11)', () => {
  it('an intervention from a resolved-then-re-raised inventory episode is not shown as WAITING, and the newly-active constraint remains NOW-eligible', async () => {
    const { shopId, token } = await provisionTenant('inv-reraise');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Waiting V1 Mills Ltd');
    const { orderId } = await seedOrder(shopId, catalogue, 10);

    // Episode A: genuinely short, intervened, then resolved.
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

    // Episode B: the SAME deterministic constraint row is re-raised and left
    // ACTIVE (unlike OUTCOME-INV-06, which resolves it too) — this is the
    // "old intervention meets a fresh active episode" case items 8 and 11
    // both describe.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date(Date.now() + 1000));
    const episodeB = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    expect(episodeB.constraint_id).toBe(episodeA.constraint_id); // reused identity — the hazard
    expect(new Date(episodeB.started_at as unknown as string).getTime()).not.toBe(
      new Date(episodeA.started_at as unknown as string).getTime()
    );

    // item 8/11 — the stale intervention must not render as WAITING.
    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const staleItem = (res.body.items ?? []).find((r: any) => r.constraintId === episodeB.constraint_id);
    expect(staleItem).toBeUndefined();

    // The fresh episode has no NEW intervention pointed at it, so it must
    // remain fully NOW-eligible — the stale WAITING exclusion must not
    // accidentally suppress it too.
    await aggregateAlertsForShop(shopId);
    const inventoryAlert = await inventoryAlertRow(shopId);
    expect(inventoryAlert?.is_active).toBe(true);
    expect(countFromTitle(inventoryAlert?.title)).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

// ── WAITING-09 — MOVED to unit level ────────────────────────────────────────
//
// The incoherent-state contract (order_constraints.is_active=true WITH
// resolved_at set -> canonical outcome 'unknown') cannot be proved here: a
// real DB trigger rejects any hand-written order_constraints row outside the
// projection engine (`[PROJECTION_WRITE_VIOLATION] table=order_constraints
// must be written only by projection.engine`), confirmed by actually
// attempting the insert against the disposable DB. Per the correction brief,
// this is now proved at the unit level against the real, unmodified
// interventionOutcome.service.ts derivation (mocked DB read only) in
// tests/unit/backend/decisions/ops-console-waiting-v1-incoherent-outcome.test.ts.
// The NOW-must-not-be-suppressed half of the 'unknown' rule remains proved
// here by WAITING-08's episode-anchor-mismatch case, per the correction
// brief's explicit instruction not to duplicate that assertion.

// ── WAITING-10 — negative-latency resolution ────────────────────────────────

describe('WAITING-10 — a negative-latency (impossible-chronology) intervention is absent from WAITING (item 10)', () => {
  it('a sentinel intervention recorded after canonical resolution is never credited, mirroring OUTCOME-ADDR-07', async () => {
    const { shopId, token } = await provisionTenant('addr-neg-latency');
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
    expect(resolved.resolved_at).toBeTruthy();

    const resolvedAt = new Date(resolved.resolved_at as unknown as string);
    const sentinelOccurredAt = new Date(resolvedAt.getTime() + 500);
    await withTenant(shopId, (trx) =>
      trx('decision_interventions').insert({
        id: crypto.randomUUID(),
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: constraint.constraint_id,
        decision_id: null,
        treatment_key: 'address_correction',
        action_key: 'update_shipping_address',
        actor_type: 'user',
        source_surface: 'test:waiting-v1-negative-latency-sentinel',
        occurred_at: sentinelOccurredAt,
        metadata: JSON.stringify({ correction_source: 'manual' }),
      })
    );

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const sentinelItem = (res.body.items ?? []).find(
      (r: any) =>
        r.constraintId === constraint.constraint_id &&
        new Date(r.occurredAt).getTime() === sentinelOccurredAt.getTime()
    );
    expect(sentinelItem).toBeUndefined();
  }, 180_000);
});

// ── WAITING-13 — cross-shop / tenant isolation ─────────────────────────────

describe('WAITING-13 — cross-shop / tenant isolation (item 13)', () => {
  it('shop B never sees shop A pending_verification intervention through the shop-wide WAITING read', async () => {
    const shopA = await provisionTenant('tenant-a');
    const shopB = await provisionTenant('tenant-b');

    const catalogue = await seedCatalogue(shopA.shopId);
    const { orderId } = await seedOrder(shopA.shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopA.shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopA.shopId, orderId);

    const patch = await patchAddress(shopA.token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
    });
    expect(patch.status).toBe(200);

    // Sanity: shop A itself sees it.
    const resA = await getWaiting(shopA.token);
    expect(resA.status).toBe(200);
    expect((resA.body.items ?? []).map((r: any) => r.constraintId)).toContain(constraint.constraint_id);

    // Shop B must never see shop A's constraint/intervention.
    const resB = await getWaiting(shopB.token);
    expect(resB.status).toBe(200);
    expect((resB.body.items ?? []).map((r: any) => r.constraintId)).not.toContain(
      constraint.constraint_id
    );
    expect(resB.body.items ?? []).toEqual([]);
  }, 180_000);
});

// ═════════════════════════════════════════════════════════════════════════
// REQUIRED CORRECTIONS — POST-GREEN AUDIT (RED REGRESSION COVERAGE)
// ═════════════════════════════════════════════════════════════════════════
//
// CORRECTION 1 — ONE WAITING ROW PER CURRENT CONSTRAINT EPISODE.
//   decision_interventions is append-only provenance and may legitimately
//   carry N pending interventions against the SAME still-active constraint
//   episode. The shop-wide WAITING projection must still expose exactly ONE
//   row per episode: the latest occurredAt intervention. httpGetWaiting
//   currently maps every pending intervention record 1:1 into a WaitingItem
//   with no per-constraintId collapse, so WAITING-24/25 below are expected
//   RED on item-count/identity until that collapse is added.
//
// CORRECTION 2 — VALID TREATMENT / CONSTRAINT PAIRS.
//   The only valid V1 pairings are address_correction+customer/
//   incomplete_address and inventory_reorder_intent+inventory/oversell.
//   readShopInterventionOutcomes() currently filters only by treatment_key
//   membership in WAITING_V1_TREATMENTS and never checks constraintType/
//   blockType against the treatment — so a mismatched pairing both leaks
//   into WAITING and wrongly suppresses its NOW aggregate today.
//   WAITING-26/27/28 below are expected RED on both halves until an
//   eligibility check is added.

// ── WAITING-24 — repeated address_correction against one active episode ────

describe('WAITING-24 — repeated address_correction interventions against the SAME active episode collapse to exactly one WAITING row (correction 1)', () => {
  it('WAITING has exactly one row for the constraint, keyed to the LATEST intervention id/timestamp, and NOW excludes the episode exactly once', async () => {
    const { shopId, token } = await provisionTenant('addr-repeat');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    const first = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(first.status).toBe(200);

    // Canonical resolution is never projected between the two calls (no
    // worker runs in this harness — see WAITING-01's own comment), so the
    // episode is still the SAME active constraint for the second call.
    const stillActive = await activeCustomerConstraint(shopId, orderId);
    expect(stillActive.constraint_id).toBe(constraint.constraint_id);

    // Real wall-clock separation, not a fabricated timestamp: proves the
    // "latest occurredAt" rule against genuinely distinct DB-assigned
    // occurred_at values rather than incidental same-millisecond ordering.
    await new Promise((resolve) => setTimeout(resolve, 20));

    const second = await patchAddress(token, orderId, {
      address1: '221B Baker Street', city: 'London', zip: 'NW1 6XE', countryCode: 'GB',
      correctionSource: 'manual',
    });
    expect(second.status).toBe(200);

    const interventions = await withTenant(shopId, (trx) =>
      trx('decision_interventions')
        .where({ shop_id: shopId, entity_id: orderId, constraint_id: constraint.constraint_id })
        .orderBy('occurred_at', 'asc')
    );
    expect(interventions).toHaveLength(2);
    const latest = interventions[1];
    expect(new Date(latest.occurred_at).getTime()).toBeGreaterThan(
      new Date(interventions[0].occurred_at).getTime()
    );

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const matches = (res.body.items ?? []).filter(
      (r: any) => r.constraintId === constraint.constraint_id
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].interventionId).toBe(latest.id);
    expect(new Date(matches[0].occurredAt).getTime()).toBe(new Date(latest.occurred_at).getTime());

    await aggregateAlertsForShop(shopId);
    const customerAlert = await customerAlertRow(shopId);
    expect(customerAlert?.is_active ?? false).toBe(false);
  }, 180_000);
});

// ── WAITING-25 — repeated inventory_reorder_intent against one episode ─────

describe('WAITING-25 — repeated inventory_reorder_intent interventions (genuine qty increase) against the SAME active episode collapse to exactly one WAITING row (correction 1)', () => {
  it('WAITING has exactly one row for the constraint, keyed to the LATEST intervention id/timestamp, and NOW excludes the episode exactly once', async () => {
    const { shopId, token } = await provisionTenant('inv-repeat');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Waiting V1 Mills Ltd');
    const { orderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const first = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(first.status).toBe(201);

    await new Promise((resolve) => setTimeout(resolve, 20));

    // SRC-01a: qty_requested is a LEVEL, not a delta — only a genuine
    // increase over the existing pending level is a "material change" and
    // writes a second intervention (reorderRequests.controller.ts).
    const second = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 15,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(second.status).toBe(201);

    const interventions = await withTenant(shopId, (trx) =>
      trx('decision_interventions')
        .where({ shop_id: shopId, entity_id: orderId, constraint_id: constraint.constraint_id })
        .orderBy('occurred_at', 'asc')
    );
    expect(interventions).toHaveLength(2);
    const latest = interventions[1];
    expect(new Date(latest.occurred_at).getTime()).toBeGreaterThan(
      new Date(interventions[0].occurred_at).getTime()
    );

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const matches = (res.body.items ?? []).filter(
      (r: any) => r.constraintId === constraint.constraint_id
    );
    expect(matches).toHaveLength(1);
    expect(matches[0].interventionId).toBe(latest.id);
    expect(new Date(matches[0].occurredAt).getTime()).toBe(new Date(latest.occurred_at).getTime());

    await aggregateAlertsForShop(shopId);
    const inventoryAlert = await inventoryAlertRow(shopId);
    expect(inventoryAlert?.is_active ?? false).toBe(false);
  }, 180_000);
});

// ── WAITING-26 — invalid pair: address_correction on an inventory episode ──

describe('WAITING-26 — sentinel treatment_key=address_correction against an active inventory/oversell constraint is an invalid V1 pairing (correction 2)', () => {
  it('is absent from WAITING, and the inventory NOW aggregate still counts the constraint normally', async () => {
    const { shopId, token } = await provisionTenant('addr-invalid-pair');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    // Sentinel row, mirroring WAITING-10's own established precedent for a
    // state the real lifecycle cannot organically produce: the only invalid
    // dimension is the treatment/constraint pairing (address_correction can
    // never legitimately point at an inventory/oversell episode). Metadata
    // shape matches the real address writer exactly (no episode anchor —
    // address_correction never sets constraint_started_at).
    await withTenant(shopId, (trx) =>
      trx('decision_interventions').insert({
        id: crypto.randomUUID(),
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: constraint.constraint_id,
        decision_id: null,
        treatment_key: 'address_correction',
        action_key: 'update_shipping_address',
        actor_type: 'user',
        source_surface: 'test:waiting-v1-invalid-pair-sentinel',
        occurred_at: new Date(),
        metadata: JSON.stringify({ correction_source: 'manual' }),
      })
    );

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toBeUndefined();

    await aggregateAlertsForShop(shopId);
    const inventoryAlert = await inventoryAlertRow(shopId);
    expect(inventoryAlert?.is_active).toBe(true);
    expect(countFromTitle(inventoryAlert?.title)).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

// ── WAITING-27 — invalid pair: inventory_reorder_intent on a customer episode

describe('WAITING-27 — sentinel treatment_key=inventory_reorder_intent against an active customer/incomplete_address constraint is an invalid V1 pairing (correction 2)', () => {
  it('is absent from WAITING, and the customer NOW aggregate still counts the constraint normally', async () => {
    const { shopId, token } = await provisionTenant('inv-invalid-pair');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1, { completeAddress: false });
    await materialiseCustomerConstraint(shopId, orderId, new Date());
    const constraint = await activeCustomerConstraint(shopId, orderId);

    // Episode anchor preserved to match the target constraint's REAL
    // started_at exactly, so the only invalid dimension under test is the
    // treatment/constraint pairing — never a stale/mismatched episode
    // anchor that deriveOutcome would independently reject as 'unknown'.
    await withTenant(shopId, (trx) =>
      trx('decision_interventions').insert({
        id: crypto.randomUUID(),
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: constraint.constraint_id,
        decision_id: null,
        treatment_key: 'inventory_reorder_intent',
        action_key: 'create_reorder_request',
        actor_type: 'user',
        source_surface: 'test:waiting-v1-invalid-pair-sentinel',
        occurred_at: new Date(),
        metadata: JSON.stringify({
          constraint_started_at: new Date(constraint.started_at as unknown as string).toISOString(),
        }),
      })
    );

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find((r: any) => r.constraintId === constraint.constraint_id);
    expect(item).toBeUndefined();

    await aggregateAlertsForShop(shopId);
    const customerAlert = await customerAlertRow(shopId);
    expect(customerAlert?.is_active).toBe(true);
    expect(countFromTitle(customerAlert?.title)).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

// ── WAITING-28 — operational defense: invalid pair on an operational episode

describe('WAITING-28 — sentinel V1 treatment against an active operational constraint is an invalid V1 pairing (correction 2, item 5)', () => {
  it('is absent from WAITING, and the operational NOW contribution is unaffected', async () => {
    const { shopId, userId, token } = await provisionTenant('op-invalid-pair');
    const catalogue = await seedCatalogue(shopId);
    const { orderId } = await seedOrder(shopId, catalogue, 1);

    // Real writer, real invariant: createUndeliveredReturnJob is the
    // sanctioned production path that materialises an active
    // operational/returned_undelivered constraint (returnJobs.service.ts) —
    // no hand-written order_constraints row, no bypassed trigger.
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

    // No valid V1 pairing includes constraintType='operational' at all — an
    // address_correction sentinel here is invalid on that basis alone.
    await withTenant(shopId, (trx) =>
      trx('decision_interventions').insert({
        id: crypto.randomUUID(),
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: operationalConstraint.constraint_id,
        decision_id: null,
        treatment_key: 'address_correction',
        action_key: 'update_shipping_address',
        actor_type: 'user',
        source_surface: 'test:waiting-v1-invalid-pair-sentinel',
        occurred_at: new Date(),
        metadata: JSON.stringify({ correction_source: 'manual' }),
      })
    );

    const res = await getWaiting(token);
    expect(res.status).toBe(200);
    const item = (res.body.items ?? []).find(
      (r: any) => r.constraintId === operationalConstraint.constraint_id
    );
    expect(item).toBeUndefined();

    await aggregateAlertsForShop(shopId);
    const operationalAlert = await operationalAlertRow(shopId);
    expect(operationalAlert?.is_active).toBe(true);
    expect(countFromTitle(operationalAlert?.title)).toBeGreaterThanOrEqual(1);
  }, 180_000);
});

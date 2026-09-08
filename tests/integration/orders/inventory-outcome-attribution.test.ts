/**
 * OUTCOME-INV-01 — INVENTORY INTERVENTION PROVENANCE + VERIFIED OUTCOME.
 * Pilot scope: inventory / oversell, reorder intent raised from targeted Sourcing.
 *
 * THE DISTINCTION UNDER PROTECTION
 *   execution success != treatment success != operational outcome
 *
 *   Queueing a reorder is a real, durable, operator-initiated purchasing
 *   commitment. It is NOT supply. It does not move inventory_truth, it does not
 *   make a single unit pickable, and it therefore cannot clear an oversell.
 *   Only canonical constraint truth (order_constraints.is_active / resolved_at),
 *   re-derived after stock actually becomes pickable, says the blocker is gone.
 *
 *   These contracts exist to stop a future implementation from promoting
 *   reorder_requests.status, purchase_orders.status, committed inbound, draft PO
 *   quantity, decision.status or decision_execution_queue.status into the
 *   outcome answer.
 *
 *   OUTCOME-INV-01  a targeted reorder against a genuinely blocked order writes
 *                   exactly ONE durable intervention naming the EXACT active
 *                   inventory constraint_id, with actor/source/quantity/episode
 *                   provenance — and changes no availability.
 *   OUTCOME-INV-02  before stock is pickable the outcome is pending_verification.
 *   OUTCOME-INV-03  after the REAL canonical revalidation path resolves that same
 *                   constraint, the outcome reads verified_resolved FROM canonical
 *                   truth — with no successful execution-queue row and no resolved
 *                   decision able to have supplied it.
 *   OUTCOME-INV-04  a coexisting customer/incomplete_address constraint is never
 *                   credited to the inventory intervention.
 *   OUTCOME-INV-05  a reorder naming an order with no active oversell for that
 *                   exact variant manufactures no intervention.
 *   OUTCOME-INV-06  EPISODE GUARD. constraint_id is deterministic and REUSED
 *                   across resolve → re-raise cycles. An intervention from a
 *                   previous episode must never inherit a later episode's
 *                   resolution.
 *   OUTCOME-INV-07  navigation (open_sourcing) alone writes nothing at all.
 *   OUTCOME-INV-08  a generic reorder with no originating order writes no
 *                   intervention.
 *   OUTCOME-INV-09  NO-OP REPEAT. Interventions track material durable
 *                   purchasing-state changes, not clicks and not HTTP 2xx.
 *
 * WHAT THIS SLICE DOES NOT ASSERT
 *   Nothing here claims oversell prevented, revenue saved or protected, ROI, or
 *   that laSyncro resolved an inventory problem. A merchant may buy stock for
 *   reasons entirely unrelated to the blocker. The only supported claim is
 *   "verified resolved after the recorded intervention."
 *
 * FROZEN BOUNDARY
 *   module : apps/backend/src/services/decision/interventionOutcome.service.ts
 *   export : readOrderInterventionOutcomes({ shopId, lasyncroOrderId })
 *
 * HARNESS
 *   Canonical throughout. Constraints are materialised ONLY through
 *   evaluateInventoryConstraint/evaluateCustomerConstraint -> projectOrderConstraints,
 *   and resolved ONLY through the production revalidateOrdersForReceivedVariants
 *   (the same function receive-close and stow-confirm call). No order_constraints
 *   row is ever hand-written, hand-cleared, or hand-edited; started_at and
 *   resolved_at are never touched by this file. The reorder write is the REAL
 *   authenticated HTTP route.
 *
 *   Disposable synchroflow_test_* DB only (`npm run test:integration`).
 */
import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import { evaluateCustomerConstraint } from 'api-src/services/constraints/evaluators/customerConstraintEvaluator';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';
import { revalidateOrdersForReceivedVariants } from 'api-src/services/wms/receiveJob.service';
import { withTenant, systemTransaction, setTenantContext } from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();

const PICK_BIN = 'A-1';

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

// ── the frozen read seam ────────────────────────────────────────────────────

interface InterventionOutcome {
  constraintId: string | null;
  shopId: number;
  lasyncroOrderId: string;
  treatment: string;
  actionKey?: string;
  actorType?: string;
  actorUserId: number | null;
  sourceSurface: string;
  occurredAt: string | Date;
  metadata: Record<string, unknown> | null;
  outcome: {
    status: 'pending_verification' | 'verified_resolved' | 'unknown';
    constraintIsActive: boolean | null;
    constraintResolvedAt: string | Date | null;
    resolutionLatencyMs: number | null;
  };
}

async function readInterventions(input: {
  shopId: number;
  lasyncroOrderId: string;
}): Promise<InterventionOutcome[]> {
  const mod = await import('api-src/services/decision/interventionOutcome.service');
  const fn = mod.readOrderInterventionOutcomes;
  if (typeof fn !== 'function') {
    throw new Error(
      '[OUTCOME-INV-01] interventionOutcome.service does not export readOrderInterventionOutcomes'
    );
  }
  return (fn as (i: typeof input) => Promise<InterventionOutcome[]>)(input);
}

// ── canonical fixtures ──────────────────────────────────────────────────────

type Tenant = { shopId: number; userId: number; token: string; rootCode: string };

async function provisionTenant(label: string): Promise<Tenant> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `inv-outcome-${label}-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `inv-outcome+${unique}@test.example`,
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

    // requireFt2 resolves the lifecycle phase for the token's user.
    await trx('user_lifecycle_snapshot').insert({
      shop_id: shopId,
      user_id: userId,
      phase: 'FT2',
      since: new Date(),
      last_event_id: crypto.randomUUID(),
    });

    // purchasing.sourcing is Growth+. Commercial DENIAL is owned by the
    // entitlements suite, never here — this fixture must be eligible for the
    // surface under test.
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
      name: 'Inventory outcome warehouse',
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

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId, tier: 'growth' }),
    rootCode,
  };
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
      title: 'Inventory outcome product',
      status: 'active',
      product_type: 'physical',
    });
    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `INV-OUT-${unique}`,
      title: 'Inventory outcome variant',
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
): Promise<string> {
  const orderId = crypto.randomUUID();
  const complete = opts.completeAddress ?? true;
  const stamp = new Date();

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
      external_order_id:
        String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: catalogue.productId,
      lasyncro_variant_id: catalogue.variantId,
      sku: null,
      title: 'Inventory outcome line',
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
      title: 'Inventory outcome line',
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

  return orderId;
}

/** Location-level stock. Only PICK_BIN and the warehouse root are pickable. */
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

/**
 * Materialises the REAL inventory constraint through the canonical chain.
 * `anchor` is the projection's own eventAnchor parameter — the same value the
 * projection engine passes from a domain event's event_time. Distinct anchors
 * are how two genuine lifecycle EPISODES are told apart; nothing here writes
 * started_at or resolved_at directly.
 */
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
 * The REAL canonical resolution path — the exact function receive-close
 * (receiveJob.service.ts) and stow-confirm (wms.controller.ts) call. Nothing in
 * this suite clears a constraint by hand.
 */
async function canonicalRevalidate(shopId: number, variantId: string) {
  await withTenant(shopId, (trx) =>
    revalidateOrdersForReceivedVariants(trx, shopId, [variantId])
  );
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

async function seedSupplier(shopId: number, name: string): Promise<number> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('suppliers')
      .insert({ shop_id: shopId, name, active: true })
      .returning('id');
    return Number(row.id ?? row);
  });
}

async function interventionRows(shopId: number, orderId: string) {
  return withTenant(shopId, (trx) =>
    trx('decision_interventions')
      .where({ shop_id: shopId, entity_type: 'order', entity_id: orderId })
      .orderBy('occurred_at', 'asc')
      .select('*')
  );
}

async function allInterventionRows(shopId: number) {
  return withTenant(shopId, (trx) =>
    trx('decision_interventions').where({ shop_id: shopId }).select('*')
  );
}

async function reorderRows(shopId: number, variantId: string) {
  return withTenant(shopId, (trx) =>
    trx('reorder_requests')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId })
      .select('id', 'qty_requested', 'status', 'supplier_id')
  );
}

async function pickableTotal(shopId: number, variantId: string): Promise<number> {
  const row = await withTenant(shopId, (trx) =>
    trx('inventory_truth')
      .where({ shop_id: shopId, lasyncro_variant_id: variantId })
      .sum({ available: 'available_quantity' })
      .first()
  );
  return Number(row?.available ?? 0);
}

/** The real authenticated purchasing write. */
const postReorder = (token: string, body: Record<string, unknown>) =>
  request(app)
    .post('/api/v1/suppliers/reorder-requests')
    .set('Authorization', `Bearer ${token}`)
    .send(body);

// ── OUTCOME-INV-01 / 02 / 03 ───────────────────────────────────────────────

describe('OUTCOME-INV-01/02/03 — provenance, pending verification, then canonical verified outcome', () => {
  it('attributes the exact inventory constraint_id, withholds resolution until stock is pickable, then verifies from constraint truth', async () => {
    const { shopId, userId, token } = await provisionTenant('one');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Outcome Mills Ltd');

    // Genuinely short: demand 10, nothing pickable.
    const orderId = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());

    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    const availabilityBefore = await pickableTotal(shopId, catalogue.variantId);

    // ── OUTCOME-INV-01 — the real purchasing write, from the blocked order.
    const res = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
      shown_treatment_key: 'source_remaining',
    });
    expect(res.status).toBe(201);

    // The reorder itself really happened.
    const reorders = await reorderRows(shopId, catalogue.variantId);
    expect(reorders).toHaveLength(1);
    expect(Number(reorders[0].qty_requested)).toBe(10);
    expect(reorders[0].status).toBe('pending');

    // Exactly one durable intervention, fully attributed.
    const rows = await interventionRows(shopId, orderId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        shop_id: shopId,
        entity_type: 'order',
        entity_id: orderId,
        constraint_id: constraint.constraint_id,
        treatment_key: 'inventory_reorder_intent',
        action_key: 'create_reorder_request',
        actor_type: 'user',
        actor_user_id: userId,
        source_surface: 'sourcing_targeted_reorder_queue',
      })
    );
    expect(rows[0].decision_id).toBeNull();

    const metadata = rows[0].metadata as Record<string, unknown>;
    expect(metadata).toEqual(
      expect.objectContaining({
        variant_id: catalogue.variantId,
        supplier_id: supplierId,
        reorder_request_id: reorders[0].id,
        requested_qty: 10,
        resulting_qty_requested: 10,
      })
    );
    expect(metadata.constraint_started_at).toBeTruthy();
    expect(new Date(String(metadata.constraint_started_at)).getTime()).toBe(
      new Date(constraint.started_at as unknown as string).getTime()
    );
    // Advisory only — recorded, never authoritative.
    expect(metadata.shown_treatment_key).toBe('source_remaining');

    // Queueing intent is NOT supply.
    expect(await pickableTotal(shopId, catalogue.variantId)).toBe(availabilityBefore);
    const stillActive = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    expect(stillActive.constraint_id).toBe(constraint.constraint_id);

    // ── OUTCOME-INV-02 — nothing is pickable yet, so nothing may be claimed.
    const afterQueue = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(afterQueue).toHaveLength(1);
    expect(afterQueue[0].constraintId).toBe(constraint.constraint_id);
    expect(afterQueue[0].outcome).toEqual(
      expect.objectContaining({
        status: 'pending_verification',
        constraintIsActive: true,
        constraintResolvedAt: null,
        resolutionLatencyMs: null,
      })
    );

    // ── OUTCOME-INV-03 — stock genuinely becomes pickable, then the REAL
    // production revalidation path re-derives canonical truth. This suite does
    // not resolve the constraint; the system does.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);

    const resolvedRow = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === constraint.constraint_id
    );
    expect(resolvedRow).toBeTruthy();
    expect(resolvedRow!.is_active).toBe(false);
    expect(resolvedRow!.resolved_at).toBeTruthy();
    // Same episode: the row was resolved, not re-raised.
    expect(new Date(resolvedRow!.started_at as unknown as string).getTime()).toBe(
      new Date(constraint.started_at as unknown as string).getTime()
    );

    const verified = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(verified).toHaveLength(1);
    expect(verified[0].constraintId).toBe(constraint.constraint_id);
    expect(verified[0].outcome).toEqual(
      expect.objectContaining({ status: 'verified_resolved', constraintIsActive: false })
    );
    expect(verified[0].outcome.constraintResolvedAt).toBeTruthy();
    expect(verified[0].outcome.resolutionLatencyMs).not.toBeNull();
    expect(verified[0].outcome.resolutionLatencyMs!).toBeGreaterThanOrEqual(0);

    // The intervention was not duplicated by verification.
    expect(await interventionRows(shopId, orderId)).toHaveLength(1);

    /**
     * …and nothing else could have supplied that answer. No decision, no
     * execution-queue row, and the purchasing workflow rows are untouched by
     * verification — they are not outcome authority and never were.
     */
    const successfulExecutions = await withTenant(shopId, (trx) =>
      trx('decision_execution_queue as q')
        .joinRaw('INNER JOIN decisions as d ON d.id::text = q.decision_id')
        .where('d.entity_id', orderId)
        .andWhere('q.status', 'success')
        .select('q.decision_id')
    );
    expect(successfulExecutions).toEqual([]);

    const resolvedDecisions = await withTenant(shopId, (trx) =>
      trx('decisions').where({ entity_id: orderId, status: 'resolved' }).select('id')
    );
    expect(resolvedDecisions).toEqual([]);

    // The reorder request is still merely pending. Outcome did not come from it.
    const reordersAfter = await reorderRows(shopId, catalogue.variantId);
    expect(reordersAfter[0].status).toBe('pending');
  }, 180_000);
});

// ── OUTCOME-INV-04 ─────────────────────────────────────────────────────────

describe('OUTCOME-INV-04 — a coexisting customer blocker is never attributed', () => {
  it('names only the inventory constraint and leaves the customer constraint independent', async () => {
    const { shopId, token } = await provisionTenant('four');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Outcome Mills Ltd');

    // Both blockers are real: short stock AND an incomplete address.
    const orderId = await seedOrder(shopId, catalogue, 10, { completeAddress: false });
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    const anchor = new Date();
    await materialiseInventoryConstraint(shopId, orderId, anchor);
    await materialiseCustomerConstraint(shopId, orderId, anchor);

    const before = (await constraintsFor(shopId, orderId)).filter((c) => c.is_active);
    expect(before).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ constraint_type: 'inventory', block_type: 'oversell' }),
        expect.objectContaining({ constraint_type: 'customer', block_type: 'incomplete_address' }),
      ])
    );

    const inventoryConstraint = await activeInventoryConstraint(
      shopId,
      orderId,
      catalogue.variantId
    );
    const customerConstraintIds = before
      .filter((c) => c.constraint_type === 'customer')
      .map((c) => c.constraint_id);
    expect(customerConstraintIds.length).toBeGreaterThanOrEqual(1);

    const res = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(res.status).toBe(201);

    const interventions = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(interventions).toHaveLength(1);
    expect(interventions[0].constraintId).toBe(inventoryConstraint.constraint_id);
    expect(customerConstraintIds).not.toContain(interventions[0].constraintId);

    // Resolving the inventory blocker must not touch the customer blocker.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);

    const after = await constraintsFor(shopId, orderId);
    const inventoryAfter = after.find(
      (c) => c.constraint_id === inventoryConstraint.constraint_id
    )!;
    expect(inventoryAfter.is_active).toBe(false);

    const customerAfter = after.find((c) => c.constraint_id === customerConstraintIds[0])!;
    expect(customerAfter.is_active).toBe(true);
    expect(customerAfter.resolved_at).toBeNull();

    const verified = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(verified).toHaveLength(1);
    expect(verified[0].constraintId).toBe(inventoryConstraint.constraint_id);
    expect(verified[0].outcome.status).toBe('verified_resolved');
  }, 180_000);
});

// ── OUTCOME-INV-05 ─────────────────────────────────────────────────────────

describe('OUTCOME-INV-05 — no active oversell for that exact variant means no intervention', () => {
  it('lets the reorder succeed on existing purchasing semantics but manufactures nothing', async () => {
    const { shopId, token } = await provisionTenant('five');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Outcome Mills Ltd');

    // Fully covered from the start — no oversell was ever raised.
    const orderId = await seedOrder(shopId, catalogue, 2);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await materialiseInventoryConstraint(shopId, orderId, new Date());

    const active = (await constraintsFor(shopId, orderId)).filter(
      (c) => c.is_active && c.constraint_type === 'inventory'
    );
    expect(active).toEqual([]);

    const res = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 5,
      source: 'manual',
      originating_order_id: orderId,
    });

    // Purchasing is legitimate — buying ahead is not an error.
    expect(res.status).toBe(201);
    expect(await reorderRows(shopId, catalogue.variantId)).toHaveLength(1);

    // …but there was no blocker to treat, so nothing is attributed.
    expect(await interventionRows(shopId, orderId)).toEqual([]);
    expect(await readInterventions({ shopId, lasyncroOrderId: orderId })).toEqual([]);
  }, 180_000);
});

// ── OUTCOME-INV-06 — EPISODE GUARD ─────────────────────────────────────────

describe('OUTCOME-INV-06 — an earlier episode never inherits a later episode’s resolution', () => {
  it('returns unknown when the reused constraint row has been re-raised since the intervention', async () => {
    const { shopId, token } = await provisionTenant('six');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Outcome Mills Ltd');

    const orderId = await seedOrder(shopId, catalogue, 10);

    // ── EPISODE A: genuinely short.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const episodeA = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const res = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'alert',
      originating_order_id: orderId,
    });
    expect(res.status).toBe(201);

    const intervention = (await interventionRows(shopId, orderId))[0];
    expect(intervention).toBeTruthy();
    expect(intervention.constraint_id).toBe(episodeA.constraint_id);

    // Episode A resolves through the real canonical path.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);

    const resolvedA = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === episodeA.constraint_id
    )!;
    expect(resolvedA.is_active).toBe(false);
    expect(resolvedA.resolved_at).toBeTruthy();

    // Honest interim state: at this point the episode still matches, so the
    // intervention legitimately verifies. This is the baseline the guard must
    // NOT break.
    const duringEpisodeA = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(duringEpisodeA[0].outcome.status).toBe('verified_resolved');

    // ── EPISODE B: stock is consumed elsewhere and the SAME deterministic
    // constraint row is re-raised. Nothing here edits started_at or resolved_at.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date(Date.now() + 1000));

    const episodeB = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    // Deterministic identity is REUSED — that is exactly the hazard.
    expect(episodeB.constraint_id).toBe(episodeA.constraint_id);
    expect(new Date(episodeB.started_at as unknown as string).getTime()).not.toBe(
      new Date(episodeA.started_at as unknown as string).getTime()
    );

    // Episode B resolves too.
    await setStock(shopId, catalogue.variantId, PICK_BIN, 10);
    await canonicalRevalidate(shopId, catalogue.variantId);

    const resolvedB = (await constraintsFor(shopId, orderId)).find(
      (c) => c.constraint_id === episodeA.constraint_id
    )!;
    expect(resolvedB.is_active).toBe(false);
    expect(resolvedB.resolved_at).toBeTruthy();

    /**
     * The episode-A intervention must NOT be credited with episode B's
     * resolution. Chronology alone cannot catch this — resolvedB.resolved_at is
     * legitimately later than occurred_at. Only episode identity can.
     */
    const outcomes = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome.status).toBe('unknown');
    expect(outcomes[0].outcome.constraintIsActive).toBe(false);
    expect(outcomes[0].outcome.resolutionLatencyMs).toBeNull();
  }, 180_000);
});

// ── OUTCOME-INV-07 ─────────────────────────────────────────────────────────

describe('OUTCOME-INV-07 — navigation alone writes nothing', () => {
  it('reading the blocked order and its sourcing evidence creates no intervention and no purchasing state', async () => {
    const { shopId, token } = await provisionTenant('seven');
    const catalogue = await seedCatalogue(shopId);

    const orderId = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    // The two reads a merchant performs by navigating: Order Detail (which
    // carries the open_sourcing action) and targeted Sourcing itself.
    const detail = await request(app)
      .get(`/api/v1/orders/${orderId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(detail.status).toBe(200);

    const sourcing = await request(app)
      .get(`/api/v1/suppliers/sourcing-recommendations/${catalogue.variantId}`)
      .query({ orderId })
      .set('Authorization', `Bearer ${token}`);
    expect(sourcing.status).toBe(200);

    // open_sourcing is navigation. Navigation is not a treatment.
    expect(await allInterventionRows(shopId)).toEqual([]);
    expect(await reorderRows(shopId, catalogue.variantId)).toEqual([]);
    expect(await readInterventions({ shopId, lasyncroOrderId: orderId })).toEqual([]);

    const after = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);
    expect(after.constraint_id).toBe(constraint.constraint_id);
    expect(new Date(after.started_at as unknown as string).getTime()).toBe(
      new Date(constraint.started_at as unknown as string).getTime()
    );
  }, 180_000);
});

// ── OUTCOME-INV-08 ─────────────────────────────────────────────────────────

describe('OUTCOME-INV-08 — a generic reorder with no originating order attributes nothing', () => {
  it('preserves existing generic purchasing behavior and writes no intervention', async () => {
    const { shopId, token } = await provisionTenant('eight');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Outcome Mills Ltd');

    // A genuinely blocked order EXISTS — but this reorder does not come from it.
    const orderId = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const res = await postReorder(token, {
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: 10,
      source: 'manual',
    });
    expect(res.status).toBe(201);
    expect(await reorderRows(shopId, catalogue.variantId)).toHaveLength(1);

    // No originating order was asserted, so no order may be credited — even
    // though one plausibly could have been guessed from the variant.
    expect(await allInterventionRows(shopId)).toEqual([]);
    expect(await readInterventions({ shopId, lasyncroOrderId: orderId })).toEqual([]);
  }, 180_000);
});

// ── OUTCOME-INV-09 — NO-OP REPEAT ──────────────────────────────────────────

describe('OUTCOME-INV-09 — interventions track material purchasing change, not clicks', () => {
  it('writes nothing for a non-raising repeat and exactly one for a genuine raise', async () => {
    const { shopId, token } = await provisionTenant('nine');
    const catalogue = await seedCatalogue(shopId);
    const supplierId = await seedSupplier(shopId, 'Outcome Mills Ltd');

    const orderId = await seedOrder(shopId, catalogue, 10);
    await setStock(shopId, catalogue.variantId, PICK_BIN, 0);
    await materialiseInventoryConstraint(shopId, orderId, new Date());
    const constraint = await activeInventoryConstraint(shopId, orderId, catalogue.variantId);

    const body = (qty: number) => ({
      lasyncro_variant_id: catalogue.variantId,
      supplier_id: supplierId,
      qty_requested: qty,
      source: 'alert',
      originating_order_id: orderId,
    });

    // 1. First queue — a new durable pending request. One intervention.
    expect((await postReorder(token, body(6))).status).toBe(201);
    expect(await interventionRows(shopId, orderId)).toHaveLength(1);

    // 2. Same level again. The endpoint still succeeds (existing semantics),
    //    but nothing durable changed — a click is not a treatment.
    expect((await postReorder(token, body(6))).status).toBe(201);
    expect(await interventionRows(shopId, orderId)).toHaveLength(1);

    // 3. LOWER level. qty_requested is a level, not a delta: the persisted
    //    level stays at 6, so again nothing material happened.
    expect((await postReorder(token, body(4))).status).toBe(201);
    expect((await reorderRows(shopId, catalogue.variantId))[0].qty_requested).toBe(6);
    expect(await interventionRows(shopId, orderId)).toHaveLength(1);

    // 4. A genuine raise — the merchant commits to more units. One more.
    expect((await postReorder(token, body(9))).status).toBe(201);
    expect((await reorderRows(shopId, catalogue.variantId))[0].qty_requested).toBe(9);

    const rows = await interventionRows(shopId, orderId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.constraint_id === constraint.constraint_id)).toBe(true);

    const raise = rows[1].metadata as Record<string, unknown>;
    expect(raise).toEqual(
      expect.objectContaining({
        requested_qty: 9,
        previous_qty_requested: 6,
        resulting_qty_requested: 9,
      })
    );

    // Both interventions describe the same still-active blocker.
    const outcomes = await readInterventions({ shopId, lasyncroOrderId: orderId });
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((o) => o.outcome.status === 'pending_verification')).toBe(true);
  }, 180_000);
});

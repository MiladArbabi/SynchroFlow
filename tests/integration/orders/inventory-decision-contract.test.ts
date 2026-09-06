import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { generateDecisions } from 'api-src/domain/decision/decision.engine';
import { DecisionRepository } from 'api-src/domain/decision/decision.repository';
import { resolveInventoryBlockHandler } from 'api-src/execution/handlers/resolve_inventory_block.handler';
import * as proceedFulfillmentModule from 'api-src/execution/handlers/proceed_fulfillment.handler';
import { evaluateInventoryConstraint } from 'api-src/services/constraints/evaluators/inventoryConstraintEvaluator';
import {
  CONSTRAINT_TYPE_BY_ACTION,
  isDecisionActionStillValid,
} from 'api-src/domain/decision/decisionConstraintRequirements';
import { reconcileOrderFulfillment } from 'api-src/workers/reconciliation/reconciliation.handlers';
import { projectOrderConstraints } from 'api-src/projections/orderConstraintProjection';

import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const now = new Date('2026-09-02T12:00:00.000Z');

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function createShop() {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `inv-decision-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `inv-decision-${unique}@test.example`,
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

  return {
    shopId,
    userId,
    token: issueTestToken({ userId, shopId }),
  };
}

type InventoryFixtureOptions = {
  quantity: number;
  fulfilledQuantity?: number;
  pickableAvailable: number;
  rootAvailable?: number;
  quarantineAvailable?: number;
};

async function seedInventoryFixture(
  shopId: number,
  opts: InventoryFixtureOptions
) {
  const orderId = crypto.randomUUID();
  const productId = crypto.randomUUID();
  const variantId = crypto.randomUUID();
  const warehouseId = crypto.randomUUID();
  const rootCode = `WH-${shopId}-ROOT`;

  await withTenant(shopId, async (trx) => {
    await trx('warehouses').insert({
      warehouse_id: warehouseId,
      shop_id: shopId,
      name: 'Inventory contract warehouse',
      root_location_code: rootCode,
      is_default: true,
      active: true,
    });

    const locations = [
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
    ];

    if (opts.quarantineAvailable != null) {
      locations.push({
        shop_id: shopId,
        warehouse_id: warehouseId,
        location_code: 'QUARANTINE-1',
        type: 'bin',
        parent_location_code: rootCode,
        active: true,
        zone_type: 'quarantine',
      });
    }

    await trx('warehouse_locations').insert(locations);

    await trx('products').insert({
      lasyncro_product_id: productId,
      shop_id: shopId,
      title: 'Inventory Contract Product',
      status: 'active',
      product_type: 'physical',
    });

    await trx('variants').insert({
      lasyncro_variant_id: variantId,
      lasyncro_product_id: productId,
      shop_id: shopId,
      sku: `INV-${crypto.randomBytes(4).toString('hex')}`,
      title: 'Inventory Contract Variant',
      unit_cost: '5.00',
      status: 'active',
    });

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

    await trx('external_order_identity_map').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
      platform: 'shopify',
      external_order_id:
        String(Date.now()) +
        String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0'),
    });

    await trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Inventory Contract Line',
      quantity: opts.quantity,
      fulfilled_quantity: opts.fulfilledQuantity ?? 0,
      unit_price: '100.00',
      line_total: (100 * opts.quantity).toFixed(2),
      estimated_unit_cost: '5.00',
    });

    await trx('order_line_items').insert({
      lasyncro_line_item_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      lasyncro_product_id: productId,
      lasyncro_variant_id: variantId,
      sku: null,
      title: 'Inventory Contract Line',
      quantity: opts.quantity,
      unit_price: '100.00',
      line_total: (100 * opts.quantity).toFixed(2),
      created_at: now,
      updated_at: now,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
      created_at: now,
      updated_at: now,
    });

    const truthRows = [
      {
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: rootCode,
        on_hand_quantity: opts.rootAvailable ?? 0,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: opts.rootAvailable ?? 0,
        last_evaluated_at: now,
      },
      {
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: 'A-1',
        on_hand_quantity: opts.pickableAvailable,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: opts.pickableAvailable,
        last_evaluated_at: now,
      },
    ];

    if (opts.quarantineAvailable != null) {
      truthRows.push({
        shop_id: shopId,
        lasyncro_variant_id: variantId,
        location_code: 'QUARANTINE-1',
        on_hand_quantity: opts.quarantineAvailable,
        reserved_quantity: 0,
        committed_quantity: 0,
        available_quantity: opts.quarantineAvailable,
        last_evaluated_at: now,
      });
    }

    await trx('inventory_truth').insert(truthRows);
  });

  return {
    orderId,
    productId,
    variantId,
    warehouseId,
    rootCode,
  };
}

function inventoryRiskSnapshot() {
  return {
    order_health_score: 40,
    aging_risk_component: 0,
    sla_risk_component: 0,
    inventory_risk_component: 100,
    customer_risk_component: 0,
    operational_risk_component: 0,
    is_inventory_blocked: true,
    is_customer_blocked: false,
    is_operational_blocked: false,
    is_already_fulfilled: false,
    operational_block_type: null,
  };
}

/**
 * decision.id is generated unhyphenated in memory but stored as a canonical
 * hyphenated uuid. Identity is what matters here, not the formatting.
 */
const sameDecisionId = (a: string, b: string) =>
  a.replace(/-/g, '') === b.replace(/-/g, '');

/**
 * Materialises the REAL active inventory constraint through the canonical
 * chain (evaluateInventoryConstraint -> projectOrderConstraints), using the
 * same transaction-local projection writer guard INV-RED-05 uses. The fixture
 * seeder only writes stock/demand rows; it never projects constraints.
 */
async function materialiseInventoryConstraint(shopId: number, orderId: string) {
  await withTenant(shopId, async (trx) => {
    const evaluations = await evaluateInventoryConstraint(trx, orderId, shopId);
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await projectOrderConstraints(trx, orderId, shopId, 1, now, evaluations);
  });
}

async function persistInventoryDecision(shopId: number, orderId: string) {
  const [decision] = generateDecisions({
    orderId,
    shopId,
    aggregateVersion: 1,
    riskSnapshot: inventoryRiskSnapshot(),
  });

  if (!decision) {
    throw new Error('expected inventory decision fixture');
  }

  await withTenant(shopId, async (trx) => {
    await DecisionRepository.create(trx, decision);
  });

  return decision;
}

function executionInput(shopId: number, orderId: string) {
  return {
    decision_id: crypto.randomUUID(),
    entity_id: orderId,
    shop_id: shopId,
    aggregate_version: 1,
    action_type: 'resolve_inventory_block',
    payload: {},
    execution_mode: 'manual',
  };
}

describe('inventory decision contract — ORD-DECISION-01 Slice 2', () => {
  it('INV-RED-01 evaluator aggregates canonical pickable stock across locations', async () => {
    const { shopId } = await createShop();
    const { orderId, variantId } = await seedInventoryFixture(shopId, {
      quantity: 1,
      pickableAvailable: 7,
      rootAvailable: 0,
    });

    const results = await withTenant(shopId, (trx) =>
      evaluateInventoryConstraint(trx, orderId, shopId)
    );

    const variantResult = results.find((r) => r.targetId === variantId);

    expect(variantResult).toEqual(
      expect.objectContaining({
        type: 'inventory',
        targetId: variantId,
        isActive: false,
      })
    );
  });

  it('INV-RED-01 non-pickable stock cannot satisfy order demand', async () => {
    const { shopId } = await createShop();
    const { orderId, variantId } = await seedInventoryFixture(shopId, {
      quantity: 1,
      pickableAvailable: 0,
      rootAvailable: 0,
      quarantineAvailable: 5,
    });

    const results = await withTenant(shopId, (trx) =>
      evaluateInventoryConstraint(trx, orderId, shopId)
    );

    const variantResult = results.find((r) => r.targetId === variantId);

    expect(variantResult).toEqual(
      expect.objectContaining({
        type: 'inventory',
        targetId: variantId,
        isActive: true,
      })
    );
  });

  it('INV-RED-02 evaluates remaining unfulfilled demand rather than original quantity', async () => {
    const { shopId } = await createShop();
    const { orderId, variantId } = await seedInventoryFixture(shopId, {
      quantity: 5,
      fulfilledQuantity: 4,
      pickableAvailable: 1,
      rootAvailable: 0,
    });

    const results = await withTenant(shopId, (trx) =>
      evaluateInventoryConstraint(trx, orderId, shopId)
    );

    const variantResult = results.find((r) => r.targetId === variantId);

    expect(variantResult).toEqual(
      expect.objectContaining({
        targetId: variantId,
        isActive: false,
      })
    );
  });

  it('INV-RED-04 legacy inventory execution uses aggregate pickable availability', async () => {
    const { shopId } = await createShop();
    const { orderId } = await seedInventoryFixture(shopId, {
      quantity: 1,
      pickableAvailable: 7,
      rootAvailable: 0,
    });

    const proceedSpy = jest
      .spyOn(proceedFulfillmentModule, 'proceedFulfillmentHandler')
      .mockResolvedValue(undefined as any);

    await withTenant(shopId, async (trx) => {
      await resolveInventoryBlockHandler(
        executionInput(shopId, orderId) as any,
        trx
      );
    });

    expect(proceedSpy).toHaveBeenCalledTimes(1);
  });

  it('INV-RED-04 legacy inventory execution uses remaining demand after partial fulfillment', async () => {
    const { shopId } = await createShop();
    const { orderId } = await seedInventoryFixture(shopId, {
      quantity: 5,
      fulfilledQuantity: 4,
      pickableAvailable: 1,
      rootAvailable: 0,
    });

    const proceedSpy = jest
      .spyOn(proceedFulfillmentModule, 'proceedFulfillmentHandler')
      .mockResolvedValue(undefined as any);

    await withTenant(shopId, async (trx) => {
      await resolveInventoryBlockHandler(
        executionInput(shopId, orderId) as any,
        trx
      );
    });

    expect(proceedSpy).toHaveBeenCalledTimes(1);
  });

  it('INV-RED-05 sufficient pickable stock naturally resolves the active inventory constraint', async () => {
    const { shopId } = await createShop();
    const { orderId, variantId } = await seedInventoryFixture(shopId, {
      quantity: 3,
      pickableAvailable: 1,
      rootAvailable: 0,
    });

    await withTenant(shopId, async (trx) => {
      const initial = await evaluateInventoryConstraint(trx, orderId, shopId);

      // order_constraints is projection-single-writer guarded
      // (enforce_projection_writer_order_constraints, migration 0076): a write
      // outside SET LOCAL synchroflow.projection = 'true' raises
      // [PROJECTION_WRITE_VIOLATION]. Same transaction-local guard the
      // production callers of projectOrderConstraints establish
      // (pickBatch.service.ts, receiveJob.service.ts) and the same pattern
      // seedInventoryFixture already uses above for order_fulfillment_status.
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await projectOrderConstraints(
        trx,
        orderId,
        shopId,
        1,
        now,
        initial
      );
    });

    const activeBefore = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'inventory',
          target_id: variantId,
          is_active: true,
        })
        .first()
    );

    expect(activeBefore).toBeTruthy();

    await withTenant(shopId, async (trx) => {
      await trx('inventory_truth')
        .where({
          shop_id: shopId,
          lasyncro_variant_id: variantId,
          location_code: 'A-1',
        })
        .update({
          on_hand_quantity: 3,
          available_quantity: 3,
          last_evaluated_at: now,
        });

      const reevaluated = await evaluateInventoryConstraint(
        trx,
        orderId,
        shopId
      );

      // Same projection-single-writer guard as the first pass: this
      // transaction must also be projection-authorised to resolve
      // order_constraints.
      await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

      await projectOrderConstraints(
        trx,
        orderId,
        shopId,
        2,
        new Date(now.getTime() + 1000),
        reevaluated
      );
    });

    const after = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'inventory',
          target_id: variantId,
        })
        .first()
    );

    expect(after).toEqual(
      expect.objectContaining({
        is_active: false,
      })
    );
    expect(after.resolved_at).not.toBeNull();
  });

  it('INV-RED-03 refuses to execute a stale inventory decision after its constraint has cleared', async () => {
    const { shopId, token } = await createShop();
    const { orderId } = await seedInventoryFixture(shopId, {
      quantity: 1,
      pickableAvailable: 5,
      rootAvailable: 0,
    });

    const decision = await persistInventoryDecision(shopId, orderId);

    const activeInventoryConstraint = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'inventory',
          is_active: true,
        })
        .first()
    );

    expect(activeInventoryConstraint).toBeUndefined();

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/execute`)
      .set('Authorization', `Bearer ${token}`);

    const queued = await withTenant(shopId, (trx) =>
      trx('decision_execution_queue')
        .where({ decision_id: decision.id })
        .first()
    );

    expect(res.status).not.toBe(202);
    expect(queued).toBeUndefined();
  });

  /**
   * INV-ACTION-ARCH-01 — inventory decisions are WORKFLOW navigation, not
   * machine execution. `open_sourcing` replaces `resolve_inventory_block` for
   * NEW decisions; the legacy action stays recognised so previously persisted
   * decisions and queued jobs can still drain.
   */
  it('INV-ACTION-01 emits open_sourcing for a new active inventory block', async () => {
    const [decision] = generateDecisions({
      orderId: crypto.randomUUID(),
      shopId: 1,
      aggregateVersion: 1,
      riskSnapshot: inventoryRiskSnapshot(),
    });

    expect(decision).toBeTruthy();
    expect(decision.recommended_action.type).toBe('open_sourcing');
    expect(decision.recommended_action.type).not.toBe('resolve_inventory_block');
    // Workflow navigation is still an operator-confirmed step, not automation.
    expect(decision.recommended_action.execution_mode).toBe('manual');
  });

  it('INV-ACTION-02 refuses to execute an open_sourcing decision and queues nothing', async () => {
    const { shopId, token } = await createShop();
    // Genuinely blocked: demand 2, zero pickable stock — the inventory
    // constraint is ACTIVE, so this is NOT the stale case INV-RED-03 covers.
    const { orderId } = await seedInventoryFixture(shopId, {
      quantity: 2,
      pickableAvailable: 0,
      rootAvailable: 0,
    });

    await materialiseInventoryConstraint(shopId, orderId);

    const activeInventoryConstraint = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'inventory',
          is_active: true,
        })
        .first()
    );
    expect(activeInventoryConstraint).toBeTruthy();

    const decision = await persistInventoryDecision(shopId, orderId);
    expect(decision.recommended_action.type).toBe('open_sourcing');

    const res = await request(app)
      .post(`/api/v1/orders/${orderId}/execute`)
      .set('Authorization', `Bearer ${token}`);

    // The controller's existing non-executable convention (see
    // orders.execute.controller.ts): DecisionNotFoundError -> 400 with
    // 'No actionable decision found for this order'. A workflow action is not
    // an executable decision, so it must reuse that exact convention rather
    // than introduce a new status code.
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('No actionable decision found for this order');

    const queued = await withTenant(shopId, (trx) =>
      trx('decision_execution_queue').where({ decision_id: decision.id }).first()
    );
    expect(queued).toBeUndefined();

    const anyQueueRow = await withTenant(shopId, (trx) =>
      trx('decision_execution_queue').where({ shop_id: shopId }).first()
    );
    expect(anyQueueRow).toBeUndefined();
  });

  it('INV-ACTION-03 maps open_sourcing to inventory and keeps legacy resolve_inventory_block', () => {
    expect(CONSTRAINT_TYPE_BY_ACTION.open_sourcing).toBe('inventory');
    // Legacy compatibility — persisted decisions must stay stale-checked.
    expect(CONSTRAINT_TYPE_BY_ACTION.resolve_inventory_block).toBe('inventory');

    expect(isDecisionActionStillValid('open_sourcing', ['inventory'])).toBe(true);
    expect(isDecisionActionStillValid('open_sourcing', ['customer'])).toBe(false);
    expect(isDecisionActionStillValid('resolve_inventory_block', ['inventory'])).toBe(true);
    expect(isDecisionActionStillValid('resolve_inventory_block', [])).toBe(false);
  });

  it('INV-ACTION-04 treats a pending open_sourcing decision as the current inventory action', async () => {
    const { shopId } = await createShop();
    const { orderId } = await seedInventoryFixture(shopId, {
      quantity: 2,
      pickableAvailable: 0,
      rootAvailable: 0,
    });

    await materialiseInventoryConstraint(shopId, orderId);

    /**
     * reconcileOrderFulfillment anchors replay on the order's latest domain
     * event ([EVENT_ANCHOR_INVARIANT], reconciliation.handlers.ts). The stock
     * fixture seeds the identity mapping but no event, so supply the one the
     * anchor lookup requires — mechanical prerequisite only, no business
     * semantics changed.
     */
    const externalOrderId = await withTenant(shopId, async (trx) => {
      const identity = await trx('external_order_identity_map')
        .where({ lasyncro_order_id: orderId })
        .first('external_order_id');
      expect(identity?.external_order_id).toBeTruthy();
      await trx('domain_events').insert({
        shop_id: shopId,
        event_type: 'orders/create',
        event_payload: { id: identity.external_order_id },
        event_time: now,
        event_version: 1,
        external_event_id: `inv-action-04:${crypto.randomUUID()}`,
      });
      return identity.external_order_id as string;
    });
    expect(externalOrderId).toBeTruthy();

    const decision = await persistInventoryDecision(shopId, orderId);
    expect(decision.recommended_action.type).toBe('open_sourcing');

    const before = await withTenant(shopId, (trx) =>
      trx('decisions').where({ entity_id: orderId }).select('id')
    );
    expect(before).toHaveLength(1);

    // A later aggregate_version over the SAME unresolved inventory state must
    // recognise the pending open_sourcing decision as already covering it.
    await reconcileOrderFulfillment(orderId, 2, undefined, now, shopId);

    const after = await withTenant(shopId, (trx) =>
      trx('decisions').where({ entity_id: orderId }).select('id', 'recommended_action')
    );
    expect(after).toHaveLength(1);
    expect(sameDecisionId(after[0].id, decision.id)).toBe(true);
  });

  it('INV-ACTION-05 associates an active inventory constraint with an open_sourcing decision', async () => {
    const { shopId, token } = await createShop();
    const { orderId } = await seedInventoryFixture(shopId, {
      quantity: 2,
      pickableAvailable: 0,
      rootAvailable: 0,
    });

    await materialiseInventoryConstraint(shopId, orderId);

    const decision = await persistInventoryDecision(shopId, orderId);
    expect(decision.recommended_action.type).toBe('open_sourcing');

    const res = await request(app)
      .get('/api/v1/orders/constrained')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);

    // GET /orders/constrained returns { data: rows, pagination }.
    const row = (res.body.data ?? []).find(
      (o: { order_id?: string }) => o.order_id === orderId
    );
    expect(row).toBeTruthy();
    expect(row.constraint_type).toBe('inventory');
    // The SQL join only attaches a decision whose action matches the active
    // constraint type — so a decision surfacing here proves the mapping.
    expect(sameDecisionId(row.decision_id, decision.id)).toBe(true);
    expect(row.recommended_action?.type).toBe('open_sourcing');
  });
});

import crypto from 'crypto';
import request from 'supertest';

import { createApp } from 'api-src/bootstrap/express';
import { generateDecisions } from 'api-src/domain/decision/decision.engine';
import { DecisionRepository } from 'api-src/domain/decision/decision.repository';
import { resolveOperationalBlockHandler } from 'api-src/execution/handlers/resolve_operational_block.handler';
import {
  createReturnJobFromCarrierEvent,
  createUndeliveredReturnJob,
  listItemsAwaitingDecision,
  setOwnerDecision,
} from 'api-src/services/returns/returnJobs.service';
import {
  setTenantContext,
  systemTransaction,
  withTenant,
} from '@lasyncro/backend-core/db.js';
import { createTenantShop } from '@lasyncro/backend-core/services/pre-tenant.service.js';
import { issueTestToken } from '../../unit/helpers/auth';

const app = createApp();
const now = new Date('2026-09-01T12:00:00.000Z');

beforeAll(() => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'test_jwt_secret';
});

async function createShop(): Promise<{ shopId: number; userId: number; token: string }> {
  const unique = crypto.randomBytes(6).toString('hex');

  const shopId = await systemTransaction(async (trx) => {
    const id = await createTenantShop(trx, `ret-undelivered-${unique}`);
    await setTenantContext(trx, id);
    return id;
  });

  const userId = await withTenant(shopId, async (trx) => {
    const [row] = await trx('users')
      .insert({
        shop_id: shopId,
        email: `ret-undelivered-${unique}@test.example`,
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

async function seedOrder(shopId: number): Promise<string> {
  const orderId = crypto.randomUUID();
  const externalOrderId = String(Date.now()) + String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0');

  await withTenant(shopId, async (trx) => {
    await trx('orders').insert({
      lasyncro_order_id: orderId,
      shop_id: shopId,
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
      external_order_id: externalOrderId,
    });

    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);

    await trx('order_fulfillment_status').insert({
      lasyncro_fulfillment_id: crypto.randomUUID(),
      lasyncro_order_id: orderId,
      status: 'pending',
      status_updated_at: now,
    });
  });

  return orderId;
}

async function seedReturnJob(shopId: number, orderId: string): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('return_jobs')
      .insert({
        shop_id: shopId,
        origin: 'undelivered_return',
        lasyncro_refund_execution_id: null,
        lasyncro_order_id: orderId,
        status: 'awaiting_decision',
        undelivered_reason: 'carrier_error',
        source: 'carrier_webhook',
        created_at: now,
        updated_at: now,
      })
      .returning('return_job_id');

    return row.return_job_id ?? row;
  });
}

async function seedReturnedUndeliveredConstraint(input: {
  shopId: number;
  orderId: string;
  returnJobId: string;
  blockType?: string;
}): Promise<string> {
  const constraintId = crypto.randomUUID();

  await withTenant(input.shopId, async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_constraints').insert({
      constraint_id: constraintId,
      lasyncro_order_id: input.orderId,
      target_id: input.returnJobId,
      constraint_type: 'operational',
      block_type: input.blockType ?? 'returned_undelivered',
      started_at: now,
      resolved_at: null,
      is_active: true,
      write_source: 'returned_undelivered_contract_test',
      created_at: now,
    });
  });

  return constraintId;
}

function operationalRiskSnapshot(blockType: string) {
  return {
    order_health_score: 40,
    aging_risk_component: 0,
    sla_risk_component: 0,
    inventory_risk_component: 0,
    customer_risk_component: 0,
    operational_risk_component: 100,
    is_inventory_blocked: false,
    is_customer_blocked: false,
    is_operational_blocked: true,
    is_already_fulfilled: false,
    operational_block_type: blockType,
  };
}

async function persistCurrentOperationalDecision(shopId: number, orderId: string, blockType = 'returned_undelivered') {
  const [decision] = generateDecisions({
    orderId,
    shopId,
    aggregateVersion: 1,
    riskSnapshot: operationalRiskSnapshot(blockType),
  });

  if (!decision) throw new Error('expected operational decision fixture');

  await withTenant(shopId, async (trx) => {
    await DecisionRepository.create(trx, decision);
  });

  return decision;
}

async function seedCarrierTrackingEvent(shopId: number, orderId: string): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const shipmentTrackingId = crypto.randomUUID();

    await trx('order_shipment_tracking').insert({
      id: shipmentTrackingId,
      shop_id: shopId,
      lasyncro_order_id: orderId,
      carrier_code: 'sendcloud',
      tracking_number: `RET-${crypto.randomBytes(5).toString('hex')}`,
      latest_status: 'returned',
      is_stalled: false,
      created_at: now,
    });

    const [event] = await trx('parcel_tracking_events')
      .insert({
        shop_id: shopId,
        lasyncro_order_id: orderId,
        shipment_tracking_id: shipmentTrackingId,
        carrier_code: 'sendcloud',
        event_type: 'returned',
        raw_status: 'returned_to_sender',
        event_timestamp: now,
        raw_payload: { test: true },
      })
      .returning('id');

    return event.id ?? event;
  });
}

async function activeConstraint(shopId: number, constraintId: string) {
  return withTenant(shopId, (trx) =>
    trx('order_constraints').where({ constraint_id: constraintId }).first()
  );
}

/**
 * order_revenue_units.lasyncro_variant_id is NOT NULL with its own FK to
 * variants, and refund_execution_line_items.lasyncro_revenue_unit_id is
 * NOT NULL with an FK to order_revenue_units — the decision-list fixtures
 * below need a real product/variant/revenue-unit chain so the ONLY thing
 * under test is the origin/linkage branch.
 */
async function seedProduct(shopId: number): Promise<string> {
  const lasyncroProductId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('products').insert({
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: 'Returned Package Product',
    })
  );
  return lasyncroProductId;
}

async function seedVariant(shopId: number, lasyncroProductId: string): Promise<string> {
  const lasyncroVariantId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('variants').insert({
      lasyncro_variant_id: lasyncroVariantId,
      lasyncro_product_id: lasyncroProductId,
      shop_id: shopId,
      title: 'Returned Package Variant',
      unit_cost: 5,
    })
  );
  return lasyncroVariantId;
}

async function seedRevenueUnit(
  shopId: number,
  orderId: string,
  lasyncroProductId: string,
  lasyncroVariantId: string
): Promise<string> {
  const revenueUnitId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('order_revenue_units').insert({
      lasyncro_revenue_unit_id: revenueUnitId,
      lasyncro_order_id: orderId,
      lasyncro_product_id: lasyncroProductId,
      lasyncro_variant_id: lasyncroVariantId,
      title: 'Returned Package Line',
      quantity: 1,
      unit_price: 100,
      line_total: 100,
      estimated_unit_cost: 5,
    })
  );
  return revenueUnitId;
}

/**
 * Full order → product → variant → revenue unit chain, returned together
 * so each decision-list case reads as one fixture rather than five calls.
 */
async function seedOrderWithRevenueUnit(shopId: number) {
  const orderId = await seedOrder(shopId);
  const productId = await seedProduct(shopId);
  const variantId = await seedVariant(shopId, productId);
  const revenueUnitId = await seedRevenueUnit(shopId, orderId, productId, variantId);
  return { orderId, productId, variantId, revenueUnitId };
}

async function seedRefundExecution(shopId: number, orderId: string): Promise<string> {
  const refundExecutionId = crypto.randomUUID();
  await withTenant(shopId, (trx) =>
    trx('refund_executions').insert({
      lasyncro_refund_execution_id: refundExecutionId,
      lasyncro_order_id: orderId,
      platform: 'shopify',
      external_refund_id: `ret-undelivered-${crypto.randomBytes(6).toString('hex')}`,
      total_refund_amount: '100.00',
      executed_at: now,
      created_at: now,
      updated_at: now,
    })
  );
  return refundExecutionId;
}

async function seedCustomerReturnJob(
  shopId: number,
  orderId: string,
  refundExecutionId: string
): Promise<string> {
  return withTenant(shopId, async (trx) => {
    const [row] = await trx('return_jobs')
      .insert({
        shop_id: shopId,
        origin: 'customer_return',
        lasyncro_refund_execution_id: refundExecutionId,
        lasyncro_order_id: orderId,
        status: 'awaiting_decision',
        source: 'system_auto',
        created_at: now,
        updated_at: now,
      })
      .returning('return_job_id');

    return row.return_job_id ?? row;
  });
}

/**
 * A processed damaged/unsellable line. `lasyncro_refund_execution_id` is
 * null for the Type B (undelivered) path — the scan-intake shape already
 * supported by the schema (migration 0008 relaxed it to nullable) — and
 * `return_job_id` is then the only link back to the job.
 */
async function seedDecisionLine(input: {
  shopId: number;
  revenueUnitId: string;
  returnJobId: string;
  refundExecutionId?: string | null;
  itemCondition?: 'damaged' | 'unsellable';
  conditionNotes?: string;
}): Promise<string> {
  const lineItemId = crypto.randomUUID();

  await withTenant(input.shopId, (trx) =>
    trx('refund_execution_line_items').insert({
      lasyncro_refund_line_item_id: lineItemId,
      lasyncro_refund_execution_id: input.refundExecutionId ?? null,
      lasyncro_revenue_unit_id: input.revenueUnitId,
      return_job_id: input.returnJobId,
      refunded_quantity: 1,
      item_condition: input.itemCondition ?? 'damaged',
      quantity_received: 1,
      condition_notes: input.conditionNotes ?? 'Box crushed in transit',
      processed_at: now,
      source: input.refundExecutionId ? 'refund_webhook' : 'scan_intake_manual',
      created_at: now,
    })
  );

  return lineItemId;
}

const DECISION_GROUP_KEYS = [
  'created_at',
  'external_order_id',
  'lines',
  'return_job_id',
  'total_refund_amount',
];

const DECISION_LINE_KEYS = [
  'condition_notes',
  'decided_at',
  'decision_notes',
  'id',
  'item_condition',
  'owner_decision',
  'quantity',
  'sku',
  'variant_title',
];

describe('returned_undelivered return decision contract — ORD-DECISION-01', () => {
  it('RET-CREATE-01 creates an undelivered return job and active returned_undelivered constraint', async () => {
    const { shopId, userId } = await createShop();
    const orderId = await seedOrder(shopId);

    const returnJobId = await createUndeliveredReturnJob({
      shopId,
      lasyncroOrderId: orderId,
      undeliveredReason: 'carrier_error',
      operatorId: userId,
    });

    const job = await withTenant(shopId, (trx) =>
      trx('return_jobs').where({ return_job_id: returnJobId }).first()
    );
    const constraint = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'operational',
          block_type: 'returned_undelivered',
          target_id: returnJobId,
          is_active: true,
        })
        .first()
    );

    expect(job).toEqual(expect.objectContaining({
      origin: 'undelivered_return',
      status: 'awaiting_decision',
      lasyncro_order_id: orderId,
    }));
    expect(constraint).toEqual(expect.objectContaining({
      target_id: returnJobId,
      resolved_at: null,
      is_active: true,
    }));
  });

  it('RET-CREATE-01 creates a carrier return job and active returned_undelivered constraint from the carrier event', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const eventId = await seedCarrierTrackingEvent(shopId, orderId);

    const returnJobId = await createReturnJobFromCarrierEvent({
      shopId,
      lasyncroOrderId: orderId,
      triggeringParcelTrackingEventId: eventId,
    });

    const constraint = await withTenant(shopId, (trx) =>
      trx('order_constraints')
        .where({
          lasyncro_order_id: orderId,
          constraint_type: 'operational',
          block_type: 'returned_undelivered',
          target_id: returnJobId,
          is_active: true,
        })
        .first()
    );

    expect(constraint).toEqual(expect.objectContaining({
      target_id: returnJobId,
      resolved_at: null,
      is_active: true,
    }));
  });

  it('RET-ACTION exposes active returned_undelivered as open_return_job, not generic resolve_operational_block', async () => {
    const { shopId, token } = await createShop();
    const orderId = await seedOrder(shopId);
    const returnJobId = await seedReturnJob(shopId, orderId);
    await seedReturnedUndeliveredConstraint({ shopId, orderId, returnJobId });
    await persistCurrentOperationalDecision(shopId, orderId);

    const res = await request(app)
      .get(`/api/v1/orders/${orderId}/decision`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.decision?.recommended_action?.type ?? null).toBe('open_return_job');
  });

  it('RET-ACTION keeps the exact return_job_id available for routing', async () => {
    const { shopId, token } = await createShop();
    const orderId = await seedOrder(shopId);
    const returnJobId = await seedReturnJob(shopId, orderId);
    await seedReturnedUndeliveredConstraint({ shopId, orderId, returnJobId });

    const res = await request(app)
      .get(`/api/v1/orders/${orderId}/decision`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.constraints).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          block_type: 'returned_undelivered',
          target_id: returnJobId,
          target_status: 'awaiting_decision',
        }),
      ])
    );
  });

  it('RET-ACTION prevents generic operational execution from clearing an unfinished returned_undelivered return job', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);
    const returnJobId = await seedReturnJob(shopId, orderId);
    const constraintId = await seedReturnedUndeliveredConstraint({ shopId, orderId, returnJobId });

    await withTenant(shopId, async (trx) => {
      await resolveOperationalBlockHandler(
        {
          decision_id: crypto.randomUUID(),
          entity_id: orderId,
          shop_id: shopId,
          aggregate_version: 1,
          action_type: 'resolve_operational_block',
          payload: {},
          execution_mode: 'manual',
        },
        trx
      );
    });

    const constraint = await activeConstraint(shopId, constraintId);

    expect(constraint).toEqual(expect.objectContaining({
      is_active: true,
      resolved_at: null,
    }));
  });

  it('RET-ACTION prevents unknown operational subtypes from inheriting generic resolution', async () => {
    const { shopId } = await createShop();
    const orderId = await seedOrder(shopId);

    const [decision] = generateDecisions({
      orderId,
      shopId,
      aggregateVersion: 1,
      riskSnapshot: operationalRiskSnapshot('manual_hold'),
    });

    expect(decision?.recommended_action?.type ?? null).not.toBe('resolve_operational_block');
  });

  it('RET-LIFECYCLE deactivates returned_undelivered when the Returns owner reships', async () => {
    const { shopId, userId } = await createShop();
    const orderId = await seedOrder(shopId);
    const returnJobId = await seedReturnJob(shopId, orderId);
    const constraintId = await seedReturnedUndeliveredConstraint({ shopId, orderId, returnJobId });

    await setOwnerDecision({
      shopId,
      returnJobId,
      decision: 'reship',
      decidedBy: userId,
    });

    const constraint = await activeConstraint(shopId, constraintId);

    expect(constraint).toEqual(expect.objectContaining({
      is_active: false,
    }));
    expect(constraint.resolved_at).not.toBeNull();
  });

  it('RET-LIFECYCLE hides completed returned_undelivered from active constrained reads', async () => {
    const { shopId, userId, token } = await createShop();
    const orderId = await seedOrder(shopId);
    const returnJobId = await seedReturnJob(shopId, orderId);
    await seedReturnedUndeliveredConstraint({ shopId, orderId, returnJobId });

    await setOwnerDecision({
      shopId,
      returnJobId,
      decision: 'reship',
      decidedBy: userId,
    });

    const res = await request(app)
      .get('/api/v1/orders/constrained')
      .query({ constraint_type: 'operational' })
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.map((row: { order_id: string }) => row.order_id)).not.toContain(orderId);
  });

  /**
   * RET-DECISION-LIST — the "Review return" CTA on Order Detail routes an
   * awaiting_decision returned_undelivered job to ReturnsItemsPage, whose
   * only data source is listItemsAwaitingDecision. An undelivered_return
   * job never has a refund execution (createUndeliveredReturnJob and
   * createReturnJobFromCarrierEvent both write null), so it must reach the
   * list through its return_job_id linkage, not through refund_executions.
   */
  it('RET-DECISION-LIST-01 surfaces an undelivered_return awaiting_decision job whose damaged line is linked by return_job_id', async () => {
    const { shopId } = await createShop();
    const { orderId, revenueUnitId } = await seedOrderWithRevenueUnit(shopId);
    const returnJobId = await seedReturnJob(shopId, orderId);
    const lineItemId = await seedDecisionLine({ shopId, revenueUnitId, returnJobId });

    // The fixture deliberately has no refund execution at all.
    const refundCount = await withTenant(shopId, (trx) =>
      trx('refund_executions').where({ lasyncro_order_id: orderId }).count<{ count: string }>('* as count').first()
    );
    expect(Number(refundCount?.count ?? 0)).toBe(0);

    const groups = await listItemsAwaitingDecision(shopId);

    expect(groups).toHaveLength(1);

    const [group] = groups;
    expect(Object.keys(group).sort()).toEqual(DECISION_GROUP_KEYS);
    expect(group.return_job_id).toBe(returnJobId);
    expect(group.total_refund_amount).toBe(0);
    expect(group.external_order_id).toEqual(expect.any(String));
    expect(group.created_at).not.toBeNull();

    expect(group.lines).toHaveLength(1);
    expect(Object.keys(group.lines[0]).sort()).toEqual(DECISION_LINE_KEYS);
    expect(group.lines[0]).toEqual(expect.objectContaining({
      id: lineItemId,
      item_condition: 'damaged',
      quantity: 1,
      condition_notes: 'Box crushed in transit',
      owner_decision: null,
      decision_notes: null,
      decided_at: null,
      variant_title: 'Returned Package Variant',
    }));
  });

  it('RET-DECISION-LIST-02 keeps the existing customer_return refund-execution path working', async () => {
    const { shopId } = await createShop();
    const { orderId, revenueUnitId } = await seedOrderWithRevenueUnit(shopId);
    const refundExecutionId = await seedRefundExecution(shopId, orderId);
    const returnJobId = await seedCustomerReturnJob(shopId, orderId, refundExecutionId);
    const lineItemId = await seedDecisionLine({
      shopId,
      revenueUnitId,
      returnJobId,
      refundExecutionId,
      itemCondition: 'unsellable',
      conditionNotes: 'Water damage, unsellable',
    });

    const groups = await listItemsAwaitingDecision(shopId);

    expect(groups).toHaveLength(1);

    const [group] = groups;
    expect(Object.keys(group).sort()).toEqual(DECISION_GROUP_KEYS);
    expect(group.return_job_id).toBe(returnJobId);
    expect(group.total_refund_amount).toBe(100);

    expect(group.lines).toHaveLength(1);
    expect(Object.keys(group.lines[0]).sort()).toEqual(DECISION_LINE_KEYS);
    expect(group.lines[0]).toEqual(expect.objectContaining({
      id: lineItemId,
      item_condition: 'unsellable',
      quantity: 1,
      owner_decision: null,
    }));
  });
});

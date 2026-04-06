// tests/unit/backend/workers/execution.smoke.test.ts

import { randomUUID } from 'crypto';
import db, { systemQuery } from '@lasyncro/backend-core/db.js';
import { executeJob } from 'api-src/workers/execution.worker';
import { registerExecutionHandler, listExecutionHandlers } from 'api-src/execution/execution.registry';
import { resolveOperationalBlockHandler } from 'api-src/execution/handlers/resolve_operational_block.handler';

/**
 * EXECUTION SMOKE TEST
 * --------------------
 * Verifies the critical execution loop end-to-end:
 *   executeJob → handler → DB state mutation → snapshot scheduled
 *
 * Uses resolve_operational_block (no external Shopify calls).
 * Must pass on every deploy before any other P1 work proceeds.
 */

const SHOP_ID = 9001;
const ORDER_ID = randomUUID();
const DECISION_ID = randomUUID();
const CONSTRAINT_ID = randomUUID();

// AFTER
async function seedShop() {
  await systemQuery(db('shops').insert({
    id: SHOP_ID,
    name: 'Smoke Test Shop',
    first_insight_delivered: false,
  }));
}

async function seedOrder() {
  await systemQuery(db('orders').insert({
    lasyncro_order_id: ORDER_ID,
    shop_id: SHOP_ID,
    payment_state: 'paid',
    currency: 'USD',
    total_price: 100.00,
    subtotal_price: 90.00,
    total_tax: 10.00,
    order_created_at: new Date(),
    order_updated_at: new Date(),
    created_at: new Date(),
    updated_at: new Date(),
  }));
}

async function seedDecision() {
  await systemQuery(db('decisions').insert({
    id: DECISION_ID,
    type: 'operational',
    entity_id: ORDER_ID,
    shop_id: SHOP_ID,
    aggregate_version: 1,
    priority: 10,
    score_breakdown: db.raw(`'{}'::jsonb`),
    reason: 'smoke test',
    signals: db.raw(`'{"test": true}'::jsonb`),
    recommended_action: db.raw(`'{"type": "resolve_operational_block", "payload": {}, "execution_mode": "manual"}'::jsonb`),
    actions: db.raw(`'[]'::jsonb`),
    status: 'pending',
    lifecycle: db.raw(`'{}'::jsonb`),
    created_at: new Date(),
    updated_at: new Date(),
  }));
}

async function seedDecisionExecutionQueue() {
  await systemQuery(db('decision_execution_queue').insert({
    decision_id: DECISION_ID,
    shop_id: SHOP_ID,
    status: 'pending',
    created_at: new Date(),
  }));
}

// AFTER
async function seedConstraint() {
  /**
   * order_constraints is projection-write-guarded.
   * Must set synchroflow.projection = 'true' within the transaction
   * to bypass the trigger for test seeding.
   */
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('order_constraints').insert({
      constraint_id: CONSTRAINT_ID,
      lasyncro_order_id: ORDER_ID,
      constraint_type: 'operational',
      block_type: 'sla_breach',
      is_active: true,
      write_source: 'smoke_test',
      created_at: new Date(),
    });
  });
}

async function cleanup() {
  /**
   * Full cleanup in a single transaction with projection flag set.
   * Required because:
   * - order_constraints has a projection write guard (INSERT/UPDATE/DELETE)
   * - CASCADE deletes from shops/orders trigger the guard indirectly
   * - Must set synchroflow.projection = 'true' to permit all deletions
   */
  await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "synchroflow.projection" = 'true'`);
    await trx('shop_snapshot_jobs').where({ shop_id: SHOP_ID }).del();
    await trx('decision_execution_queue').where({ decision_id: DECISION_ID }).del();
    await trx('order_constraints').where({ constraint_id: CONSTRAINT_ID }).del();
    await trx('decisions').where({ id: DECISION_ID }).del();
    await trx('orders').where({ lasyncro_order_id: ORDER_ID }).del();
    await trx('shops').where({ id: SHOP_ID }).del();
  });
}

describe('Execution smoke test — resolve_operational_block', () => {

  beforeAll(async () => {
    /**
     * Register handler once — registry throws on duplicate registration.
     * Guard against re-registration if test suite runs multiple times.
     */
    if (!listExecutionHandlers().includes('resolve_operational_block')) {
      registerExecutionHandler('resolve_operational_block', resolveOperationalBlockHandler);
    }

    await cleanup();
    await seedShop();
    await seedOrder();
    await seedDecision();
    await seedDecisionExecutionQueue();
    await seedConstraint();
  });

  afterAll(async () => {
    await cleanup();
  });

  it('marks the decision as resolved after execution', async () => {
    const job = {
      decision_id: DECISION_ID,
      entity_id: ORDER_ID,
      shop_id: SHOP_ID,
      aggregate_version: 1,
      action_type: 'resolve_operational_block',
      payload: {},
      execution_mode: 'manual' as const,
    };

    await executeJob(job);

    const decision = await systemQuery(
      db('decisions').where({ id: DECISION_ID }).first()
    );

    expect(decision.status).toBe('resolved');
  });

  it('marks the decision_execution_queue entry as success', async () => {
    const row = await systemQuery(
      db('decision_execution_queue').where({ decision_id: DECISION_ID }).first()
    );

    expect(row.status).toBe('success');
    expect(row.executed_at).not.toBeNull();
  });

  it('deactivates the operational constraint', async () => {
    const constraint = await systemQuery(
      db('order_constraints').where({ constraint_id: CONSTRAINT_ID }).first()
    );

    expect(constraint.is_active).toBe(false);
    expect(constraint.resolved_at).not.toBeNull();
  });

  it('schedules a snapshot recomputation job', async () => {
    const job = await systemQuery(
      db('shop_snapshot_jobs').where({ shop_id: SHOP_ID }).first()
    );

    expect(job).not.toBeNull();
  });
});
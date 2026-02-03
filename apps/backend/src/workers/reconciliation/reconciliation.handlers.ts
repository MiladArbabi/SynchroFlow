// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts

import db from 'api-src/db';
import { ReconciliationResult } from './reconciliation.types';
import { writeOrderRevenueUnits } from './revenue-units.writer';
import { evaluateCustomerObligations } from
  'api-src/services/order-execution-intelligence/customerObligation.evaluator';

type ObservedExecution = {
  status: 'delivered';
  received_at: Date;
};

export async function reconcileOrderFulfillment(
  canonicalOrderId: string,
  observed?: {
    status: 'delivered';
    observedAt: Date;
    source: 'shopify_sync';
  }
): Promise<ReconciliationResult> {

  // Fetch canonical order
  const order = await db('canonical_orders')
    .where({ canonical_order_id: canonicalOrderId })
    .first();

  console.log('[RECON][DEBUG] lookup', {
    canonicalOrderId,
    found: !!order,
    row: order ?? null,
  });

  if (!order) {
    // Hard stop — invalid input
    throw new Error(`Canonical order not found: ${canonicalOrderId}`);
  }

  // Observed execution from sync or webhook ALWAYS wins
  if (observed?.status === 'delivered') {
    await db('order_fulfillment_status')
      .insert({
        canonical_order_id: canonicalOrderId,
        shop_id: order.shop_id,
        order_id: order.platform_order_id,
        status: 'delivered',
        status_updated_at: observed.observedAt,
        execution_source: 'observed',
        execution_confidence: 'certain',
      })
      .onConflict(['shop_id', 'canonical_order_id'])
      .merge({
        status: 'delivered',
        status_updated_at: observed.observedAt,
        execution_source: 'observed',
        execution_confidence: 'certain',
      });

    return 'observed';
  }

  // Check existing execution
  const existing = await db('order_fulfillment_status')
    .where({ canonical_order_id: canonicalOrderId })
    .first();

  if (existing && existing.execution_source === 'observed') {
    return 'noop';
  }

  if (existing && existing.execution_source === 'synthetic') {
    await db('order_fulfillment_status')
        .where({ canonical_order_id: canonicalOrderId })
        .delete();
  }

  // 3. Insert synthetic execution
  await db('order_fulfillment_status').insert({
    canonical_order_id: order.canonical_order_id,
    order_id: order.platform_order_id,
    shop_id: order.shop_id,

    status: 'processing',
    status_updated_at: order.order_created_at,

    execution_source: 'synthetic',
    execution_confidence: 'assumed',
    /* synthetic_reason: 'missing_fulfillment_execution', */
    // synthetic_created_at intentionally omitted
  });

  // 4. Materialize revenue units (Customer Obligation v3 boundary)
  await writeOrderRevenueUnits(order.shop_id, order.canonical_order_id);

  // Customer Obligation v3 — explicit evaluation boundary
  await evaluateCustomerObligations(
    order.shop_id,
    order.canonical_order_id
  );

  return 'synthetic';
}
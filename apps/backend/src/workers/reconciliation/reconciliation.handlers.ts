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
  canonicalOrderId: string
): Promise<ReconciliationResult> {

    // 0. Check for VERIFIED observed fulfillment via webhook ledger
  const observed = await db('integration_webhook_events')
    .select('payload', 'received_at')
    .where({
      integration: 'shopify',
      verified: true,
    })
    .whereIn('event_type', [
      'orders/fulfilled',
      'fulfillments/create',
      'fulfillments/update',
    ])
    .andWhereRaw(
      `(payload->>'order_id') = ? OR (payload->>'order_id') = ?`,
      [
        canonicalOrderId,
        canonicalOrderId.replace('gid://shopify/Order/', ''),
      ]
    )
    .orderBy('received_at', 'desc')
    .first<ObservedExecution | undefined>();

    if (observed) {
    const order = await db('canonical_orders')
      .where({ canonical_order_id: canonicalOrderId })
      .first();

    if (!order) {
      throw new Error(`Canonical order not found for observed execution: ${canonicalOrderId}`);
    }

    await db('order_fulfillment_status')
      .insert({
        canonical_order_id: canonicalOrderId,
        shop_id: order.shop_id,
        order_id: order.platform_order_id,

        status: 'delivered',
        status_updated_at: observed.received_at,
        execution_source: 'observed',
        execution_confidence: 'certain',
      })
      .onConflict(['canonical_order_id'])
      .merge({
        shop_id: order.shop_id,
        order_id: order.platform_order_id,

        status: 'delivered',
        status_updated_at: observed.received_at,
        execution_source: 'observed',
        execution_confidence: 'certain',
      });

    return 'observed';
  }

  // 1. Check existing execution
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

  // 2. Fetch canonical order
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
// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts

import db from 'api-src/db';
import { ReconciliationResult } from './reconciliation.types';

export async function reconcileOrderFulfillment(
  canonicalOrderId: string
): Promise<ReconciliationResult> {

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

  if (!order) {
    // Hard stop — invalid input
    throw new Error(`Canonical order not found: ${canonicalOrderId}`);
  }

  // 3. Insert synthetic execution
  await db('order_fulfillment_status').insert({
    canonical_order_id: order.canonical_order_id,
    order_id: order.platform_order_id,
    shop_id: order.shop_id,

    status: 'processing', // MUST be allowed by CHECK constraint
    status_updated_at: order.order_created_at,

    execution_source: 'synthetic',
    execution_confidence: 'assumed',
    synthetic_reason: 'missing_fulfillment_execution',
    synthetic_created_at: db.fn.now(),
  });

  return 'synthetic';
}
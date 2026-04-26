/**
 * resolve_inventory_block HANDLER (PP1-03)
 * -----------------------------------------
 * Called when an operator manually triggers execution on an
 * inventory-blocked order.
 *
 * Strategy:
 * 1. Check inventory_truth for all variants on this order
 * 2. If ALL variants have sufficient stock → delegate to proceed_fulfillment
 * 3. If ANY variant is still out of stock → fire stockout_risk alert per variant
 *
 * IMPORTANT:
 * - execution_mode is 'manual' in the decision engine — this handler
 *   is only reached via explicit operator action, never automated.
 * - Delegation to proceed_fulfillment reuses its full idempotency
 *   and Shopify execution pipeline — no duplication.
 */

import db from '@lasyncro/backend-core/db.js';
import { ExecutionHandler } from '../execution.registry.js';
import { proceedFulfillmentHandler } from './proceed_fulfillment.handler.js';

export const resolveInventoryBlockHandler: ExecutionHandler = async (job, trx) => {
  const dbx = (trx ?? db) as typeof db;

  console.info('[RESOLVE_INVENTORY_BLOCK_START]', {
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    shop_id: job.shop_id,
  });

  /**
   * STEP 1 — FETCH ORDER LINE ITEMS WITH INVENTORY TRUTH
   * -----------------------------------------------------
   * Join order_line_items → inventory_truth to get current
   * available_quantity per variant on this order.
   */
  const lineItems = await dbx('order_line_items as oli')
    .leftJoin('inventory_truth as it', (join) => {
      join
        .on('it.lasyncro_variant_id', 'oli.lasyncro_variant_id')
        .andOnVal('it.shop_id', job.shop_id);
    })
    .leftJoin('variants as v', 'v.lasyncro_variant_id', 'oli.lasyncro_variant_id')
    .where('oli.lasyncro_order_id', job.entity_id)
    .select(
      'oli.lasyncro_variant_id',
      'oli.quantity',
      'v.sku',
      'v.title',
      'v.unit_cost',
      dbx.raw('COALESCE(it.available_quantity, 0) as available_quantity'),
    );

  if (lineItems.length === 0) {
    console.warn('[RESOLVE_INVENTORY_BLOCK_NO_LINE_ITEMS]', {
      decision_id: job.decision_id,
      entity_id: job.entity_id,
    });
    return;
  }

  /**
   * STEP 2 — CLASSIFY VARIANTS
   * ---------------------------
   * Sufficient = available_quantity >= quantity ordered.
   * Any shortage blocks fulfillment.
   */
  const shortages = lineItems.filter(
    (li: any) => Number(li.available_quantity) < Number(li.quantity)
  );

  const allStocked = shortages.length === 0;

  if (allStocked) {
    /**
     * STEP 3a — STOCK AVAILABLE: delegate to fulfillment
     * ---------------------------------------------------
     * All variants have sufficient stock. Proceed with fulfillment
     * using the existing handler — preserves full idempotency pipeline.
     */
    console.info('[RESOLVE_INVENTORY_BLOCK_STOCK_AVAILABLE]', {
      decision_id: job.decision_id,
      entity_id: job.entity_id,
      line_item_count: lineItems.length,
    });

    await proceedFulfillmentHandler(job, trx);
    return;
  }

  /**
   * STEP 3b — STILL OUT OF STOCK: fire stockout_risk alert per variant
   * -------------------------------------------------------------------
   * Operator needs to know which specific variants are blocking.
   * Upserts follow the canonical alert pattern — idempotent on alert_key.
   */
  console.warn('[RESOLVE_INVENTORY_BLOCK_STILL_SHORT]', {
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    shortage_count: shortages.length,
    variants: shortages.map((s: any) => s.lasyncro_variant_id),
  });

  for (const shortage of shortages) {
    const qty = Number(shortage.quantity);
    const available = Number(shortage.available_quantity);
    const needed = qty - available;
    const label = shortage.sku ?? shortage.title ?? shortage.lasyncro_variant_id.slice(0, 8);

    await dbx('alerts')
      .insert({
        shop_id: job.shop_id,
        alert_key: `demand:stockout_risk:${shortage.lasyncro_variant_id}`,
        source: 'demand',
        alert_type: 'stockout_risk',
        severity: 'critical',
        title: `${label} — out of stock`,
        message: `Order needs ${qty} unit${qty > 1 ? 's' : ''} but only ${available} available. Reorder ${needed} unit${needed > 1 ? 's' : ''} to unblock.`,
        entity_id: shortage.lasyncro_variant_id,
        entity_type: 'variant',
        revenue_impact: shortage.unit_cost
          ? shortage.unit_cost * needed
          : null,
        is_active: true,
      })
      .onConflict(['shop_id', 'alert_key'])
      .merge({
        is_active: true,
        title: dbx.raw('EXCLUDED.title'),
        message: dbx.raw('EXCLUDED.message'),
        updated_at: dbx.fn.now(),
      });
  }
};
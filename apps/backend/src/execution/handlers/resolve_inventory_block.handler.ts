/**
 * resolve_inventory_block HANDLER (PP1-03)
 * -----------------------------------------
 * Called when an operator manually triggers execution on an
 * inventory-blocked order.
 *
 * Strategy:
 * 1. Check inventory_truth for all variants on this order
 * 2. If ALL variants have sufficient stock → delegate to proceed_fulfillment
 * 3. If ANY variant is still out of stock → delegate to the demand engine's
 *    emitter, which writes stockout_risk from inbound-aware numbers (SRC-18c)
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
import {
  computeVariantPlanning,
  emitStockoutAlerts,
} from '../../services/demand/demandIntelligence.service.js';

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
   * STEP 3b — STILL OUT OF STOCK: log, then delegate alerting
   * -------------------------------------------------------------------
   * Operator needs to know which specific variants are blocking. The alert
   * itself is written by the demand engine's emitter (SRC-18c) rather than
   * here — see the block below for why.
   */
  console.warn('[RESOLVE_INVENTORY_BLOCK_STILL_SHORT]', {
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    shortage_count: shortages.length,
    variants: shortages.map((s: any) => s.lasyncro_variant_id),
  });

  /**
   * SRC-18c — SINGLE WRITER FOR demand:stockout_risk
   * -------------------------------------------------
   * This handler previously wrote its own row on the same alert_key with
   * `order_qty - available`, which ignores committed inbound entirely and so
   * could instruct a merchant to reorder units already on an open PO. It now
   * routes through the demand engine's own planning + emitter, so both paths
   * publish one message from one set of numbers.
   *
   * BEHAVIOUR CHANGE (accepted): only variants the planner marks `critical`
   * alert. A partial shortage (5 held, 10 needed) is an order-allocation
   * problem surfaced by the order-block UI, not a reorder signal.
   *
   * RLS: computeVariantPlanning runs RLS-protected queries and requires a
   * real transaction whose caller has set app.current_tenant. `trx` is
   * therefore required here rather than falling back to `dbx`.
   *
   * The (trx ?? db) fallback above is already dead in practice: STEP 1's
   * dbx query throws TENANT_CONTEXT_MISSING on the pooled root connection
   * before execution ever reaches this point (verified 2026-08-19). A
   * fallback branch here would be unreachable guard code of exactly the
   * kind this issue exists to remove, so absence fails loudly instead.
   *
   * reconcile=false: the emitter's sweep resolves every active demand alert
   * absent from the supplied list. This caller holds only one order's
   * variants, so sweeping here would deactivate the rest of the shop's.
   */
  if (!trx) {
    throw new Error(
      '[RESOLVE_INVENTORY_BLOCK] transaction required: alerting needs a ' +
      'tenant-scoped transaction. Dispatcher must supply one.'
    );
  }

  const shortedVariantIds = shortages.map((s: any) => s.lasyncro_variant_id);

  const planned = await computeVariantPlanning(trx, job.shop_id, shortedVariantIds);
  const critical = planned.filter((v) => v.reorder_urgency === 'critical');
  if (critical.length > 0) {
    await emitStockoutAlerts(trx, job.shop_id, critical, false);
  }
};
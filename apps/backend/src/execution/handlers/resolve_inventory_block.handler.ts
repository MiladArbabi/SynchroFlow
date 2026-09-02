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

import { ExecutionHandler } from '../execution.registry.js';
import { proceedFulfillmentHandler } from './proceed_fulfillment.handler.js';
import {
  computeVariantPlanning,
  emitStockoutAlerts,
} from '../../services/demand/demandIntelligence.service.js';
import { evaluateInventoryConstraint } from '../../services/constraints/evaluators/inventoryConstraintEvaluator.js';

export const resolveInventoryBlockHandler: ExecutionHandler = async (job, trx) => {
  console.info('[RESOLVE_INVENTORY_BLOCK_START]', {
    decision_id: job.decision_id,
    entity_id: job.entity_id,
    shop_id: job.shop_id,
  });

  /**
   * STEP 1 — EVALUATE CANONICAL INVENTORY AVAILABILITY (ORD-DECISION-01)
   * --------------------------------------------------------------------
   * REUSES evaluateInventoryConstraint — the single canonical definition
   * of "is this variant short?" — rather than restating it here.
   *
   * The previous local query was a second, drifted definition and was
   * wrong on both axes this issue exists to fix:
   *
   * 1. AGGREGATION. It joined order_line_items → inventory_truth without
   *    grouping, so a variant stocked across several locations produced
   *    one row PER location, each carrying that location's own
   *    available_quantity. A variant with 0 at the warehouse root and 7
   *    in pick bin A-1 yielded a row of 0, which the shortage filter read
   *    as a shortage while 7 pickable units sat on the shelf.
   * 2. PICKABILITY. It counted every inventory_truth row regardless of
   *    location, so quarantine/non-pickable stock could satisfy demand
   *    that the picker can never actually fill.
   *
   * It also compared against oli.quantity — the ORIGINAL ordered quantity —
   * so a 5-unit order already fulfilled 4 still demanded 5.
   *
   * The evaluator handles all three correctly (remaining unfulfilled
   * demand, aggregate SUM over canonical pickable locations only) and is
   * the same contract the constraint projection and the merchant-facing
   * block state are derived from. Divergence here is precisely what
   * produced an execute button that refused to proceed on a stocked order.
   *
   * RLS: the evaluator runs tenant-scoped queries and requires a real
   * transaction whose caller has set app.current_tenant. The (trx ?? db)
   * fallback below was already dead in practice — the previous STEP 1
   * query threw TENANT_CONTEXT_MISSING on the pooled root connection
   * before execution could reach the alerting guard (verified 2026-08-19).
   * That guard is therefore hoisted here so absence still fails loudly,
   * with the same message, before any evaluation is attempted.
   */
  if (!trx) {
    throw new Error(
      '[RESOLVE_INVENTORY_BLOCK] transaction required: alerting needs a ' +
      'tenant-scoped transaction. Dispatcher must supply one.'
    );
  }

  const evaluations = await evaluateInventoryConstraint(
    trx,
    job.entity_id,
    job.shop_id
  );

  if (evaluations.length === 0) {
    console.warn('[RESOLVE_INVENTORY_BLOCK_NO_LINE_ITEMS]', {
      decision_id: job.decision_id,
      entity_id: job.entity_id,
    });
    return;
  }

  /**
   * STEP 2 — CLASSIFY VARIANTS
   * ---------------------------
   * isActive === true IS the canonical shortage signal (available <
   * remaining, pickable-only). No row-by-row recomputation here.
   */
  const shortages = evaluations.filter((e) => e.isActive);

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
      line_item_count: evaluations.length,
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
    variants: shortages.map((s) => s.targetId),
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
   * therefore required here rather than falling back to `dbx` — the guard
   * that proves it now sits at STEP 1, since the evaluator needs the same
   * tenant-scoped transaction and runs first.
   *
   * reconcile=false: the emitter's sweep resolves every active demand alert
   * absent from the supplied list. This caller holds only one order's
   * variants, so sweeping here would deactivate the rest of the shop's.
   */
  // targetId is optional on ConstraintEvaluationResult; the inventory
  // evaluator always populates it (one row per variant), so this narrows
  // the type without discarding any real shortage.
  const shortedVariantIds = shortages
    .map((s) => s.targetId)
    .filter((id): id is string => Boolean(id));

  const planned = await computeVariantPlanning(trx, job.shop_id, shortedVariantIds);
  const critical = planned.filter((v) => v.reorder_urgency === 'critical');
  if (critical.length > 0) {
    await emitStockoutAlerts(trx, job.shop_id, critical, false);
  }
};
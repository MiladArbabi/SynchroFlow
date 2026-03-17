// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

import { ReconciliationResult } from './reconciliation.types.js';
import { projectOrderAge } from '../../projections/orderAgeProjection.js';
import { projectOrderRisk } from '../../projections/orderRiskProjection.js';
import { projectOrderMargin } from '../../projections/orderMarginProjection.js';
import { projectOrderConstraints } from '../../projections/orderConstraintProjection.js';
import { projectOrderFulfillment } from '../../projections/orderFulfillmentProjection.js';
import { projectRevenueDaily } from '../../projections/orderRevenueDailyProjection.js';
import { projectDailyOperationalBrief } from '../../projections/dailyOperationalBriefProjection.js';
import { projectOrderInventoryConstraints } from '../../projections/orderInventoryConstraintProjection.js';
import { assertProjectionRegistered } from '../../utils/schemaGuard.js';

import { resolveExecutionQueues } from '../../services/order-execution-intelligence/orderExecutionQueueResolver.js';
import { resolveOperationalSignals } from '../../services/order-execution-intelligence/orderOperationalSignalsResolver.js'

import { writeReconciliationAudit } from './reconciliationAuditWriter.js';
import { writeReconciliationCheckpoint } from './reconciliationCheckpointWriter.js';
import { writeOrderRevenueUnits } from './revenue-units.writer.js';

import { resolveRefundExecution } from '../refundResolution.worker.js';
import { rebuildInventoryProjectionForVariants } from '../../services/inventory/rebuildInventoryProjection.js';
import { evaluateOrderConstraints } from '../../services/constraints/constraintEngine.js';

/**
 * PROJECTION RUNTIME INSTRUMENTATION
 * ----------------------------------
 * Lightweight execution timing for projections.
 *
 * Purpose:
 * - detect slow projections
 * - observe reconciliation runtime composition
 * - enable operational debugging
 *
 * Implementation intentionally minimal:
 * - no external dependencies
 * - structured log output
 *
 * Future upgrade path:
 * metrics exporter → Prometheus / OpenTelemetry
 */
async function instrumentProjection(
  name: string,
  fn: () => Promise<void>
) {
  const start = Date.now();

  await fn();

  /* const durationMs = Date.now() - start; */

  /* console.info('[projection.runtime]', {
    projection: name,
    duration_ms: durationMs
  }); */
}

/**
 * DETERMINISTIC ID GENERATOR
 * --------------------------
 * Stable SHA256-based identifier derived from:
 * - entity type
 * - order id
 * - aggregate version
 *
 * Guarantees:
 * - Replay determinism
 * - Cross-node consistency
 * - No wall-clock influence
 */
function deterministicId(
  entity: string,
  orderId: string,
  aggregateVersion: number
): string {
  return crypto
    .createHash('sha256')
    .update(`${entity}:${orderId}:${aggregateVersion}`)
    .digest('hex')
    .slice(0, 32);
}

export async function reconcileOrderFulfillment(
  lasyncroOrderId: string,
  aggregateVersion: number,
  observed?: {
    status: 'fulfilled';
    observedAt: Date;
    source: 'shopify_sync';
  }
): Promise<{
  result: ReconciliationResult;
  affectedVariantIds: string[];
}> {

  return db.transaction(async (trx) => {

    /**
     * RECONCILIATION SNAPSHOT WRITE FLAG
     * ----------------------------------
     * Signals database triggers that reconciliation writes
     * are allowed in this transaction.
     *
     * Uses custom application namespace (app.*) because
     * PostgreSQL rejects unknown root parameters.
     */
    await trx.raw(`SET LOCAL "synchroflow.reconciliation" = 'true'`);

    const order = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .forUpdate()
      .first();

    if (!order) {
      /**
       * RECONCILIATION SAFETY GUARD
       * ----------------------------
       * Order missing under projection is a structural violation.
       * Fail fast to avoid silent data divergence.
       */
      throw new Error(
        `[RECONCILIATION_INVARIANT_VIOLATION] Order not found: ${lasyncroOrderId}`
      );
    }

    /**
     * RECONCILIATION MODE DETECTION
     * -----------------------------
     * Synthetic reconciliation occurs when projection has already
     * processed this aggregate version.
     *
     * IMPORTANT:
     * Operational snapshots MUST still be recomputed during rebuild
     * to guarantee deterministic reconstruction of operational state.
     */
    const syntheticMode =
      aggregateVersion !== order.aggregate_version ||
      aggregateVersion <= order.last_projected_version;

    await writeOrderRevenueUnits(lasyncroOrderId, trx);

    /**
     * SYNTHETIC MODE NOTICE
     * ---------------------
     * When syntheticMode = true:
     * - Skip mutation paths
     * - STILL compute operational snapshots
     *
     * This guarantees rebuild correctness.
     */
    if (syntheticMode) {
      console.debug('[RECONCILIATION_SYNTHETIC_MODE]', {
        order: lasyncroOrderId,
        aggregateVersion,
      });
    }

    /**
     * SNAPSHOT DATE (Event-Time Anchored)
     * -----------------------------------
     * Must be derived from deterministic domain event-time.
     *
     * Anchor Rule:
     * - Use max(order_updated_at, order_created_at)
     * - Never use wall-clock.
     *
     * Guarantees:
     * - Replay determinism
     * - Cross-node consistency
     * - No execution-time drift
     */

    /**
     * EVENT-TIME MATERIALIZATION RULE
     * --------------------------------
     * All projection timestamps MUST derive from eventAnchor.
     *
     * Forbidden inside reconciliation:
     * - trx.fn.now()
     * - Date.now()
     * - new Date() without anchor
     *
     * This preserves:
     * - Deterministic rebuilds
     * - Stable state hashing
     */
    const eventAnchor =
      order.order_updated_at ??
      order.order_created_at;

    if (!eventAnchor) {
      throw new Error(
        '[EVENT_TIME_VIOLATION] Order missing event-time anchor'
      );
    }

    /**
     * REFUND REPLAY SAFETY RESET
     * --------------------------
     * Reconciliation is replayable by design.
     * Refund resolution is additive.
     *
     * To ensure deterministic replay safety,
     * we MUST reset returned_quantity before re-applying
     * all refund_executions.
     *
     * This guarantees:
     * - No double application
     * - Deterministic structural revenue
     * - Correct inventory rebuild
     */
    
    /**
     * REFUND APPLICATION MODEL
     * ------------------------
     * Revenue units are immutable economic atoms.
     * Returned quantities are derived from
     * refund_execution_line_items.
     *
     * No mutation occurs here.
     */

    /**
     * DETERMINISTIC REFUND EXECUTION ORDER
     * ------------------------------------
     * Refund executions must be replayed in canonical order
     * to guarantee deterministic rebuild behavior.
     *
     * We use created_at because it originates from the
     * canonical refund domain event.
     */
    const refundExecutions = await trx('refund_executions')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .orderBy('created_at', 'asc');

    for (const execution of refundExecutions) {
      await resolveRefundExecution(
        execution.lasyncro_refund_execution_id,
        trx
      );
    }

    /**
     * DETERMINISTIC VARIANT EXTRACTION
     * --------------------------------
     * DISTINCT without ORDER BY produces unstable ordering.
     *
     * Variant ordering must be canonical to guarantee:
     * - deterministic rebuilds
     * - stable inventory projection rebuild order
     * - deterministic operational signal computation
     */
    const variantRows = await trx('order_revenue_units')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .distinct('lasyncro_variant_id')
      .orderBy('lasyncro_variant_id', 'asc');

    const affectedVariantIds = variantRows.map(r => r.lasyncro_variant_id);

    if (affectedVariantIds.length > 0) {
      await rebuildInventoryProjectionForVariants(
        order.shop_id,
        affectedVariantIds,
        trx,
        eventAnchor
      );
    };

    assertProjectionRegistered('orderFulfillmentProjection');

    /**
     * ORDER FULFILLMENT PROJECTION
     * ----------------------------
     * This projection is the single owner of:
     *
     * - order_fulfillment_status
     * - economic fulfillment propagation
     *   (fulfilled_quantity in order_revenue_units)
     *
     * The reconciliation handler must never
     * mutate the revenue ledger directly.
     */
    await instrumentProjection('orderFulfillmentProjection', async () =>
      projectOrderFulfillment(
        trx,
        lasyncroOrderId,
        aggregateVersion,
        eventAnchor
      )
    );

    /**
     * INVENTORY CONSTRAINT RE-EVALUATION
     * ----------------------------------
     * Inventory changes affect the entire variant demand queue.
     *
     * Therefore all orders containing the affected variants must
     * be re-evaluated for oversell allocation.
     */
    const affectedOrders = await trx('order_revenue_units')
      .distinct('lasyncro_order_id')
      .whereIn('lasyncro_variant_id', affectedVariantIds);

    /**
     * INVENTORY CONSTRAINT PROJECTION
     * --------------------------------
     * Oversell classification projection.
     *
     * Wrapped with instrumentation so projection latency
     * becomes visible in reconciliation runtime telemetry.
     */
    await instrumentProjection('orderInventoryConstraintProjection', async () =>
      projectOrderInventoryConstraints(
        trx,
        affectedOrders.map(o => o.lasyncro_order_id)
      )
    );

    /**
     * ORDER RISK SNAPSHOT MATERIALIZATION
     * ------------------------------------
     * Replace-on-reconcile.
     * Deterministic.
     */
    const ofs = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    const isInventoryBlocked = !!ofs?.inventory_block_type;
    const isCustomerBlocked = !!ofs?.customer_block_type;
    const isOperationalBlocked = !!ofs?.operational_block_type;

    /**
     * Constraint Evaluation
     * ----------------------
     * All constraint signals must be derived before projection.
     */
    const constraintEvaluations = await evaluateOrderConstraints(
      trx,
      lasyncroOrderId,
      order.shop_id
    );

    await instrumentProjection('orderConstraintProjection', async () =>
      projectOrderConstraints(
        trx,
        lasyncroOrderId,
        order.shop_id,
        aggregateVersion,
        eventAnchor,
        constraintEvaluations
      )
    );

    /**
     * ORDER MARGIN PROJECTION
     * -----------------------
     * Delegated to deterministic projection module.
     */
    await instrumentProjection('orderMarginProjection', async () =>
      projectOrderMargin(
        trx,
        lasyncroOrderId,
        order.shop_id,
        aggregateVersion,
        eventAnchor
      )
    );

    /**
     * ORDER AGE SNAPSHOT MATERIALIZATION
     * -----------------------------------
     * Replace-on-reconcile.
     * Fully derived from canonical state.
     */
    const ofsAge = await trx('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select('fulfilled_at')
      .first();

    /**
    * AGE CALCULATION CLOCK (Aggregate-State Anchored)
    * ------------------------------------------------
    * Use the order's canonical order_updated_at.
    * This value is projection-deterministic and
    * already reflects the latest domain event.
    */
   if (!order.order_updated_at) {
     throw new Error(
       '[AGE_INVARIANT_VIOLATION] order_updated_at missing during reconciliation'
     );
   }

    /**
     * ORDER RISK PROJECTION
     * ---------------------
     * All risk scoring logic lives inside the projection module.
     *
     * This includes:
     * - health score computation
     * - SLA escalation
     * - blocker contributions
     * - aging risk
     *
     * The reconciliation handler must not compute
     * any risk logic directly.
     */
    await instrumentProjection('orderRiskProjection', async () =>
      projectOrderRisk(
        trx,
        lasyncroOrderId,
        order.shop_id,
        aggregateVersion,
        eventAnchor
      )
    );

    /**
     * ORDER AGE PROJECTION
     * --------------------
     * Delegated to deterministic projection module.
     */
    await instrumentProjection('orderAgeProjection', async () =>
      projectOrderAge(
        trx,
        lasyncroOrderId,
        order.shop_id,
        aggregateVersion,
        eventAnchor
      )
    );

    /**
     * DAILY REVENUE PROJECTION MATERIALIZATION
     * -----------------------------------------
     * Replace per (shop_id, revenue_date).
     * Derived from net revenue + risk snapshot.
     */

    const orderDateRow = await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .select('order_created_at')
      .first();

    if (orderDateRow?.order_created_at) {
      const revenueDate = new Date(orderDateRow.order_created_at)
        .toISOString()
        .split('T')[0];

      /**
       * DAILY REVENUE PROJECTION
       * ------------------------
       * Projection module is the single owner of
       * revenue_projection_daily writes.
       *
       * The reconciliation handler must never
       * write to the table directly.
       */
      await projectRevenueDaily(
        trx, 
        order.shop_id,
        aggregateVersion,
        eventAnchor
      );
    };

    await resolveExecutionQueues(
      trx,
      order.shop_id
    );

    /**
     * OPERATIONAL SIGNALS PROJECTION
     * ------------------------------
     * Produces shop-level operational intelligence signals.
     *
     * Return values are intentionally ignored because
     * reconciliation only triggers the projection side-effect.
     */
    await resolveOperationalSignals(
      trx,
      order.shop_id
    );

    /**
     * DAILY OPERATIONAL BRIEF PROJECTION
     * ----------------------------------
     * Delegated to projection module.
     */
    await projectDailyOperationalBrief(
      trx,
      order.shop_id,
      aggregateVersion,
      eventAnchor
    );

    await writeReconciliationAudit(
      trx,
      lasyncroOrderId,
      order.aggregate_version
    );

    /**
     * RECONCILIATION CHECKPOINT
     * -------------------------
     * MUST persist the version that was actually reconciled
     * from the queue event (aggregateVersion).
     *
     * Using order.aggregate_version here is unsafe because:
     * - the row may already have advanced due to newer events
     * - replay scenarios could incorrectly skip projections
     *
     * This guarantees:
     * - strict monotonic projection progress
     * - replay-safe checkpointing
     */
    await writeReconciliationCheckpoint(
      trx,
      lasyncroOrderId,
      aggregateVersion
    );

    return {
      result: observed?.status === 'fulfilled' ? 'observed' : 'synthetic',
      affectedVariantIds,
    };
  });
}
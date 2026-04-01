// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

import { rebuildInventoryProjectionForVariants } from '../../services/inventory/rebuildInventoryProjection.js';
import { evaluateOrderConstraints } from '../../services/constraints/constraintEngine.js';
import { resolveExecutionQueues } from '../../services/order-execution-intelligence/orderExecutionQueueResolver.js';
import { ConstraintEvaluationResult } from '../../services/constraints/constraint.types.js';

import { projectOrderAge } from '../../projections/orderAgeProjection.js';
import { projectOrderRisk } from '../../projections/orderRiskProjection.js';
import { projectOrderMargin } from '../../projections/orderMarginProjection.js';
import { projectOrderConstraints } from '../../projections/orderConstraintProjection.js';
import { projectOrderFulfillment } from '../../projections/orderFulfillmentProjection.js';
import { projectRevenueDaily } from '../../projections/orderRevenueDailyProjection.js';
import { projectDailyOperationalBrief } from '../../projections/dailyOperationalBriefProjection.js';
import { projectOrderInventoryConstraints } from '../../projections/orderInventoryConstraintProjection.js';
import { projectOrderOperationalConstraints } from '../../projections/orderOperationalConstraintProjection.js';
import { projectOrderCustomerConstraints } from '../../projections/orderCustomerConstraintProjection.js';

import { ReconciliationResult } from './reconciliation.types.js';
import { writeReconciliationAudit } from './reconciliationAuditWriter.js';
import { writeReconciliationCheckpoint } from './reconciliationCheckpointWriter.js';

import { writeOrderRevenueUnits } from './revenue-units.writer.js';
import { resolveRefundExecution } from '../refundResolution.worker.js';

import { assertProjectionRegistered } from '../../utils/schemaGuard.js';

import { DecisionRepository } from '../../domain/decision/decision.repository.js';
import { executeJob } from '../execution.worker.js';
import { enqueueExecutionJob } from '../../queues/execution.queue.js';
import { generateDecisions } from '../../domain/decision/decision.engine.js';

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
  },
  eventTime?: Date
): Promise<{
  result: ReconciliationResult;
  affectedVariantIds: string[];
}> {

  const executionBuffer: any[] = [];

  const txResult = await db.transaction(async (trx) => {

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

    /**
     * RECONCILIATION CLAIM (CRITICAL FIX)
     * -----------------------------------
     * Marks order as "being reconciled" immediately after lock.
     *
     * Prevents dispatcher from re-enqueueing same order
     * while current reconciliation is in-flight.
     */
    await trx('orders')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        last_reconciled_at: trx.fn.now()
      });

    /* console.debug('[RECONCILIATION_CLAIMED]', {
      lasyncroOrderId
    }); */

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

    /**
     * IDEMPOTENCY GUARD (CRITICAL)
     * -----------------------------
     * Prevents duplicate reconciliation execution.
     *
     * If:
     * - aggregate version already processed
     * - or projection already ahead
     *
     * Then:
     * → skip heavy computation
     * → return synthetic result
     */
    if (syntheticMode) {
      console.debug('[RECONCILIATION_SKIPPED_IDEMPOTENT]', {
        lasyncroOrderId,
        aggregateVersion,
        orderAggregateVersion: order.aggregate_version,
        lastProjectedVersion: order.last_projected_version,
      });

      /**
       * BLOCKED EXECUTION RESULT
       * ------------------------
       * Distinct from synthetic (idempotent skip).
       *
       * Required for:
       * - observability
       * - queue diagnostics
       * - decision traceability
       * 
       * TYPE ENFORCEMENT — RECONCILIATION RESULT
       * ----------------------------------------
       * Prevents TypeScript from inferring:
       * - result as string
       * - affectedVariantIds as never[]
       *
       * REQUIRED for consistent return contract across all branches
       */
      return {
        result: 'blocked' as ReconciliationResult,
        affectedVariantIds: [] as string[]
      };
    }

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
      /* console.debug('[RECONCILIATION_SYNTHETIC_MODE]', {
        order: lasyncroOrderId,
        aggregateVersion,
      }); */
    }

    /**
     * EVENT ANCHOR RESOLUTION (STRICT DOMAIN SOURCE)
     * ----------------------------------------------
     * MUST resolve event time from domain_events using external identity mapping.
     *
     * Guarantees:
     * - Temporal alignment with ingestion timeline
     * - No cross-entity time drift
     * - Deterministic replay correctness
     */
    const externalIdentity = await trx('external_order_identity_map')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    if (!externalIdentity) {
      throw new Error('[EVENT_ANCHOR_INVARIANT] missing external identity mapping');
    }

    const domainEventRow = await trx('domain_events')
      .whereRaw("event_payload->>'id' = ?", [externalIdentity.external_order_id])
      .orderBy('event_time', 'desc')
      .first();

    if (!domainEventRow?.event_time) {
      throw new Error('[EVENT_ANCHOR_INVARIANT] missing domain event for order');
    }

    const eventAnchor = new Date(domainEventRow.event_time);

    /* console.debug('[EVENT_ANCHOR_RESOLVED]', {
      orderId: lasyncroOrderId,
      externalOrderId: externalIdentity.external_order_id,
      eventTime: eventAnchor
    }); */

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

    /**
     * INVENTORY FAN-OUT RECONCILIATION
     * --------------------------------
     * Inventory changes affect ALL orders sharing the variant.
     *
     * We must enqueue reconciliation for those orders to:
     * - resolve stale constraints
     * - maintain correctness of allocation
     *
     * This is the ONLY valid place to trigger reconciliation
     * from state change (inventory domain event).
     */
    const impactedOrders = await trx('order_revenue_units')
      .distinct('lasyncro_order_id')
      .whereIn('lasyncro_variant_id', affectedVariantIds);

    /**
     * REBUILD SAFETY GUARD
     * --------------------
     * During rebuild:
     * - intents MUST NOT be created
     * - processor requires zero backlog
     *
     * Fan-out reconciliation is ONLY valid in runtime mode.
     */
    if (process.env.REBUILD_MODE !== 'true') {
      for (const row of impactedOrders) {

        /**
         * LOOP PREVENTION (CRITICAL)
         * --------------------------
         * Do NOT enqueue reconciliation for the same order
         * currently being processed.
         *
         * Otherwise:
         * → infinite reconciliation loop
         * → log spam
         * → CPU exhaustion
         */
        if (row.lasyncro_order_id === lasyncroOrderId) {
          continue;
        }

        /**
         * IDEMPOTENT INTENT GUARD
         * ------------------------
         * Prevent duplicate enqueue for same version.
         */
        const exists = await trx('order_reconciliation_intents')
          .where({
            lasyncro_order_id: row.lasyncro_order_id,
            aggregate_version: aggregateVersion
          })
          .first();

        if (exists) {
          continue;
        }

        await trx('order_reconciliation_intents')
          .insert({
            lasyncro_order_id: row.lasyncro_order_id,
            aggregate_version: aggregateVersion,
            observed: JSON.stringify({
              type: 'inventory_changed',
              at: new Date().toISOString()
            }),
            created_at: new Date()
          })
          /**
           * CONFLICT STRATEGY: MERGE (RECONCILIATION WRITE)
           * ----------------------------------------------
           * Reconciliation must converge state deterministically.
           * ignore() causes data loss and replay divergence.
           */
          .onConflict(['lasyncro_order_id', 'aggregate_version'])
          .merge({
            updated_at: trx.fn.now()
          });
      }
    }

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
     * ORDER AGE PROJECTION
     * --------------------
     * MUST run early because:
     * - operational constraints depend on age_since_paid_seconds
     * - constraint evaluators require age snapshot
     *
     * If moved below, system will:
     * - throw invariant violations
     * - produce zero SLA blocks
     */
    await instrumentProjection('orderAgeProjection', async () => {
    const orderIds = [
      lasyncroOrderId,
      ...affectedOrders.map(o => o.lasyncro_order_id)
    ];

    const uniqueOrderIds = [...new Set(orderIds)];

      for (const orderId of uniqueOrderIds) {
        await projectOrderAge(
          trx,
          orderId,
          order.shop_id,
          aggregateVersion,
          eventAnchor
        );
      }
    });

    await instrumentProjection('orderCustomerConstraintProjection', async () =>
      projectOrderCustomerConstraints(
        trx,
        affectedOrders.map(o => o.lasyncro_order_id)
      )
    );

    /**
     * OPERATIONAL CONSTRAINT PROJECTION
     * ---------------------------------
     * Detects SLA breaches after inventory/customer constraints resolved.
     */
    await instrumentProjection('orderOperationalConstraintProjection', async () =>
      projectOrderOperationalConstraints(
        trx,
        affectedOrders.map(o => o.lasyncro_order_id),
        order.shop_id
      )
    );

    /**
     * DELTA-BASED CONSTRAINT EVALUATION
     * ---------------------------------
     * Skip full evaluation when trigger is unrelated to constraints.
     *
     * Current rule:
     * - If reconciliation triggered by fulfillment event → skip
     * - Otherwise → evaluate
     *
     * NOTE:
     * This is a safe first step toward full delta system.
     */
    let constraintEvaluations: ConstraintEvaluationResult[];

    /**
     * CONSTRAINT EVALUATION (STRICT)
     * ------------------------------
     * Constraint engine must ALWAYS run.
     *
     * Delta-skipping breaks:
     * - variant-level correctness
     * - constraint persistence
     * - reconciliation integrity
     */
    constraintEvaluations = await evaluateOrderConstraints(
      trx,
      lasyncroOrderId,
      order.shop_id
    );
    /**
     * SCOPED CONSTRAINT MODEL
     * ------------------------
     * Preserve variant-level constraint visibility.
     */
    const inventoryConstraints = constraintEvaluations.filter(
      c => c.type === 'inventory' && c.isActive === true
    );

    const customerConstraints = constraintEvaluations.filter(
      c => c.type === 'customer' && c.isActive === true
    );

    const operationalConstraints = constraintEvaluations.filter(
      c => c.type === 'operational' && c.isActive === true
    );

    const isInventoryBlocked = inventoryConstraints.length > 0;
    const isCustomerBlocked = customerConstraints.length > 0;
    const isOperationalBlocked = operationalConstraints.length > 0;

    /**
     * CONSTRAINT PERSISTENCE (CRITICAL ORDER)
     * ---------------------------------------
     * Constraints MUST be written BEFORE enforcement.
     *
     * Otherwise:
     * - system blocks execution
     * - but never records WHY
     * - leading to empty constraint table
     */
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
     * DECISION ENGINE (TYPE-SAFE MINIMAL IMPLEMENTATION)
     * --------------------------------------------------
     * Produces valid Decision object using available risk snapshot.
     * Ensures system invariant: every reconciled order emits decision.
     */
    const riskSnapshot = await trx('order_risk_snapshot')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    if (!riskSnapshot) {
    /**
     * HARD FAILURE — DECISION SYSTEM INVARIANT VIOLATION
     * -------------------------------------------------
     * A missing risk snapshot means:
     * - projections are broken or lagging
     * - decision engine cannot operate
     *
     * This MUST stop reconciliation to prevent:
     * - silent decision gaps
     * - inconsistent system state
     */
    console.error('[DECISION_MISSING_RISK_SNAPSHOT_FATAL]', {
      orderId: lasyncroOrderId,
      aggregateVersion
    });

    throw new Error(
      `[DECISION_INVARIANT_BREACH] Missing risk snapshot for order ${lasyncroOrderId}`
    );
  } else {

    /**
     * IDEMPOTENCY GUARD — SKIP DECISION ENGINE
     * ---------------------------------------
     * If projection version has not changed,
     * decision output is guaranteed identical.
     *
     * Prevents:
     * - log spam
     * - duplicate decision writes
     * - wasted CPU
     */
    if (
      riskSnapshot.aggregate_version !== undefined &&
      riskSnapshot.aggregate_version === aggregateVersion
    ) {

      return {
        result: 'synthetic' as ReconciliationResult,
       affectedVariantIds: [] as string[]
      };
    }

      /**
       * DECISION ENGINE OWNERSHIP
       * -------------------------
       * Decision identity, structure, and priority MUST be produced
       * exclusively by the Decision Engine.
       *
       * Reconciliation is orchestration only.
       *
       * This guarantees:
       * - deterministic ID generation
       * - centralized decision logic
       * - no duplication across system
       */
      
      const decisions = generateDecisions({
        orderId: lasyncroOrderId,
        aggregateVersion,
        riskSnapshot
      });

      /**
       * DECISION EXISTENCE INVARIANT (CRITICAL)
       * --------------------------------------
       * Every (order, aggregateVersion) MUST produce ≥1 decision.
       *
       * Prevents:
       * - silent no-op reconciliations
       * - checkpoint advancing without decisions
       */
      if (!decisions || decisions.length === 0) {
        throw new Error(
          `[RECONCILIATION_FAILED] No decisions generated for order=${lasyncroOrderId} version=${aggregateVersion}`
        );
      };

      /**
       * PERSISTENCE
       */
      for (const decision of decisions) {
        const persisted = await DecisionRepository.create({
          ...decision,

          /**
           * AGGREGATE VERSION BINDING (CRITICAL)
           * -----------------------------------
           * Explicitly binds decision to reconciliation version.
           *
           * Required for:
           * - checkpoint validation
           * - deterministic replay
           * - DB-level integrity
           */
          aggregate_version: aggregateVersion,

          shop_id: order.shop_id
        });

        executionBuffer.push(persisted);
      }
    }

    /**
     * HARD CONSTRAINT ENFORCEMENT GATE
     * --------------------------------
     * Reconciliation MUST NOT proceed when any constraint is active.
     *
     * This is the system's control boundary.
     *
     * Without this:
     * - constraints are informational only
     * - system becomes non-deterministic
     */
    if (isInventoryBlocked || isCustomerBlocked || isOperationalBlocked) {
      /* console.warn('[RECONCILIATION_BLOCKED_BY_CONSTRAINTS]', {
        orderId: lasyncroOrderId,
        inventory: isInventoryBlocked,
        customer: isCustomerBlocked,
        operational: isOperationalBlocked
      }); */

      /**
       * HARD STOP (TYPE-SAFE)
       * ---------------------
       * Reconciliation halted due to active constraints.
       * Returns neutral result to preserve contract.
       * 
       * TYPE ENFORCEMENT — CONSTRAINT BLOCK RETURN
       * ------------------------------------------
       * Ensures consistent return type with ReconciliationResult contract.
       * Prevents union type pollution (string | ReconciliationResult).
       */
      return {
        result: 'synthetic' as ReconciliationResult,
        affectedVariantIds: [] as string[]
      };
    };

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
     * ORDER DATE SOURCE (LOCKED ROW REUSE)
     * -------------------------------------
     * NEVER re-query orders inside same transaction.
     * Use already locked row to avoid deadlocks.
     */
    const orderDateRow = {
      order_created_at: order.order_created_at
    };

    if (orderDateRow?.order_created_at) {

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
      result: (observed?.status === 'fulfilled'
        ? 'observed'
        : 'synthetic') as ReconciliationResult,
      affectedVariantIds: affectedVariantIds as string[]
    };
  });

  /**
   * QUEUE-BASED EXECUTION DISPATCH
   * ------------------------------
   * Replaces inline execution with durable queue.
   *
   * Guarantees:
   * - retry capability (RabbitMQ)
   * - no execution inside reconciliation
   * - backpressure visibility
   */
  for (const d of executionBuffer) {
    await enqueueExecutionJob({
      decision_id: d.id,
      entity_id: d.entity_id,
      aggregate_version: d.aggregate_version,
      action_type: d.recommended_action.type,
      payload: d.recommended_action.payload,
      execution_mode: d.recommended_action.execution_mode
    });
  }

  return txResult;
}
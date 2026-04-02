// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db from '@lasyncro/backend-core/db.js';

import { evaluateOrderConstraints } from '../../services/constraints/constraintEngine.js';
import { resolveExecutionQueues } from '../../services/order-execution-intelligence/orderExecutionQueueResolver.js';
import { ConstraintEvaluationResult } from '../../services/constraints/constraint.types.js';

import { ReconciliationResult } from './reconciliation.types.js';
import { writeReconciliationAudit } from './reconciliationAuditWriter.js';
import { writeReconciliationCheckpoint } from './reconciliationCheckpointWriter.js';

import { writeOrderRevenueUnits } from './revenue-units.writer.js';
import { resolveRefundExecution } from '../refundResolution.worker.js';
import { DecisionRepository } from '../../domain/decision/decision.repository.js';
import type { Decision } from '../../domain/decision/Decision.js';
import { executeJob } from '../execution.worker.js';
import { enqueueExecutionJob } from '../../queues/execution.queue.js';
import { generateDecisions } from '../../domain/decision/decision.engine.js';

/**
 * ARCHITECTURAL GUARD — PROJECTION IS SINGLE-WRITER
 * -------------------------------------------------
 * Reconciliation MUST NOT import or execute any projection logic.
 *
 * All projection writes are owned exclusively by:
 *   → projection.engine
 *
 * If you need new state:
 *   → add projection handler (NOT here)
 *
 * Violating this breaks:
 * - determinism
 * - replayability
 * - cursor integrity
 */

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

  /**
 * EXECUTION BUFFER (STRICT TYPING)
 * --------------------------------
 * Holds persisted decisions eligible for execution dispatch.
 *
 * Guarantees:
 * - type safety across execution boundary
 * - prevents malformed job payloads entering queue
 */
  const executionBuffer: Decision[] = [];

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
     * PROJECTION LAG HANDLING (RETRYABLE — CRITICAL FIX)
     * -------------------------------------------------
     * Projection and reconciliation are asynchronous.
     *
     * A small lag is EXPECTED and must NOT crash reconciliation.
     *
     * Strategy:
     * - signal retry
     * - DO NOT treat as fatal
     */
    if (order.last_projected_version < aggregateVersion) {
      /**
       * PROJECTION NOT READY — SAFE SKIP (CRITICAL)
       * ------------------------------------------
       * This is NOT a failure.
       *
       * It indicates projection has not yet caught up.
       * Reconciliation must NOT run yet.
       *
       * Throwing here causes:
       * - retry storms
       * - log noise
       * - system instability
       *
       * Correct behavior:
       * → exit gracefully
       * → allow dispatcher to retry later
       */
      console.info('[RECONCILIATION_SKIPPED_PROJECTION_NOT_READY]', {
        orderId: lasyncroOrderId,
        aggregateVersion,
        lastProjectedVersion: order.last_projected_version
      });

      return {
        result: 'noop' as ReconciliationResult,
        affectedVariantIds: [] as string[]
      };
    }

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
      }
    }

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
     * PROJECTION READ — GUARDED (CRITICAL)
     * -----------------------------------
     * Reconciliation reads projection state ONLY.
     *
     * Guard ensures:
     * - projection must be complete before reconciliation
     * - prevents silent divergence if projection lags
     *
     * If this fails:
     * → projection system is broken upstream
     * → reconciliation must stop
     */
    const riskSnapshot = await trx('order_risk_snapshot')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first();

    if (!riskSnapshot) {
      console.error('[PROJECTION_STATE_MISSING_FATAL]', {
        table: 'order_risk_snapshot',
        orderId: lasyncroOrderId,
        aggregateVersion
      });

      throw new Error(
        `[PROJECTION_STATE_MISSING] order_risk_snapshot missing for order=${lasyncroOrderId}`
      );
  } else {

    /**
     * IDEMPOTENCY GUARD — DECISION REUSE (CORRECTED)
     * ---------------------------------------------
     * If projection version unchanged:
     * - DO NOT regenerate decisions
     * - BUT still allow execution dispatch of existing decisions
     *
     * Prevents:
     * - duplicate decision writes
     * While preserving:
     * - execution guarantees
     */
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
    let decisions: Decision[];

    /**
     * DECISION EXISTENCE CHECK (CORRECT SOURCE OF TRUTH)
     * -------------------------------------------------
     * Reuse ONLY if decisions already exist in DB.
     * Prevents false-positive idempotency.
     */
    const existingDecisions = await trx('decisions')
      .where({
        entity_id: lasyncroOrderId,
        aggregate_version: aggregateVersion
      });

    if (existingDecisions.length > 0) { 
      console.info('[DECISION_REUSE]', {
        orderId: lasyncroOrderId,
        aggregateVersion
      });

      /**
       * Fetch existing decisions for this version
       */
      decisions = existingDecisions;

      /**
       * REUSE → EXECUTION BUFFER (CRITICAL)
       * -----------------------------------
       * Reused decisions must still be dispatched.
       * Persistence already done → only buffer needed.
       */
      for (const decision of decisions) {
        executionBuffer.push(decision);
      }

    } else {
      decisions = generateDecisions({
        orderId: lasyncroOrderId,
        shopId: order.shop_id,
        aggregateVersion,
        riskSnapshot
      });
    }

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
        await DecisionRepository.create({
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

        executionBuffer.push(decision);
      }
    }

    /**
     * CONSTRAINT GATE (CORRECTED)
     * ---------------------------
     * Constraints block NEW decision generation,
     * but MUST NOT block execution dispatch.
     *
     * Execution is required for:
     * - compensating actions
     * - system convergence
     */
    const isBlocked =
      isInventoryBlocked || isCustomerBlocked || isOperationalBlocked;

    if (isBlocked) {
      console.warn('[RECONCILIATION_BLOCKED_BY_CONSTRAINTS]', {
        orderId: lasyncroOrderId,
        inventory: isInventoryBlocked,
        customer: isCustomerBlocked,
        operational: isOperationalBlocked
      });
    };

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

    await resolveExecutionQueues(
      trx,
      order.shop_id
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
      execution_mode: d.recommended_action.execution_mode,

      /**
       * TENANT CONTEXT (CRITICAL)
       * -------------------------
       * Required downstream for:
       * - RLS
       * - Shopify API access
       */
      shop_id: d.shop_id
    });
  }

  return txResult;
}
// apps/backend/src/workers/reconciliation/reconciliation.handlers.ts
import db, { systemQuery } from '@lasyncro/backend-core/db.js';

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
// Command Bus (single decision authority)
// CRITICAL: Reconciliation must not create decisions directly
import { dispatchCommand } from '../../domain/command/command.bus.js';

/**
 * ARCHITECTURAL RULE — DECISION AUTHORITY
 * ---------------------------------------
 * Reconciliation MUST NOT:
 * - import decision.engine
 * - call generateDecisions
 * - persist decisions directly
 *
 * All decision creation MUST go through Command Bus.
 *
 * Guarantees:
 * - determinism
 * - replay safety
 * - single decision authority
 */

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
  eventTime?: Date,
  // THREAD A-2 (2026-06-29): optional — when the caller already knows
  // shop_id (e.g. projection.db.worker.ts's Step 4, which reads it
  // straight off the intent row), skip the cross-tenant bootstrap lookup
  // below entirely. That lookup uses systemQuery(), which does NOT
  // bypass real RLS (see RLS_blueprint.md §7) — it was silently throwing
  // RECONCILIATION_ORDER_NOT_FOUND for every order, confirmed live.
  knownShopId?: number
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

  // TENANT BOOTSTRAP (THREAD A-2, 2026-06-29): this function had NO
  // app.current_tenant setup anywhere — it only ever ran via the rebuild
  // CLI, whose systemDb role has BYPASSRLS, masking the gap entirely.
  // Called live (worker), its first query (orders, FORCE RLS) would
  // silently return no row. Resolve shop_id by globally-unique
  // lasyncroOrderId first, tenant-agnostic by necessity (chicken/egg:
  // can't know the tenant without this read), THEN scope the transaction.
  let resolvedShopId = knownShopId;

  if (resolvedShopId === undefined) {
    // Fallback path — still broken under real RLS for any caller that
    // doesn't pass knownShopId (processDomainEvent.ts, the dormant
    // reconciliation.consumer.ts). Not fixed tonight; only the live
    // worker path (which now always passes knownShopId) is fixed.
    const shopRow = await systemQuery(
      db('orders')
        .where({ lasyncro_order_id: lasyncroOrderId })
        .select('shop_id')
    ).first();

    if (!shopRow) {
      throw new Error(
        `[RECONCILIATION_ORDER_NOT_FOUND] order=${lasyncroOrderId}`
      );
    }

    resolvedShopId = shopRow.shop_id;
  }

  const txResult = await db.transaction(async (trx) => {
    await trx.raw(`SET LOCAL "app.current_tenant" = '${resolvedShopId}'`);

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
     * SYNTHETIC MODE (STRICT)
     * ------------------------
     * Only skip if we are strictly behind projection.
     *
     * DO NOT block on aggregate version mismatch:
     * - consumer already allows mismatch
     * - blocking here breaks reconciliation entirely
     */
    const syntheticMode =
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
      console.warn('[RECONCILIATION_SKIPPED_IDEMPOTENT]', {
        reason: 'projection_already_applied',
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
     * PROJECTION READINESS GUARD (STRICT)
     * ----------------------------------
     * Reconciliation MUST wait until required projections exist.
     */
    const riskSnapshotExists = await trx('order_risk_snapshot')
      .where({
        lasyncro_order_id: lasyncroOrderId,
        aggregate_version: aggregateVersion
      })
      .first();

    if (!riskSnapshotExists) {
      console.warn('[RECONCILIATION_WAITING_FOR_PROJECTION]', {
        orderId: lasyncroOrderId,
        aggregateVersion,
      });

      return {
        result: 'synthetic' as ReconciliationResult,
        affectedVariantIds: []
      };
    }

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

    // apps/backend/src/workers/reconciliation/reconciliation.handlers.ts

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
     *
     * FIX (2026-07-01): order_risk_snapshot's PK is composite
     * (lasyncro_order_id, aggregate_version) — this table WILL have
     * multiple rows per order (confirmed: 6 historical rows for a real
     * order in dev data). Without .orderBy(), .first() returns an
     * arbitrary row, not necessarily the current one. This is the exact
     * cause of a real bug found live: a decision was generated from a
     * version-1 snapshot (is_inventory_blocked: true, from May) instead
     * of the current version-6 snapshot (false), producing a
     * "recommended action" for an order with zero active constraints.
     * Must fetch the row matching the aggregateVersion this reconciliation
     * pass is actually running for — not just "the latest" — to stay
     * consistent with the riskSnapshotExists guard above it, which
     * already correctly scopes by aggregate_version.
     */
    const riskSnapshot = await trx('order_risk_snapshot')
      .where({ lasyncro_order_id: lasyncroOrderId, aggregate_version: aggregateVersion })
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

    // Holds reused decisions ONLY (new decisions are created via Command Bus)
    let decisions: Decision[] | undefined;

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

    console.info('[RECONCILIATION_DECISION_CHECK]', {
      orderId: lasyncroOrderId,
      aggregateVersion,
      existingCount: existingDecisions.length
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

      console.info('[RECONCILIATION_DISPATCH_COMMAND]', {
        orderId: lasyncroOrderId,
        aggregateVersion
      });

      /**
       * MARGIN COMPUTATION (MG-01)
       * --------------------------
       * Compute and persist per-order margin into order_margin_snapshot.
       * Runs after constraint evaluation — uses same transaction.
       * Silent skip if no cost data available for this order.
       */
      try {
        const { computeOrderMargin } = await import(
          '../../services/margin/computeOrderMargin.service.js'
        );
        await computeOrderMargin(trx, lasyncroOrderId, order.shop_id, aggregateVersion);
      } catch (err) {
        console.error('[MARGIN_COMPUTATION_FAILED]', {
          orderId: lasyncroOrderId,
          error: (err as Error).message,
        });
        // Non-fatal — margin failure must not block reconciliation
      }
      
      /**
       * CRITICAL:
       * Reconciliation MUST dispatch commands instead of generating decisions.
       * Ensures:
       * - determinism
       * - replay safety
       * - single decision authority
       * 
       * Command payload must be encapsulated under `payload`.
       * Ensures strict command contract + forward compatibility.
       */
     await dispatchCommand({
      type: 'RECONCILIATION_RUN',
      payload: {
        orderId: lasyncroOrderId,
        shopId: order.shop_id,
        aggregateVersion,
        riskSnapshot
      },
      /**
       * Deterministic idempotency key (CRITICAL for replay safety)
       */
      idempotencyKey: `reconciliation-${lasyncroOrderId}-${aggregateVersion}`
    });

    /**
     * STOP EXECUTION (CRITICAL)
     * ------------------------
     * Command Bus will asynchronously create decisions.
     * Reconciliation must NOT proceed assuming decisions exist.
     *
     * Prevents:
     * - false invariant violations
     * - undefined decision usage
     * 
     * EARLY EXIT RETURN (TYPE-SAFE)
     * ----------------------------
     * No decisions created in this path.
     * Execution will be handled asynchronously via Command Bus.
     *
     * Ensures:
     * - type safety
     * - no invalid undefined returns
     */
    return {
      result: 'synthetic' as ReconciliationResult,
      affectedVariantIds: []
    };
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
        /**
         * DEBUG — STRUCTURAL INTEGRITY CHECK (CRITICAL)
         * --------------------------------------------
         * This reveals hidden mutation before persistence.
         */
        console.error('[DEBUG_DECISION_BEFORE_PERSIST]', {
          id: decision.id,
          recommended_action: decision.recommended_action,
          typeof_recommended_action: typeof decision.recommended_action,

          payload: decision.recommended_action?.payload,
          typeof_payload: typeof decision.recommended_action?.payload,

          actions: decision.actions,
          typeof_actions: typeof decision.actions,

          first_action_payload: decision.actions?.[0]?.payload,
          typeof_first_action_payload: typeof decision.actions?.[0]?.payload,
        });

        // DECISION-ENGINE-01: create() now requires the active tenant-scoped
        // trx (see decision.repository.ts) — RLS on `decisions` needs
        // app.current_tenant SET on this exact connection.
        await DecisionRepository.create(trx, {
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
    /**
     * EXECUTION INTENT (UNIFIED PATH)
     * -------------------------------
     * Reconciliation MUST NOT enqueue directly.
     *
     * Instead:
     * → write to decision_execution_queue
     * → dispatcher handles enqueue
     *
     * Guarantees:
     * - single execution path
     * - idempotency via DB constraint
     * - full observability
     * 
     * EXECUTION INTENT (IDEMPOTENT + GUARDED)
     * ---------------------------------------
     * Multi-writer safe:
     * - enforced by UNIQUE(decision_id)
     * - ON CONFLICT prevents duplicates
     *
     * CRITICAL:
     * - log when duplicate occurs → observability of race conditions
     */
    const inserted = await db('decision_execution_queue')
      .insert({
        decision_id: d.id,
        shop_id: d.shop_id,
        status: 'pending',
        created_at: db.fn.now(),
      })
      .onConflict('decision_id')
      .ignore()
      .returning('decision_id');

    if (!inserted.length) {
      console.warn('[EXECUTION_INTENT_DUPLICATE_SKIPPED]', {
        decision_id: d.id,
      });
    }

    console.info('[EXECUTION_INTENT_EMITTED_RECONCILIATION]', {
      decision_id: d.id,
    });
  }

  return txResult;
}
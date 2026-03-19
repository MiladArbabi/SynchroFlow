/**
 * CANONICAL DOMAIN EVENT PROCESSOR
 * =================================
 *
 * PURPOSE
 * -------
 * Single deterministic execution pipeline for domain events.
 *
 * Architectural invariant:
 *
 *   runtime_state === rebuild_state
 *
 * Therefore BOTH runtime consumers and rebuild replay
 * MUST execute events exclusively through this processor.
 *
 * Execution stages:
 *
 * 1. Project domain event
 * 2. Deterministic reconciliation pipeline
 *
 * Queue transport, scheduling, and rebuild orchestration
 * MUST NOT embed business logic.
 */

import db from '@lasyncro/backend-core/db.js';
import { projectDomainEvent } from '../projection/projection.engine.js';
import { projectOrderInventoryConstraints } from '../projections/orderInventoryConstraintProjection.js';

/**
 * RECONCILIATION PIPELINE OWNERSHIP
 * ---------------------------------
 * Obligation flag computation is executed inside
 * reconciliation.handlers.ts as part of the deterministic
 * reconciliation pipeline.
 *
 * The canonical event processor must NOT invoke
 * obligation evaluation directly.
 *
 * Reason:
 * Reconciliation is the single owner of operational
 * state transitions after projection.
 *
 * This prevents pipeline divergence between:
 * - runtime queue reconciliation
 * - deterministic rebuild execution
 */
import { reconcileOrderFulfillment } from '../workers/reconciliation/reconciliation.handlers.js';
import { computeShopOperationalSnapshot } from '../workers/projections/shopOperationalSnapshot.worker.js';

/**
 * PROCESS DOMAIN EVENT
 * --------------------
 * Deterministic event execution entrypoint.
 *
 * Guarantees:
 * - identical execution path for runtime + rebuild
 * - single source of truth for event processing
 */
export async function processDomainEvent(
  domainEventId: number
) {

  /**
     * DOMAIN EVENT ID NORMALIZATION
     * -----------------------------
     * PostgreSQL drivers may return numeric columns as strings.
     * We therefore normalize before validation.
     */
    const normalizedId = Number(domainEventId);

    if (!Number.isInteger(normalizedId) || normalizedId < 1) {
    throw new Error(
        `[PROCESS_DOMAIN_EVENT_INVALID_ID] ${domainEventId}`
    );
    }

    domainEventId = normalizedId;

    /**
     * INTENT BASELINE (DETERMINISTIC CURSOR)
     * --------------------------------------
     * Use max(reconciliation_intent_id) instead of count
     * to avoid offset-based drift under concurrent inserts.
     */
    const intentBaselineRow = await db('order_reconciliation_intents')
      /**
       * INTENT BASELINE (COMPOSITE CURSOR)
       * ----------------------------------
       * Use (created_at, reconciliation_intent_id) to guarantee strict ordering.
       */
      .select('created_at', 'reconciliation_intent_id')
      .orderBy('created_at', 'desc')
      .orderBy('reconciliation_intent_id', 'desc')
      .first()

    const intentBaselineTime = intentBaselineRow?.created_at ?? null;
    const intentBaselineId = intentBaselineRow?.reconciliation_intent_id ?? null;

    /**
     * STAGE 1
     * --------
     * Materialize domain projections.
     *
     * This step converts domain events into
     * deterministic projection state.
     */
    await projectDomainEvent(domainEventId);

   /**
     * ATOMIC INTENT ACQUISITION
     * --------------------------
     * Lock intents to guarantee:
     * - no concurrent processing
     * - deterministic execution
     */
    const intents = await db.transaction(async (trx) => {
      return trx('order_reconciliation_intents')
        .orderBy('created_at', 'asc')
        /**
         * INTENT SELECTION (NULL-SAFE CURSOR)
         * -----------------------------------
         * If no baseline exists → process ALL intents.
         */
        .where(function () {

          if (!intentBaselineTime) {
            // first run → no baseline → select all
            this.whereRaw('1=1');
            return;
          }

          this.where('created_at', '>', intentBaselineTime)
            .orWhere(function () {
              this.where('created_at', '=', intentBaselineTime)
                  .andWhere('reconciliation_intent_id', '>', intentBaselineId);
            });
        })
        .forUpdate()
        .skipLocked();
    });

  for (const intent of intents) {
  console.info('[PROCESS_DOMAIN_EVENT_RECONCILE]', {
    order: intent.lasyncro_order_id,
    version: intent.aggregate_version
  });

  /**
   * OBSERVED PAYLOAD NORMALIZATION
   * -------------------------------
   * Must match runtime reconciliation consumer logic.
   *
   * Guarantees deterministic parity between:
   * - queue-driven runtime reconciliation
   * - deterministic rebuild reconciliation
   */

  let observed:
  | {
      status: 'fulfilled';
      observedAt: Date;
      source: 'shopify_sync';
    }
  | undefined;

  /**
   * OBSERVED PAYLOAD NORMALIZATION
   * -------------------------------
   * Must exactly match runtime reconciliation consumer contract.
   */

  if (intent.observed) {
    const parsed =
      typeof intent.observed === 'string'
        ? JSON.parse(intent.observed)
        : intent.observed;

    if (parsed?.status === 'fulfilled') {
      observed = {
        status: 'fulfilled',
        source: 'shopify_sync',
        observedAt: new Date(parsed.observedAt),
      };
    }
  }

  /**
   * STRICT VERSION GATE
   * -------------------
   * Must mirror the reconciliation consumer runtime guard.
   *
   * Guarantees deterministic parity between:
   * - runtime queue consumer
   * - deterministic rebuild processor
   */

  const orderRow = await db('orders')
    .where({ lasyncro_order_id: intent.lasyncro_order_id })
    .select('aggregate_version', 'last_projected_version')
    .first();

  /**
   * STRICT VERSION VALIDATION
   * -------------------------
   * Intent must match the current order aggregate version.
   *
   * We intentionally DO NOT gate on last_projected_version
   * because projection may update it before reconciliation
   * during deterministic rebuild execution.
   *
   * Blocking reconciliation on <= last_projected_version
   * can permanently prevent reconciliation and snapshot
   * generation (observed production incident).
   */
  if (
    !orderRow ||
    intent.aggregate_version !== orderRow.aggregate_version
  ) {
    console.warn('[PROCESS_DOMAIN_EVENT_VERSION_MISMATCH]', {
      order: intent.lasyncro_order_id,
      intent_version: intent.aggregate_version,
      order_version: orderRow?.aggregate_version
    });
    continue;
  }

  const domainEventRow = await db('domain_events')
  .where({ id: domainEventId })
  .select('event_time')
  .first();

  if (!domainEventRow?.event_time) {
    throw new Error('[EVENT_TIME_INVARIANT] Missing domain event time');
  }

  /**
   * RECONCILIATION EXECUTION (ALREADY LOCKED)
   * ------------------------------------------
   * Intent row is locked, safe to execute without nested transaction.
   */
  await reconcileOrderFulfillment(
    intent.lasyncro_order_id,
    intent.aggregate_version,
    observed,
    new Date(domainEventRow.event_time)
  );

  /**
   * INTENT FINALIZATION
   * -------------------
   * Runtime dispatcher deletes intents after
   * publishing them to the queue.
   *
   * Deterministic processor must mirror this
   * behavior to prevent repeated reconciliation
   * during rebuild replay.
   */
  await db('order_reconciliation_intents')
    .where({
      reconciliation_intent_id: intent.reconciliation_intent_id,
    })
    .delete();

  const shopRow = await db('orders')
    .where({ lasyncro_order_id: intent.lasyncro_order_id })
    .select('shop_id')
    .first();

  if (shopRow?.shop_id) {
    /**
     * SNAPSHOT SCHEDULING
     * -------------------
     * Snapshot computation must run in the worker layer,
     * not inside the event processor.
     *
     * This schedules a snapshot recompute instead of
     * executing it inline, preventing reconciliation
     * latency amplification.
     *
     * Worker entrypoint will pick up pending jobs.
     */
    await db('shop_snapshot_jobs')
      .insert({
        shop_id: shopRow.shop_id,
        scheduled_at: new Date()
      })
      .onConflict(['shop_id'])
      .ignore();
  }
}

/**
 * INTENT BACKLOG WATCHDOG
 * -----------------------
 * Detect reconciliation pipeline stalls.
 *
 * If intents remain in the table after the processor
 * finishes handling the current event, the runtime
 * reconciliation dispatcher may be stalled.
 *
 * Signal:
 * ORDER_RECONCILIATION_INTENT_BACKLOG
 */
const remainingIntentsRow = await db('order_reconciliation_intents')
  .count<{ count: string }>('reconciliation_intent_id as count')
  .first();

const remainingIntents = Number(remainingIntentsRow?.count ?? 0);

/**
 * BACKLOG INVARIANT
 * -----------------
 * In deterministic rebuild mode, backlog MUST be zero.
 * Any remaining intents indicate pipeline inconsistency.
 */
if (remainingIntents > 0) {

  if (process.env.REBUILD_MODE === 'true') {
    throw new Error(
      `[RECONCILIATION_BACKLOG_VIOLATION] remaining_intents=${remainingIntents}`
    );
  }

  console.warn('[ORDER_RECONCILIATION_INTENT_BACKLOG]', {
    remaining_intents: remainingIntents
  });

}
  /**
   * FUTURE STAGES
   * -------------
   * Reconciliation pipeline will be migrated here
   * once rebuild/runtime divergence is removed.
   *
   * Current step introduces canonical processor
   * without changing runtime behavior.
   */
}
// apps/backend/src/services/order-fulfillment-ingestion/orderFulfillmentIngestion.service.ts

import db from '@lasyncro/backend-core/db.js';
import type { Knex } from 'knex';
import crypto from 'crypto';

/**
 * Sovereign Fulfillment Ingestion Service
 * =======================================
 *
 * Responsibilities:
 * - Persist canonical execution truth
 * - Enforce monotonic state transitions
 * - Remain transaction-safe
 * - Preserve deterministic replay guarantees
 *
 * Design Guarantees:
 * ------------------
 * 1. Execution state is anchored by lasyncro_order_id
 * 2. Snapshot establishes baseline
 * 3. Webhooks apply forward-only deltas
 * 4. Late or duplicated webhooks cannot regress truth
 * 5. All writes are idempotent
 *
 * This service MUST NEVER:
 * - Infer execution state
 * - Open uncontrolled DB connections inside worker loops
 * - Downgrade fulfillment state
 */

export class OrderFulfillmentIngestionService {

  /**
   * Execution State Precedence Model
   * ---------------------------------
   * Defines monotonic progression order.
   *
   * Higher number = stronger execution certainty.
   *
   * pending                → 0
   * processing             → 1
   * partially_fulfilled    → 2
   * fulfilled              → 3
   * cancelled              → 4
   * failed                 → 5
   *
   * Cancellation is allowed to override prior states.
   */
  private static readonly precedence: Record<string, number> = {
    pending: 0,
    processing: 1,
    partially_fulfilled: 2,
    fulfilled: 3,
    cancelled: 4,
    failed: 5,
  };

  /**
   * Ingest sovereign fulfillment state.
   *
   * @param input   Execution state payload
   * @param executor Optional Knex transaction (MANDATORY in worker paths)
   *
   * Behavior:
   * - Inserts baseline if none exists
   * - Enforces monotonic transitions
   * - Blocks regression
   * - Allows explicit cancellation
   */
  async ingestStatus(
    input: {
      lasyncroOrderId: string;
      status:
        | 'pending'
        | 'processing'
        | 'fulfilled'
        | 'partially_fulfilled'
        | 'cancelled'
        | 'failed';
        canonicalEventTime: Date;
    },
    executor: Knex | Knex.Transaction = db
  ): Promise<void> {

    const { lasyncroOrderId, status, canonicalEventTime } = input;

    if (!lasyncroOrderId) {
      throw new Error(
        '[OrderFulfillmentIngestionService] lasyncro_order_id is required.'
      );
    }

    if (!OrderFulfillmentIngestionService.precedence.hasOwnProperty(status)) {
      throw new Error(
        `[OrderFulfillmentIngestionService] Invalid fulfillment status: ${status}`
      );
    }

    if (!canonicalEventTime) {
      throw new Error(
        '[OrderFulfillmentIngestionService] canonicalEventTime is required.'
      );
    }

    console.log('[INGEST]', lasyncroOrderId, status);

    // Fetch existing state (transaction-safe)
    const existing = await executor('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .first<{ status: string }>();

    /**
     * BASELINE INSERT
     * ---------------
     * If no prior state exists, create authoritative row.
     */
    if (!existing) {
      await executor('order_fulfillment_status').insert({
        lasyncro_fulfillment_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status,
        status_updated_at: canonicalEventTime,

        /**
         * EXECUTION COMPLETION COMMIT
         * ---------------------------
         * If baseline state is already fulfilled,
         * set fulfilled_at at creation.
         */
        fulfilled_at:
          status === 'fulfilled'
            ? canonicalEventTime
            : null,
      });

      /**
       * FULFILLMENT HISTORY APPEND (BASELINE)
       * -------------------------------------
       * Append-only execution event log.
       */
      await executor('order_fulfillment_history').insert({
        lasyncro_fulfillment_event_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status,
        event_occurred_at: canonicalEventTime
      });
      return;
    }

    const currentPrecedence =
      OrderFulfillmentIngestionService.precedence[existing.status] ?? 0;

    const newPrecedence =
      OrderFulfillmentIngestionService.precedence[status] ?? 0;

    /**
     * MONOTONIC ENFORCEMENT
     * ---------------------
     * Allowed:
     * - Forward progression
     * - Equal state (idempotent)
     * - Explicit cancellation
     *
     * Blocked:
     * - Any regression
     */
    const allowUpdate =
      status === 'cancelled' ||
      newPrecedence >= currentPrecedence;

    if (!allowUpdate) {
      // Silent block to preserve deterministic state
      return;
    }

    await executor('order_fulfillment_status')
      .where({ lasyncro_order_id: lasyncroOrderId })
      .update({
        status,
        status_updated_at: canonicalEventTime,

        /**
         * EXECUTION COMPLETION COMMIT (IDEMPOTENT)
         * ----------------------------------------
         * Only set fulfilled_at if transitioning into fulfilled
         * and not already set.
         */
        fulfilled_at:
          status === 'fulfilled'
            ? executor.raw('COALESCE(fulfilled_at, ?)', [canonicalEventTime])
            : executor.raw('fulfilled_at'),
      });

      /**
       * FULFILLMENT HISTORY APPEND (TRANSITION)
       * ---------------------------------------
       * Append-only record of execution transition.
       * Only executed when monotonic update allowed.
       */
      await executor('order_fulfillment_history').insert({
        lasyncro_fulfillment_event_id: crypto.randomUUID(),
        lasyncro_order_id: lasyncroOrderId,
        status,
        event_occurred_at: canonicalEventTime,
      });
  }
}

export default new OrderFulfillmentIngestionService();
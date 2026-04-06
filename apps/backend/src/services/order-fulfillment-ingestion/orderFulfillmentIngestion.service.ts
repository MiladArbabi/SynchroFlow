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
      shopId: number;
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

    const { lasyncroOrderId, shopId, status, canonicalEventTime } = input;

    if (!lasyncroOrderId) {
      throw new Error(
        '[OrderFulfillmentIngestionService] lasyncro_order_id is required.'
      );
    }

    if (!shopId) {
      throw new Error(
        '[OrderFulfillmentIngestionService] shopId is required for constraint evaluation.'
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
    };

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
       * IDEMPOTENT HISTORY APPEND
       * -------------------------
       * ON CONFLICT DO NOTHING guards against duplicate
       * fulfillment events with identical (lasyncro_order_id,
       * status, event_occurred_at) — e.g. replay or backfill.
       *
       * lasyncro_fulfillment_event_id is intentionally excluded
       * from the conflict target — it is a surrogate key only.
       */
      await executor('order_fulfillment_history')
        .insert({
          lasyncro_fulfillment_event_id: crypto.randomUUID(),
          lasyncro_order_id: lasyncroOrderId,
          status,
          event_occurred_at: canonicalEventTime
        })
        .onConflict(['lasyncro_order_id', 'status', 'event_occurred_at'])
        .ignore();

      return;
    }

    const currentPrecedence =
      OrderFulfillmentIngestionService.precedence[existing.status] ?? 0;

    const newPrecedence =
      OrderFulfillmentIngestionService.precedence[status] ?? 0;

    /**
     * MONOTONIC TRANSITION GUARD (CRITICAL)
     * -------------------------------------
     * - Prevents state regression
     * - Allows:
     *    - forward progression
     *    - equal state (idempotency)
     *    - explicit cancellation override
     */
    const allowUpdate =
      status === 'cancelled' ||
      newPrecedence >= currentPrecedence;

    console.info('[FULFILLMENT_PRECEDENCE_CHECK]', {
      lasyncroOrderId,
      incomingStatus: status,
      existingStatus: existing.status,
      newPrecedence,
      currentPrecedence,
      allowUpdate,
    });

    if (!allowUpdate) {
      // Silent block to preserve deterministic state
      return;
    }

    /**
     * UPSERT (RAW — FIXES KNEX AMBIGUITY BUG)
     * ----------------------------------------
     * Replaces .update() which generates invalid ON CONFLICT SQL.
     */
    await executor.raw(
      `
      INSERT INTO order_fulfillment_status (
        lasyncro_fulfillment_id,
        lasyncro_order_id,
        status,
        status_updated_at,
        fulfilled_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (lasyncro_order_id)
      DO UPDATE SET
        status = EXCLUDED.status,
        status_updated_at = EXCLUDED.status_updated_at,
        fulfilled_at = CASE
          WHEN EXCLUDED.status = 'fulfilled'
          THEN COALESCE(order_fulfillment_status.fulfilled_at, EXCLUDED.status_updated_at)
          ELSE order_fulfillment_status.fulfilled_at
        END
      `,
      [
        crypto.randomUUID(),
        lasyncroOrderId,
        status,
        canonicalEventTime,
        status === 'fulfilled' ? canonicalEventTime : null,
      ]
    );

      /**
       * IDEMPOTENT HISTORY APPEND
       * -------------------------
       * Same guard as baseline insert above.
       * Protects monotonic-path writes from replay duplicates.
       */
      await executor('order_fulfillment_history')
        .insert({
          lasyncro_fulfillment_event_id: crypto.randomUUID(),
          lasyncro_order_id: lasyncroOrderId,
          status,
          event_occurred_at: canonicalEventTime,
        })
        .onConflict(['lasyncro_order_id', 'status', 'event_occurred_at'])
        .ignore();
  }
}

export default new OrderFulfillmentIngestionService();
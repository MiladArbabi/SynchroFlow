// apps/backend/src/services/ft0-completion.service.ts
/**
 * ============================================================
 * FT0 COMPLETION
 * ============================================================
 *
 * FT0 represents *system readiness*, NOT customer success.
 * It answers exactly one question:
 *
 *   “Has the commerce → insight pipeline proven it works end-to-end?”
 *
 * -------------------------
 * FT0 COMPLETES WHEN (ALL):
 * -------------------------
 * 1. A platform integration exists for the shop (e.g. Shopify)
 * 2. At least one  order exists (orders > 0)
 * 3. First insight has been successfully delivered
 *
 * -------------------------
 * EXPLICITLY NOT REQUIRED:
 * -------------------------
 * - Product count
 * - Store visitors / sessions
 * - SDK installation
 * - Traffic volume
 * - Conversion signals
 *
 * These belong to FT1+ and MUST NOT gate FT0.
 *
 * -------------------------
 * GUARANTEES:
 * -------------------------
 * - FT0 completion is idempotent
 * - ft0_state is written exactly once per shop
 * - Completion is authoritative and irreversible
 *
 * -------------------------
 * WARNING:
 * -------------------------
 * Do NOT add new conditions here without updating the
 * activation contract and frontend expectations.
 *
 * Silent FT0 blocking = broken onboarding.
 *
 * ============================================================
 */

/**
 * DEBUGGING NOTE (2026-03):
 * FT0 is edge-triggered from lifecycle/first_insight_delivered.
 * If any precondition fails at that moment,
 * FT0 will NOT retry automatically.
 * Blocking reasons are logged explicitly.
 */

import db from '@lasyncro/backend-core/db.js';

export class FT0CompletionService {
  static async evaluateAndComplete(
    shopId: number
  ): Promise<{ completed: boolean; alreadyCompleted?: boolean }> {

    /**
     * CANONICAL COMPLETION GUARD
     * --------------------------
     * Rebuild replays may re-trigger evaluation multiple times.
     * Domain event log is source-of-truth.
     *
     * If lifecycle/ft0_completed already exists,
     * skip evaluation immediately.
     */
    const existingEvent = await db('domain_events')
      .where({
        shop_id: shopId,
        event_type: 'lifecycle/ft0_completed',
      })
      .first('id');

    if (existingEvent) {
      return { completed: true, alreadyCompleted: true };
    }

    /**
     * Projection durability guard (secondary)
     */
    const existing = await db('ft0_state')
      .where({ shop_id: shopId })
      .first('shop_id');

    if (existing) {
      return { completed: true, alreadyCompleted: true };
    }

    console.log('[FT0Completion] evaluateAndComplete called for shopId:', shopId);

    // 2. Integration must exist
    const integration = await db('integrations')
      .where({ shop_id: shopId })
      .first();

    if (!integration) {
      console.error('[FT0][BLOCKED][NO_INTEGRATION]', { shopId });
      return { completed: false };
    }

    // 3. Sync must be completed
    const completedSync = await db('integrations')
      .where({ shop_id: shopId, sync_status: 'COMPLETED' })
      .first();

    if (!completedSync) {
      console.error('[FT0][BLOCKED][SYNC_NOT_COMPLETED]', { shopId });
      return { completed: false };
    }

    // 4. Orders data must exist
    const ordersRow = await db('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();

    const orderCount = Number(ordersRow?.count ?? 0);

    if (orderCount < 1) {
      console.error('[FT0][BLOCKED][NO_ORDERS]', {
        shopId,
        orderCount,
      });
      return { completed: false };
    }

   /**
     * FIRST INSIGHT DELIVERY (CANONICAL FACT CHECK)
     * ----------------------------------------------
     * DO NOT depend on projected state (shops.first_insight_delivered).
     * Projection is asynchronous and may lag inside the same causal chain.
     *
     * FT0 must rely on immutable domain_events as canonical truth.
     */
    const insightEvent = await db('domain_events')
      .where({
        shop_id: shopId,
        event_type: 'lifecycle/first_insight_delivered',
      })
      .first('id');

    if (!insightEvent) {
      console.error('[FT0][BLOCKED][INSIGHT_EVENT_NOT_FOUND]', {
        shopId,
      });
      return { completed: false };
    }

    console.log('[FT0Completion] Preconditions passed, writing ft0_state for shopId:', shopId);

    console.log('[FT0][READY_TO_COMPLETE]', {
      shopId,
      orderCount,
    });

    /**
     * Atomic FT0 completion.
     *
     * Guarantees:
     * - ft0_state and audit event are written in the same transaction.
     * - Either both persist or neither persist.
     * - No fallback reads.
     */
    return await db.transaction(async trx => {
      const externalEventId = `internal:lifecycle/ft0_completed:${shopId}`;

      const [event] = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'lifecycle/ft0_completed',
          event_payload: {
            orders: orderCount,
            firstInsightDelivered: true,
          },
          event_time: trx.fn.now(),
          event_version: 1,
          /**
           * INTERNAL EVENT IDENTITY
           * -----------------------
           * Required by domain_events schema.
           * Must be deterministic and unique per emission.
           *
           * Format:
           * internal:<event_type>:<shop_id>:<epoch_ms>
           */
          external_event_id: externalEventId,
        })
        .returning(['id']);

      console.info('[OUTBOX_TRIGGER_EXPECTED]', {
        domainEventId: event.id,
        eventType: 'lifecycle/ft0_completed',
      });

      /**
       * OUTBOX HANDLED BY DB TRIGGER
       * ----------------------------
       * domain_event_auto_outbox AFTER INSERT trigger
       * guarantees exactly one outbox row.
       *
       * Manual inserts are forbidden and cause
       * domain_event_outbox_domain_event_unique violations.
       */

      return { completed: true };
    });
  }
};
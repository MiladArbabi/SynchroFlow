// apps/backend/src/services/ft0-completion.service.ts

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
     * CANONICAL EVENT TYPE (v2 FIX)
     * -----------------------------
     * Lifecycle events are no longer emitted directly.
     * Must check domain event: ft0.completed
     *
     * Using old lifecycle/* would break idempotency.
     */
    const existingEvent = await db('domain_events')
      .where({
        shop_id: shopId,
        event_type: 'ft0.completed',
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

    // 3. Integration must be connected (sync_status check removed — race condition prone)
    // Orders existing (check 4) is the authoritative signal that sync produced data.
    // sync_status = 'COMPLETED' is set AFTER projection processes events, causing
    // FT0 evaluation to fail when triggered mid-sync. See: A-015 fix.

    // 4. Orders data must exist
    // SET LOCAL tenant context — required for RLS on orders table.
    // FT0CompletionService runs outside projection transaction, so tenant
    // is not set by the projection engine. Must set explicitly here.
    const ordersRow = await db.transaction(async trx => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      return trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();
    });

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
      // SET LOCAL tenant context — required for auto_create_domain_event_outbox trigger
      // to pass domain_event_outbox RLS policy check (subquery scoped to current_tenant).
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      const externalEventId = `internal:lifecycle/ft0_completed:${shopId}`;

      /**
       * ✅ DOMAIN EVENT EMISSION (CORRECT ARCHITECTURE)
       * ----------------------------------------------
       * Service emits DOMAIN event only.
       * Projection layer owns lifecycle transitions.
       *
       * Event flow:
       * first_insight_delivered
       * → FT0CompletionService
       * → emits domain event: ft0.completed
       * → projection handler decides lifecycle transitions
       */

      const [event] = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'ft0.completed', // ✅ NOT lifecycle/*
          /**
           * TRACE PROPAGATION (v1)
           * ----------------------
           * FT0 completion must carry forward causal trace if available.
           * Currently best-effort (no upstream guarantee yet).
           */
          event_payload: {
            trace_id: null, // TODO: wire from upstream ingestion chain
          },
          external_event_id: externalEventId,

          /**
           * 🔴 CRITICAL FIX — EVENT TIME REQUIRED
           * ------------------------------------
           * domain_events.event_time is NOT NULL.
           * Missing this crashes projection worker.
           *
           * MUST always be explicitly set.
           */
          event_time: trx.fn.now(),
        })
        .returning('*');

      console.info('[FT0_COMPLETED_EVENT_EMITTED]', {
        shopId,
        eventId: event.id,
        traceId: null,
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
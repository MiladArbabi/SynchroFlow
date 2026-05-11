// apps/backend/src/services/first-insight.service.ts

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';

type OrdersPerMonthSegment =
  | '1-50'
  | '51-200'
  | '201-500'
  | '501-1000'
  | '1000+';

export class FirstInsightService {
  /**
   * Computes and persists the FIRST insight for a shop.
   * This is the ONLY place allowed to set first_insight_delivered = true.
   */
  static async computeAndPersist(shopId: number): Promise<{
    delivered: boolean;
    alreadyDelivered?: boolean;
  }> {
    // 1. Guard: shop must exist
    const shop = await db('shops')
      .where({ id: shopId })
      .first([
        'id',
        'first_insight_delivered',
      ]);

    if (!shop) {
      return { delivered: false };
    }

    // 2. Idempotency: already delivered → exit
    if (shop.first_insight_delivered) {
      return { delivered: true, alreadyDelivered: true };
    }

    // 3. Compute monthly order volume (FACT: orders exists)
    // SET LOCAL tenant context — required for RLS on orders table.
    const result = await db.transaction(async trx => {
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      return trx('orders')
        .where({ shop_id: shopId })
        .count<{ count: string }>('* as count')
        .first();
    });

    const orderCount = Number(result?.count ?? 0);

    if (orderCount < 1) {
      // No insight possible yet
      return { delivered: false };
    }

    // 4. Derive segment (pure, deterministic)
    const segment: OrdersPerMonthSegment =
      orderCount <= 50
        ? '1-50'
        : orderCount <= 200
        ? '51-200'
        : orderCount <= 500
        ? '201-500'
        : orderCount <= 1000
        ? '501-1000'
        : '1000+';

    /**
     * EMISSION IDEMPOTENCY GUARD
     * --------------------------
     * Prevent duplicate lifecycle/first_insight_delivered events.
     * Canonical check against domain_events.
     */
    const existingEvent = await db('domain_events')
      .where({
        shop_id: shopId,
        event_type: 'lifecycle/first_insight_delivered',
      })
      .first('id');

    if (existingEvent) {
      return { delivered: true, alreadyDelivered: true };
    }

    // 5. Atomic persist + audit
    /**
     * DOMAIN EVENT EMISSION — FIRST INSIGHT DELIVERED
     * ------------------------------------------------
     * Service no longer mutates durability state directly.
     * Emits immutable domain event.
     *
     * Projection worker is responsible for:
     * - Setting shops.first_insight_delivered = true
     * - Writing activation_audit_events
     *
     * Guarantees:
     * - Deterministic replay
     * - No side-channel durability writes
     */
    await db.transaction(async trx => {
      // SET LOCAL tenant context — required for auto_create_domain_event_outbox trigger
      // to pass domain_event_outbox RLS policy check (subquery scoped to current_tenant).
      await trx.raw(`SET LOCAL app.current_tenant = '${shopId}'`);
      const externalEventId = `internal:lifecycle/first_insight_delivered:${shopId}`;
      const [event] = await trx('domain_events')
        .insert({
          shop_id: shopId,
          event_type: 'lifecycle/first_insight_delivered',
          event_payload: {
            insight: 'orders_per_month_segment',
            value: segment,
            orderCount,
          },
          event_time: trx.fn.now(),
          event_version: 1,
          external_event_id: externalEventId,
        })
        .returning(['id']);

      console.info('[OUTBOX_TRIGGER_EXPECTED]', {
        domainEventId: event.id,
        eventType: 'lifecycle/first_insight_delivered',
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

    });

    return { delivered: true };
  }
}
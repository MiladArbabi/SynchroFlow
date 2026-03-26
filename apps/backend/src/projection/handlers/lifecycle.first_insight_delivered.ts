// apps/backend/src/projection/handlers/lifecycle.first_insight_delivered.ts
import crypto from 'crypto';
import { Knex } from 'knex';

/**
 * HANDLE: lifecycle/first_insight_delivered
 * -----------------------------------------
 *
 * Contract:
 * - Emitted by FirstInsightService
 * - Immutable domain event
 * - Projection performs durability mutation + audit
 *
 * Guarantees:
 * - Monotonic cursor enforcement (transaction-bound)
 * - Idempotent via shops.first_insight_delivered flag
 * - Deterministic replay safety
 */
export async function handleLifecycleFirstInsightDelivered({
  domainEvent,
  domain_event_id,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {
  const payload = domainEvent.event_payload as {
    insight: string;
    value: string;
    orderCount: number;
  };

    /**
     * Canonical event-time anchor
     * MUST derive exclusively from domain_events.event_time.
     */
    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    const shopId = domainEvent.shop_id;
    const eventTime = new Date(eventRow.event_time);

    /**
     * Idempotent durability mutation
     * --------------------------------
     * Only flip flag if not already delivered.
     */
    const updated = await trx('shops')
      .where({ id: shopId, first_insight_delivered: false })
      .update({
        first_insight_delivered: true,
        updated_at: eventTime,
      });

    /**
     * Activation audit
     * -----------------
     * Write audit only if state actually changed.
     */
    if (updated > 0) {
      await trx('activation_audit_events').insert({
        event_id: crypto.randomUUID(),
        event_type: 'FIRST_INSIGHT_DELIVERED',
        shop_id: shopId,
        occurred_at: eventTime,
        payload,
      });
    }
  };
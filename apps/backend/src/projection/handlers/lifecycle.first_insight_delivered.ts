// apps/backend/src/projection/handlers/lifecycle.first_insight_delivered.ts
import crypto from 'crypto';
import { Knex } from 'knex';
/**
 * PROJECTION STREAM
 * -----------------
 * Lifecycle events MUST use independent cursor.
 */
const LIFECYCLE_PROJECTION = 'lifecycle_projection';

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
     * CURSOR ENFORCEMENT MOVED
     * ------------------------
     * Projection ordering is now enforced centrally
     * in projection.engine.ts.
     *
     * Handlers must remain pure projection logic
     * without queue or cursor coordination.
     */

    /**
     * PROJECTION CONTRACT
     * -------------------
     * Handler must be:
     * - deterministic
     * - side-effect free outside trx
     * - transaction-neutral
     *
     * The projection engine guarantees ordering
     * and atomic commit across handlers.
     */

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

    /**
     * FT0 EVALUATION TRIGGER
     * ----------------------
     * Lifecycle transitions must NOT occur in this handler.
     */

    /**
     * FT0 COMPLETION EVALUATION
     * -------------------------
     * First insight delivery is the final FT0 precondition.
     *
     * Evaluate FT0 readiness here.
     * If conditions are satisfied, the service will emit:
     *
     *   lifecycle/ft0_completed
     *
     * which is later projected by lifecycle.ft0_completed.ts.
     *
     * IMPORTANT:
     * This does NOT mutate lifecycle state directly.
     * It only emits a domain event if readiness criteria pass.
     */
    const { FT0CompletionService } = await import(
      '../../services/ft0-completion.service.js'
    );

    await FT0CompletionService.evaluateAndComplete(shopId);
  };
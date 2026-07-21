// apps/backend/src/projection/handlers/lifecycle.ft2_confirmed.ts
import { Knex } from 'knex';

/**
 * PROJECTION STREAM
 * -----------------
 * Lifecycle events MUST use independent cursor.
 */
const LIFECYCLE_PROJECTION = 'lifecycle_projection';

/**
 * HANDLE: lifecycle/ft2_confirmed
 * --------------------------------
 *
 * Contract:
 * - Event emitted by lifecycle.controller.ts
 * - Immutable domain event
 * - Projection performs ALL durability mutations
 *
 * Guarantees:
 * - Monotonic cursor enforcement (transaction-bound)
 * - Deterministic replay safety
 * - Idempotent via shop_id uniqueness constraints
 */
export async function handleLifecycleFT2Confirmed({
  domainEvent,
  domain_event_id,
  canonicalEventTime,
  trx,
}: {
  domainEvent: any;
  domain_event_id: number;
  canonicalEventTime: Date;
  trx: Knex.Transaction;
}) {
  const payload = domainEvent.event_payload as {
    user_id: number;
    evaluator_version: string;
    evaluation_snapshot: any;
  };

  /**
   * TRANSACTION CONTRACT
   * Projection engine owns the transaction boundary.
   * Handlers must reuse provided trx.
   */
    
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
     * Canonical event-time anchor
     * MUST derive exclusively from domain_events.event_time.
     */
    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    const shopId = domainEvent.shop_id;
    const eventTime = new Date(eventRow.event_time);

    /**
     * Durable FT2 latch
     */
    await trx('ft2_state')
      .insert({
        shop_id: shopId,
        completed_at: eventTime,
        evaluator_version: payload.evaluator_version,
        evaluation_snapshot: payload.evaluation_snapshot,
      })
      .onConflict('shop_id')
      .ignore();

    /**
     * Eligibility backbone
     * ---------------------
     * Upsert to preserve latest evaluator state.
     */
    await trx('expansion_eligibility_state')
      .insert({
        shop_id: shopId,
        eligible: true,
        evaluator_version: payload.evaluator_version,
        evaluation_snapshot: payload.evaluation_snapshot,
        evaluated_at: eventTime,
      })
      .onConflict('shop_id')
      .merge({
        eligible: true,
        evaluator_version: payload.evaluator_version,
        evaluation_snapshot: payload.evaluation_snapshot,
        evaluated_at: eventTime,
        updated_at: eventTime,
      });

    /**
     * Lifecycle transition MUST go through service.
     * Direct mutation forbidden.
     */
    const { LifecycleTransitionService } = await import(
      '../../services/lifecycle-transition.service.js'
    );

    try {
      await LifecycleTransitionService.auditIfTransitioned(
        {
          userId: payload.user_id,
          shopId,
          currentPhase: 'FT2',
        },
        trx
      );
    } catch (err) {
      // Invalid lifecycle transition (e.g. FT_MINUS_ONE->FT2 from seed data that
      // bypassed the lifecycle controller and skipped ft0/completed).
      // Warn and skip — do NOT propagate. The projection worker must not crash on
      // invalid lifecycle states created outside the normal registration flow.
      console.warn('[LIFECYCLE][FT2_CONFIRMED][TRANSITION_SKIP]', {
        shopId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };
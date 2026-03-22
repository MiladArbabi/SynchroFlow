// apps/backend/src/projection/handlers/lifecycle.ft0_completed.ts

/**
 * LIFECYCLE — FT0 COMPLETED HANDLER
 * ----------------------------------
 * Mechanical extraction from projection.engine.ts.
 *
 * No behavior changes.
 * Non-deterministic crypto.randomUUID preserved.
 * Dynamic import preserved.
 */

import crypto from 'crypto';
import { Knex } from 'knex';

const LIFECYCLE_PROJECTION = 'lifecycle_projection';

export async function handleLifecycleFT0Completed({
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
    orders: number;
    firstInsightDelivered: boolean;
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

    const eventRow = await trx('domain_events')
      .where({ id: domain_event_id })
      .first();

    const shopId = domainEvent.shop_id;
    const eventTime = new Date(eventRow.event_time);

    await trx('ft0_state')
      .insert({
        shop_id: shopId,
        status: 'COMPLETED',
        completed_at: eventTime,
        completion_reason: payload,
      })
      .onConflict('shop_id')
      .ignore();

    await trx('system_readiness_state')
      .insert({
        shop_id: shopId,
        became_ready_at: eventTime,
      })
      .onConflict('shop_id')
      .ignore();

    await trx('activation_audit_events')
      .insert({
        event_id: crypto.randomUUID(),
        event_type: 'FT0_COMPLETED',
        shop_id: shopId,
        occurred_at: eventTime,
        payload,
      });

    const members = await trx('shop_memberships')
      .where({ shop_id: shopId })
      .select<{ user_id: number }[]>('user_id');

    for (const member of members) {
      const userId = member.user_id;

      const { LifecycleTransitionService } = await import(
        '../../services/lifecycle-transition.service.js'
      );

      await LifecycleTransitionService.auditIfTransitioned(
        {
          userId,
          shopId,
          currentPhase: 'FT0',
        },
        trx
      );

      await LifecycleTransitionService.auditIfTransitioned(
        {
          userId,
          shopId,
          currentPhase: 'FT1',
        },
        trx
      );
    }

    /**
     * CURSOR ADVANCEMENT REMOVED
     * --------------------------
     * Projection engine centrally manages replay progress.
     * Handlers must remain pure projection logic.
     */
  };
// apps/backend/src/projection/handlers/lifecycle.ft0_completed.ts

/**
 * LIFECYCLE — FT0 COMPLETED HANDLER
 * ----------------------------------
 * Mechanical extraction from projection.engine.ts.
 *
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 1: the FT0/FT1
 * materialization body (ft0_state, system_readiness_state,
 * activation_audit_events, lifecycle transitions, sync-completed email)
 * was extracted into the shared materializeFT0Completion() so the new
 * zero-order integration/sync_completed handler can produce identical
 * state. This handler's own trigger and populated-store semantics are
 * unchanged — it still fires only from ft0.completed, still resolves the
 * founding owner the same canonical way, still no-ops when a snapshot
 * already exists at or past FT0/FT1.
 */

import { Knex } from 'knex';
import { resolveFoundingOwner } from '../../services/founding-owner.service.js';
import { materializeFT0Completion } from '../../services/ft0-completion-materializer.service.js';

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

  const eventRow = await trx('domain_events')
    .where({ id: domain_event_id })
    .first();

  const shopId = domainEvent.shop_id;
  const eventTime = new Date(eventRow.event_time);

  const foundingOwnerUserId = await resolveFoundingOwner(shopId, trx);

  await materializeFT0Completion({
    shopId,
    trx,
    eventTime,
    completionReason: payload,
    foundingOwnerUserId,
  });

  /**
   * CURSOR ADVANCEMENT REMOVED
   * --------------------------
   * Projection engine centrally manages replay progress.
   * Handlers must remain pure projection logic.
   */
}

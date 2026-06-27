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

      /**
       * 🛡️ FT0 IDEMPOTENCY GUARD (v2 FIX)
       * ----------------------------------
       * FT0 may already be entered earlier (forced entry).
       * Prevent duplicate FT0 → FT0 transition crash.
       */
      const snapshot = await trx('user_lifecycle_snapshot')
        .where({ shop_id: shopId })
        .first('phase');

      /**
       * REPLAY IDEMPOTENCY GUARD (CRITICAL)
       * ------------------------------------
       * During projection replay, the shop may already be in FT1 or FT2.
       * Attempting FT0 transition from a later phase crashes the worker.
       *
       * Guard: only attempt FT0 transition if shop is still in FT_MINUS_ONE.
       * Any phase at or past FT0 means this event was already processed.
       */
      const phasesBeforeFT0 = ['FT_MINUS_ONE'];
      if (phasesBeforeFT0.includes(snapshot?.phase)) {
        await LifecycleTransitionService.auditIfTransitioned(
          {
            userId,
            shopId,
            currentPhase: 'FT0',
          },
          trx
        );
      } else {
        console.info('[FT0_TRANSITION_SKIP_ALREADY_PAST]', {
          shopId,
          currentPhase: snapshot?.phase,
        });
      }

      /**
       * REPLAY IDEMPOTENCY GUARD — FT1
       * --------------------------------
       * Only attempt FT1 transition if shop is in FT0.
       * FT1 or FT2 means this event was already processed.
       */
      const currentSnapshot = await trx('user_lifecycle_snapshot')
        .where({ shop_id: shopId })
        .first('phase');
      const phasesBeforeFT1 = ['FT_MINUS_ONE', 'FT0'];
      if (phasesBeforeFT1.includes(currentSnapshot?.phase)) {
        await LifecycleTransitionService.auditIfTransitioned(
          {
            userId,
            shopId,
            currentPhase: 'FT1',
          },
          trx
        );
      } else {
        console.info('[FT1_TRANSITION_SKIP_ALREADY_PAST]', {
          shopId,
          currentPhase: currentSnapshot?.phase,
        });
      };
    }

    // Send sync completed email — to custom notify email if set, else registered email
    try {
      const { sendSyncCompletedEmail } = await import(
        '../../services/email/email.service.js'
      );
      const integration = await trx('integrations')
        .where({ shop_id: shopId })
        .first('sync_notify_email');

      const customNotifyEmail = integration?.sync_notify_email ?? null;

      const users = await trx('users')
        .whereIn('id', members.map((m: { user_id: number }) => m.user_id))
        .select('email', 'first_name');

      for (const user of users) {
        const targetEmail = customNotifyEmail ?? user.email;
        sendSyncCompletedEmail({
          toEmail: targetEmail,
          firstName: user.first_name ?? '',
        }).catch((err: unknown) => {
          console.error('[FT0_COMPLETED] sync completed email failed', { err });
        });
      }
    } catch (err) {
      console.error('[FT0_COMPLETED] email dispatch error', err);
    }

    /**
     * CURSOR ADVANCEMENT REMOVED
     * --------------------------
     * Projection engine centrally manages replay progress.
     * Handlers must remain pure projection logic.
     */
  };
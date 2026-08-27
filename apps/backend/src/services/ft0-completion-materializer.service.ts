// apps/backend/src/services/ft0-completion-materializer.service.ts

/**
 * FT0/FT1 COMPLETION MATERIALIZER (SHARED)
 * -----------------------------------------
 * SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02, Slice 1.
 *
 * Extracted from lifecycle.ft0_completed.ts. Both the orders-triggered
 * ft0.completed projection handler and the new zero-order
 * integration/sync_completed handler call this to materialize identical
 * FT0/FT1 state — one code path, two entry points.
 *
 * Lifecycle anchoring vs. notification recipients are DIFFERENT concerns:
 * - lifecycle phase transitions use ONLY the canonical founding owner
 *   (foundingOwnerUserId), resolved once by the caller via
 *   founding-owner.service.ts — never iterate shop_memberships for this.
 *   An unordered per-member loop was the original ft0_completed
 *   behavior; it was masked by orders.create.ts always anchoring first
 *   for every currently-shipped path, but is unsafe as the FIRST writer,
 *   which the new zero-order path now is. Corrected here.
 * - the sync-completed email fans out to EVERY shop member, unchanged
 *   from the original behavior.
 *
 * Does NOT attempt to make activation_audit_events or the email send
 * globally idempotent — that is pre-existing ft0_completed behavior,
 * out of scope for this issue. Callers own their own invocation guards:
 * the populated path relies on auditIfTransitioned's own replay guard;
 * the zero-order path relies on its own "snapshot absent" self-exclusion
 * before ever calling this function.
 */
import crypto from 'crypto';
import { Knex } from 'knex';

export type FT0CompletionReason = Record<string, unknown>;

export async function materializeFT0Completion({
  shopId,
  trx,
  eventTime,
  completionReason,
  foundingOwnerUserId,
}: {
  shopId: number;
  trx: Knex.Transaction;
  eventTime: Date;
  completionReason: FT0CompletionReason;
  foundingOwnerUserId: number;
}): Promise<void> {
  await trx('ft0_state')
    .insert({
      shop_id: shopId,
      status: 'COMPLETED',
      completed_at: eventTime,
      completion_reason: completionReason,
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

  await trx('activation_audit_events').insert({
    event_id: crypto.randomUUID(),
    event_type: 'FT0_COMPLETED',
    shop_id: shopId,
    occurred_at: eventTime,
    payload: completionReason,
  });

  /**
   * LIFECYCLE ANCHORING — FOUNDING OWNER ONLY
   * ------------------------------------------
   * A single transition call per phase, using the canonical founding
   * owner. Never iterate shop_memberships here — see file header.
   */
  const { LifecycleTransitionService } = await import(
    './lifecycle-transition.service.js'
  );

  const snapshot = await trx('user_lifecycle_snapshot')
    .where({ shop_id: shopId })
    .first('phase');

  /**
   * REPLAY IDEMPOTENCY GUARD — FT0
   * --------------------------------
   * Only attempt FT0 transition if shop is still in FT_MINUS_ONE. Any
   * phase at or past FT0 means this event was already processed (or the
   * OTHER trigger already anchored the shop first).
   *
   * NEWLY EXPOSED DEFECT (SHOP-REVIEW-ZERO-ORDER-LIFECYCLE-02): a truly
   * absent snapshot row (snapshot === undefined) yields
   * snapshot?.phase === undefined, and ['FT_MINUS_ONE'].includes(undefined)
   * is false — the original ft0_completed.ts guard therefore skipped the
   * FIRST-EVER transition instead of performing it. This was always
   * latent but never triggered: the populated-store caller always had a
   * snapshot already anchored by orders.create.ts before ft0.completed
   * ever fired. The zero-order caller is the first to reach this guard
   * with a genuinely absent row, exposing it. Absence of a snapshot row
   * IS 'FT_MINUS_ONE' — see lifecycle.service.ts's own documented
   * contract — so it must be normalized here, not compared to undefined.
   */
  const phasesBeforeFT0 = ['FT_MINUS_ONE'];
  if (phasesBeforeFT0.includes(snapshot?.phase ?? 'FT_MINUS_ONE')) {
    await LifecycleTransitionService.auditIfTransitioned(
      { userId: foundingOwnerUserId, shopId, currentPhase: 'FT0' },
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
   * Only attempt FT1 transition if shop is in FT0. FT1 or FT2 means this
   * event was already processed.
   */
  const currentSnapshot = await trx('user_lifecycle_snapshot')
    .where({ shop_id: shopId })
    .first('phase');

  const phasesBeforeFT1 = ['FT_MINUS_ONE', 'FT0'];
  if (phasesBeforeFT1.includes(currentSnapshot?.phase ?? 'FT_MINUS_ONE')) {
    await LifecycleTransitionService.auditIfTransitioned(
      { userId: foundingOwnerUserId, shopId, currentPhase: 'FT1' },
      trx
    );
  } else {
    console.info('[FT1_TRANSITION_SKIP_ALREADY_PAST]', {
      shopId,
      currentPhase: currentSnapshot?.phase,
    });
  }

  /**
   * NOTIFICATION FAN-OUT — ALL MEMBERS
   * ------------------------------------
   * Deliberately separate from lifecycle anchoring above. Preserves the
   * original per-member email behavior unchanged — every shop member is
   * notified, not just the founding owner.
   */
  if (process.env.DEV_SEED_MODE) {
    console.info('[FT0_COMPLETED] sync completed email skipped (DEV_SEED_MODE)', { shopId });
    return;
  }

  try {
    const { sendSyncCompletedEmail } = await import(
      './email/email.service.js'
    );

    const integration = await trx('integrations')
      .where({ shop_id: shopId })
      .first('sync_notify_email');

    const customNotifyEmail = integration?.sync_notify_email ?? null;

    const members = await trx('shop_memberships')
      .where({ shop_id: shopId })
      .select<{ user_id: number }[]>('user_id');

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
}

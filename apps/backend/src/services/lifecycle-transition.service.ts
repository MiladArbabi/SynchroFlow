// apps/backend/src/services/lifecycle-transition.service.ts

import db from '@lasyncro/backend-core/db.js';
import crypto from 'crypto';
import type { Knex } from 'knex';
import { UserLifecyclePhase } from './lifecycle.service.js';

type AuditInput = {
  userId: number;
  shopId: number;
  currentPhase: UserLifecyclePhase;
};

const AUDITABLE_TRANSITIONS = new Set([
  'FT_MINUS_ONE->FT0',
  'FT0->FT1',
  'FT1->FT2',
]);

/**
 * LifecycleTransitionService — ATOMIC WRITE PROJECTION
 * -----------------------------------------------------
 * Writes:
 *   1. lifecycle_audit_events (ledger)
 *   2. user_lifecycle_snapshot (projection)
 *
 * TRANSACTION CONTRACT:
 * - If trx is provided → participates in caller transaction.
 * - If trx is not provided → opens its own transaction.
 * - Guarantees atomic audit + snapshot projection.
 *
 * No inference.
 * No lifecycle repair.
 * No silent failures.
 */

export class LifecycleTransitionService {
  static async auditIfTransitioned(
    input: AuditInput,
    trx?: Knex.Transaction
  ): Promise<void> {
    if (!trx) {
      return db.transaction(async t => {
        await this.auditIfTransitioned(input, t);
      });
    }

    const { userId, shopId, currentPhase } = input;

    const snapshot = await trx('user_lifecycle_snapshot')
      .where({ user_id: userId })
      .first<{ phase: UserLifecyclePhase }>();

    const previousPhase: UserLifecyclePhase =
      snapshot?.phase ?? 'FT_MINUS_ONE';

    const transitionKey = `${previousPhase}->${currentPhase}`;

    if (!AUDITABLE_TRANSITIONS.has(transitionKey)) {
      console.log('[LIFECYCLE][INVALID_TRANSITION]', {
        userId,
        shopId,
        previousPhase,
        attemptedPhase: currentPhase,
        transitionKey,
      });

      throw new Error(
        `Invalid lifecycle transition: ${transitionKey}`
      );
    }

    const existing = await trx('lifecycle_audit_events')
      .where({
        user_id: userId,
        from_phase: previousPhase,
        to_phase: currentPhase,
      })
      .first();

    if (existing) return;

    const eventId = crypto.randomUUID();
    const occurredAt = trx.fn.now();

    await trx('lifecycle_audit_events')
      .insert({
        event_id: eventId,
        user_id: userId,
        shop_id: shopId,
        from_phase: previousPhase,
        to_phase: currentPhase,
        occurred_at: occurredAt,
      })
      .onConflict(['user_id', 'from_phase', 'to_phase'])
      .ignore();

    /**
     * Dual-write: v2 lifecycle backbone (append-only)
     *
     * lifecycle_events replaces lifecycle_audit_events
     * during read-switch phase.
     */
    await trx('lifecycle_events')
      .insert({
        event_id: eventId,
        shop_id: shopId,
        user_id: userId,
        layer: 'LIFECYCLE',
        event_type: 'PHASE_TRANSITION',
        payload: {
          from: previousPhase,
          to: currentPhase,
        },
        occurred_at: occurredAt,
      })
      .onConflict('event_id')
      .ignore();

    await trx('user_lifecycle_snapshot')
      .insert({
        user_id: userId,
        shop_id: shopId,
        phase: currentPhase,
        since: occurredAt,
        last_event_id: eventId,
        updated_at: trx.fn.now(),
      })
      .onConflict('user_id')
      .merge({
        phase: currentPhase,
        since: occurredAt,
        last_event_id: eventId,
        updated_at: trx.fn.now(),
      });
  }
}

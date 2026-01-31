// apps/backend/src/services/lifecycle-transition.service.ts

import db from 'api-src/db';
import crypto from 'crypto';
import { UserLifecyclePhase } from './lifecycle.service';

type AuditInput = {
  userId: number;
  shopId: number;
  currentPhase: UserLifecyclePhase;
};

const AUDITABLE_TRANSITIONS = new Set([
  'FT_MINUS_ONE->FT0', // lifecycle entry
  'FT0->FT1',
  'FT1->FT2',
]);

/**
 * LifecycleTransitionService — WRITE PROJECTION
 * ---------------------------------------------
 * Records explicit lifecycle transitions and projects them
 * into user_lifecycle_snapshot.
 *
 * RULES:
 * - No lifecycle inference or repair
 * - No backfilling missing phases
 * - Snapshot reflects only explicit transitions
 *
 * Lifecycle authority is NOT decided here.
 * This service is passive and deterministic.
 */

export class LifecycleTransitionService {
  static async auditIfTransitioned(input: AuditInput): Promise<void> {
    const { userId, shopId, currentPhase } = input;

    // 1. Load last known lifecycle phase (if any)
    const last = await db('lifecycle_audit_events')
      .where({ user_id: userId })
      .orderBy('occurred_at', 'desc')
      .first<{ to_phase: UserLifecyclePhase }>();

    const previousPhase: UserLifecyclePhase =
      last?.to_phase ?? 'FT_MINUS_ONE';

    const transitionKey = `${previousPhase}->${currentPhase}`;

    if (!AUDITABLE_TRANSITIONS.has(transitionKey)) {
      return;
    }

    // 4. Idempotency guard — same transition already recorded
    const existing = await db('lifecycle_audit_events')
      .where({
        user_id: userId,
        from_phase: previousPhase,
        to_phase: currentPhase,
      })
      .first();

    if (existing) return;

    /* console.info('[LIFECYCLE][AUDIT][RECORDED]', {
      userId,
      shopId,
      from: previousPhase,
      to: currentPhase,
    }); */

    // 5. Write audit event
    try {
      const eventId = crypto.randomUUID();
      const occurredAt = db.fn.now();

      await db('lifecycle_audit_events')
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

      // 6. Update lifecycle snapshot (projection of audit event)
      await db('user_lifecycle_snapshot')
        .insert({
          user_id: userId,
          shop_id: shopId,
          phase: currentPhase,
          since: occurredAt,
          last_event_id: eventId,
          updated_at: db.fn.now(),
        })
        .onConflict('user_id')
        .merge({
          phase: currentPhase,
          since: occurredAt,
          last_event_id: eventId,
          updated_at: db.fn.now(),
        });
    } catch (err) {
    // Defensive: uniqueness violation or race — treat as no-op
    return;
    }
  }
}